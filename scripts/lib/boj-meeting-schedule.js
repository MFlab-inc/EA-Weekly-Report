'use strict';
// BOJ金融政策決定会合の会合期間（開催日レンジ）解決（SPEC §4.2の規則生成命名向け、しょうさん指示2026-08-15）。
// config/official-sources.jsonのjp_boj.scheduleに記録されたpolicy_rate日程（会合2日目=政策決定発表日）
// から、opinions_summary/minutes_summaryの各発表が「どの回の会合」を指すかを、BOJの公表運用
// （jp_boj.notesに記載: 主な意見=会合後6営業日目・議事要旨=次回会合後3営業日目）に基づき機械的に導出する。
// 「議事要旨=次回会合後3営業日目」＝会合後、次の会合を経てから公表される、という意味のため、
// 議事要旨が指す会合は直近会合ではなく「1つ前の会合」である点に注意（既刊ground truthで実証済み:
// 2026-08-05公表の議事要旨は2026-07-31会合ではなく2026-06-16会合＝直近の1つ前を指す）。
const { parseYmd, addDays, formatYmd } = require('./dates');

// policyRateDates: jp_boj.scheduleのうちkind='policy_rate'のdate一覧（'YYYY-MM-DD'、順不同可）。
// announceDateJst: opinions_summary/minutes_summaryの発表日（'YYYY-MM-DD'、JST）。
// indexFromMostRecent: 0=announceDateJst以前で最も新しい会合（opinions_summary用）、
//   1=その1つ前の会合（minutes_summary用）
// 戻り値: {meetingStart, meetingEnd}（会合は常に連続2日と仮定。会合2日目=policy_rateのdate）。
// 該当する会合が見つからない（scheduleの範囲外等）場合はnull
function resolveBojMeetingRange(policyRateDates, announceDateJst, indexFromMostRecent) {
  const pastDatesDesc = [...new Set(policyRateDates)]
    .filter((d) => d <= announceDateJst)
    .sort()
    .reverse();
  const meetingEnd = pastDatesDesc[indexFromMostRecent];
  if (!meetingEnd) return null;
  const meetingStart = formatYmd(addDays(parseYmd(meetingEnd), -1));
  return { meetingStart, meetingEnd };
}

module.exports = { resolveBojMeetingRange };
