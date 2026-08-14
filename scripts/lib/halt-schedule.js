'use strict';
// EA停止目安の計算（SPEC §5・本レポートの中核）。
// 対象: importance=3（★★★）の発表枠のみ。時刻未公表のイベントは呼び出し側で除外すること
// （このモジュールは時刻ありの発表枠のみを扱う）。
//
// 発表枠（release window）: 同時刻・同発表主体で束ねた1〜複数イベントの集合（SPEC §4.1）。
// 停止開始目安 = [枠内最初の発表時刻-12h, 枠内最初の発表時刻-4h]。
// 窓が枠の日（JST）の前日に跨る場合、時間バー・数値表示は当日00:00にクランプし、
// 本当の開始時刻は注記でのみ示す（SPEC §5・design-mock_v1.2.htmlの実例で検証済み）。
// 月曜の枠で前日（＝日曜）に跨る場合のみ「週明けの取引開始時点から」の特別文言を使う
// （月〜金のみを対象とする本レポートでは、前日が日曜になるのは月曜の枠だけ）。

const { parseYmd, addDays, weekdayJa } = require('./dates');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 分（負数・1440以上も許容）を当日基準のHH:MMへラップして整形。丸めは行わない（SPEC §5必須ケース）。
function formatMinutes(min) {
  const wrapped = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/**
 * 1発表枠の停止目安を計算する。
 * @param {object} window
 * @param {string} window.date - 発表枠の日付（枠内最初のイベントの日付・JST、'YYYY-MM-DD'）
 * @param {string} window.firstTime - 枠内最初のイベントの発表時刻（JST、'HH:MM'）
 * @param {string} [window.lastTime] - 枠内最後のイベントの発表時刻（JST、'HH:MM'）。再開確認の基準として返す。省略時はfirstTimeと同じ（単独イベント）
 * @returns {{
 *   startMin: number, endMin: number,           // 生の窓（当日00:00起点の分。負数=前日に跨る）
 *   displayStartMin: number, displayEndMin: number, // 表示用（当日にクランプ済み）
 *   displayStart: string, displayEnd: string,    // HH:MM表示文字列
 *   crossesPreviousDay: boolean,
 *   previousDayLabel: string|null,               // 「前日 ◯曜」用の曜日文字（跨ぎがある場合のみ）
 *   rawPreviousDayStart: string|null,             // 跨いだ場合の本当の開始時刻（HH:MM、前日基準）
 *   isMondayWeekendCross: boolean,                // 月曜の枠で前日=日曜に跨るケースか
 *   annotation: string|null,                      // SPEC文言テンプレート適用済みの注記（呼び出し側でreport-policy.jsonのテンプレートに置換する場合は無視してよい）
 *   resumeAfter: string,                          // 再開確認の基準時刻（lastTime）
 * }}
 */
function computeHaltWindow({ date, firstTime, lastTime }) {
  const basisMin = parseHHMM(firstTime);
  const startMin = basisMin - 12 * 60;
  const endMin = basisMin - 4 * 60;

  const crossesPreviousDay = startMin < 0;
  const displayStartMin = Math.max(startMin, 0);
  const displayEndMin = endMin;

  let previousDayLabel = null;
  let rawPreviousDayStart = null;
  let isMondayWeekendCross = false;
  let annotation = null;

  if (crossesPreviousDay) {
    const eventDate = parseYmd(date);
    const prevDate = addDays(eventDate, -1);
    previousDayLabel = weekdayJa(prevDate);
    rawPreviousDayStart = formatMinutes(startMin);
    isMondayWeekendCross = previousDayLabel === '日';
    annotation = isMondayWeekendCross
      ? `前日 ${previousDayLabel}曜${rawPreviousDayStart}〜を含むため、週明けの取引開始時点からの停止が目安`
      : `前日 ${previousDayLabel}曜${rawPreviousDayStart}〜を含む`;
  }

  return {
    startMin,
    endMin,
    displayStartMin,
    displayEndMin,
    displayStart: formatMinutes(displayStartMin),
    displayEnd: formatMinutes(displayEndMin),
    crossesPreviousDay,
    previousDayLabel,
    rawPreviousDayStart,
    isMondayWeekendCross,
    annotation,
    resumeAfter: lastTime || firstTime,
  };
}

// 同日複数枠の時間バー表示用: 表示クランプ済みの複数区間を和集合にまとめる（SPEC §5）。
// intervals: [{start, end}]（分・当日0〜1440範囲を想定）。戻り値は開始昇順にマージ済みの区間配列。
function unionIntervals(intervals) {
  const sorted = intervals
    .map((iv) => ({ start: iv.start, end: iv.end }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

module.exports = {
  computeHaltWindow,
  unionIntervals,
  formatMinutes,
  parseHHMM,
};
