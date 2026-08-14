'use strict';
// 発言・会見・議会・中銀・入札の規則生成命名（SPEC §4.2）。
// templates/design-mock_v1.2.html（デザイン契約）の実例文言に厳密準拠する。
// 統計指標（event-names.json辞書ベース）はこのモジュールの対象外。

// verified:false の役職は人名を出さず役職のみで命名する（SPEC §4.2・誤記より情報減を選ぶ）
function nameAndRole(official, roleJa) {
  if (official && official.verified) return `${official.name_ja}${roleJa}`;
  return roleJa;
}

function speechName(official, roleJa) {
  return `${nameAndRole(official, roleJa)}の発言`;
}

function pressConferenceName(official, roleJa) {
  return `${nameAndRole(official, roleJa)}の記者会見`;
}

// committeeJa: 例「下院経済委員会」（design-mock_v1.2.html実例準拠。末尾「への出席」は固定）
function testimonyName(official, roleJa, committeeJa) {
  return `${nameAndRole(official, roleJa)}：${committeeJa}への出席`;
}

function policyRateName(bankAbbr) {
  return `${bankAbbr}政策金利＆声明発表`;
}

function quarterlyReportName(bankAbbr) {
  return `${bankAbbr}四半期金融政策報告`;
}

// BOJ（金融政策決定会合）の主な意見・議事要旨。design-mock_v1.2.htmlの実例文言に準拠
// （「日銀 」半角スペース区切り・「の公表」を含めない）。periodJa: 例「7月30・31日開催分」
const BOJ_OPINIONS_BASE = '日銀 金融政策決定会合における主な意見';
const BOJ_MINUTES_BASE = '日銀 金融政策決定会合議事要旨';

function bojOpinionsName(periodJa) {
  return periodJa ? `${BOJ_OPINIONS_BASE}（${periodJa}）` : BOJ_OPINIONS_BASE;
}

function bojMinutesName(periodJa) {
  return periodJa ? `${BOJ_MINUTES_BASE}（${periodJa}）` : BOJ_MINUTES_BASE;
}

// 国債入札（国別分岐。2026-08-14確定・既刊実例に基づく。SPEC §4.2）
// issueYearMonthJa: 例「2026年8月」
function bondAuctionNameJp(tenorJa, issueYearMonthJa) {
  return `${tenorJa}利付国債（${issueYearMonthJa}債）の入札`;
}

function bondAuctionNameUs(tenorJa) {
  return `米${tenorJa}債入札`;
}

module.exports = {
  nameAndRole,
  speechName,
  pressConferenceName,
  testimonyName,
  policyRateName,
  quarterlyReportName,
  bojOpinionsName,
  bojMinutesName,
  bondAuctionNameJp,
  bondAuctionNameUs,
};
