'use strict';
// 週入力（days配列：日付ごとのevents＋windowGroups）から、レンダラーが必要とする
// 完全な描画データ（停止バーの%・▲位置・注記まで計算済み）を組み立てる。
// 停止目安の数値計算自体はscripts/lib/halt-schedule.js（design-mock_v1.2.htmlの実例で
// 検証済みのエンジン）に委譲し、このモジュールは「どのイベントが同一枠か」という
// グルーピング情報のみを入力として受け取る（グルーピング自体の汎用自動化は将来課題）。
const { computeHaltWindow, unionIntervals } = require('../lib/halt-schedule');
const { parseHHMM } = require('../lib/halt-schedule');

function pct(min) {
  return Math.round((min / 1440) * 1000) / 10; // 小数点1桁（design-mock_v1.2.html準拠）
}

// day: { date, md, weekday, events: [{id,time,importance,countryJa,currency,displayName,comment,kind}],
//        windowGroups: [{ firstTime, lastTime, labelItems:[{time,text}] }] }
// extraBarIntervals: 翌日の発表枠のうち停止窓が丸ごと前日（＝この日）に収まるもの（task #47実バグ
// 修正）を、この日のバーへ追加描画するための{start,end}区間（前日0時起点の分）。borrowedNotesは
// その由来を独立した1行として描画するための構造化情報（{time,label,start,end,countryJa,currency}。
// html-renderer.js側でwindowLinesと同じ見た目の行として合成する。task #49でしょうさん指摘の
// 読みやすさ改善に伴い、単純な注記文字列からこの形へ変更した）
function buildDayHaltCard(day, extraBarIntervals = [], borrowedNotes = []) {
  const windows = (day.windowGroups || []).map((g) =>
    computeHaltWindow({ date: day.date, firstTime: g.firstTime, lastTime: g.lastTime })
  );
  // entirelyPreviousDayの窓（停止窓が丸ごと前日に収まるケース）は、この日自身のバーには
  // 描画しない（前日のバーへ移設する。呼び出し元のbuildReportData参照）
  const ownIntervals = windows
    .filter((w) => !w.entirelyPreviousDay)
    .map((w) => ({ start: w.displayStartMin, end: w.displayEndMin }));
  const bars = unionIntervals([...ownIntervals, ...extraBarIntervals]).map((iv) => ({
    leftPct: pct(iv.start),
    widthPct: pct(iv.end - iv.start),
  }));
  const rawTriangles = (day.windowGroups || []).flatMap((g) => (g.labelItems || []).map((li) => ({ time: li.time, leftPct: pct(parseHHMM(li.time)) })));
  // 同一時刻（同一leftPct）の▲は完全に重なり見た目上1つのため、重複を除いて描画する
  const seenLeftPct = new Set();
  const triangles = rawTriangles.filter((t) => (seenLeftPct.has(t.leftPct) ? false : (seenLeftPct.add(t.leftPct), true)));

  const star3Count = day.events.filter((e) => e.importance === 3).length;
  return { date: day.date, md: day.md, weekday: day.weekday, star3Count, windows, bars, triangles, borrowedNotes };
}

function buildReportData(weekInput) {
  // 1st pass: 各日のwindowGroupsから停止窓を計算する（バー・注記の組み立てはまだ行わない）。
  // entirelyPreviousDayの窓（停止窓が丸ごと前日に収まる。例: 火03:00発表→窓は月15:00-23:00）は
  // 前日のバーへ移設するため、先に全日分の窓を洗い出してから2nd passで日ごとのカードを作る
  // （task #47実バグ修正、8/17週フルパイプライン実ネットワーク検証で発見）
  const rawDays = weekInput.days.map((day) => ({
    ...day,
    windows: (day.windowGroups || []).map((g) => computeHaltWindow({ date: day.date, firstTime: g.firstTime, lastTime: g.lastTime })),
  }));

  const extraBarsByIndex = rawDays.map(() => []);
  const borrowedNotesByIndex = rawDays.map(() => []);
  rawDays.forEach((rd, idx) => {
    rd.windows.forEach((w, wi) => {
      if (!w.entirelyPreviousDay) return;
      if (idx === 0) return; // 月曜の前日は日曜（対象週外）のため描画対象日が無い。注記のみで表現する
      const group = rd.windowGroups[wi];
      extraBarsByIndex[idx - 1].push({ start: w.previousDayBarStartMin, end: w.previousDayBarEndMin });
      const label = (group?.labelItems || []).map((li) => li.text).join('・') || '';
      borrowedNotesByIndex[idx - 1].push({
        time: w.resumeAfter,
        label,
        start: w.rawPreviousDayStart,
        end: w.rawPreviousDayEnd,
        countryJa: group?.countryJa || '',
        currency: group?.currency || '',
      });
    });
  });

  const days = rawDays.map((day, idx) => ({
    date: day.date,
    md: day.md,
    weekday: day.weekday,
    windowGroups: day.windowGroups,
    halt: buildDayHaltCard(day, extraBarsByIndex[idx], borrowedNotesByIndex[idx]),
    events: day.events,
  }));
  const star3Total = days.reduce((sum, d) => sum + d.events.filter((e) => e.importance === 3).length, 0);
  // 発表枠数（ヒーロー統計）: ★★★イベントを「同日・同時刻」でグルーピングした数（同時刻の複数系列＝1枠）。
  // これは停止バー用のwindowGroups（例: RBA 13:30の政策金利＆声明＋SOMPと14:30の記者会見を
  // 停止目安の連続性の観点で1つにまとめたもの）とは独立に、公表時刻ベースで数え直す
  // （design-mock_v1.2.htmlの「発表枠 8」はRBAの13:30枠と14:30枠を別枠として数えている）
  const releaseWindowKeys = new Set();
  for (const d of days) {
    for (const e of d.events) {
      if (e.importance === 3) releaseWindowKeys.add(`${d.date}|${e.time}`);
    }
  }
  const releaseWindowCount = releaseWindowKeys.size;
  return {
    reportMeta: weekInput.reportMeta,
    createdDateJa: weekInput.createdDateJa,
    targetWeekStart: weekInput.targetWeekStart,
    targetWeekEnd: weekInput.targetWeekEnd,
    targetWeekLabelJa: weekInput.targetWeekLabelJa,
    heroSummary: weekInput.heroSummary,
    heroPills: weekInput.heroPills,
    star3Total,
    releaseWindowCount,
    dayCount: days.length,
    days,
  };
}

module.exports = { buildReportData, buildDayHaltCard, pct };
