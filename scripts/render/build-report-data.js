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
function buildDayHaltCard(day) {
  const windows = (day.windowGroups || []).map((g) =>
    computeHaltWindow({ date: day.date, firstTime: g.firstTime, lastTime: g.lastTime })
  );
  const bars = unionIntervals(windows.map((w) => ({ start: w.displayStartMin, end: w.displayEndMin }))).map((iv) => ({
    leftPct: pct(iv.start),
    widthPct: pct(iv.end - iv.start),
  }));
  const triangles = (day.windowGroups || []).flatMap((g) => (g.labelItems || []).map((li) => ({ time: li.time, leftPct: pct(parseHHMM(li.time)) })));

  const star3Count = day.events.filter((e) => e.importance === 3).length;
  return { date: day.date, md: day.md, weekday: day.weekday, star3Count, windows, bars, triangles };
}

function buildReportData(weekInput) {
  const days = weekInput.days.map((day) => ({
    date: day.date,
    md: day.md,
    weekday: day.weekday,
    windowGroups: day.windowGroups,
    halt: buildDayHaltCard(day),
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
