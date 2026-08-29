'use strict';
// 発言・会見・議会・中銀・入札の規則生成命名（SPEC §4.2）。
// 既刊2週（reference/sample-report_20260808.html）の実表記を正解データとして、
// test/naming.test.jsで一致を検証する（2026-08-15しょうさん指示）。
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

// BOJ（金融政策決定会合）の主な意見・議事要旨。既刊実データ（reference/sample-report_20260808.html
// のdata-ea-event-display-name-ja属性・見出しテキスト、2026-08-15実測）の文言に準拠する
// （旧実装はtemplates/design-mock_v1.2.htmlの簡略表記を転記していたが、実際の既刊2週とは
// 語順が異なっていたため訂正した）。2つのkindで語順・periodJaの書式が異なる点に注意（実データどおり）:
// - 主な意見: 名称内に「日銀」を含み「の公表」で終わる。periodJaは年を含まない（例:「7月30・31日開催分」）
// - 議事要旨: 名称内に「日銀」を含まない（レンダラー側の国名ラベル「日本」が別途表示されるため）。
//   periodJaは年を含む（例:「2026年6月15日・16日開催分」）
const BOJ_OPINIONS_BASE = '日銀金融政策決定会合における主な意見の公表';
const BOJ_MINUTES_BASE = '金融政策決定会合議事要旨';

function bojOpinionsName(periodJa) {
  return periodJa ? `${BOJ_OPINIONS_BASE}（${periodJa}）` : BOJ_OPINIONS_BASE;
}

function bojMinutesName(periodJa) {
  return periodJa ? `${BOJ_MINUTES_BASE}（${periodJa}）` : BOJ_MINUTES_BASE;
}

// periodJaの書式（しょうさん指示2026-08-15・既刊2週の実例に準拠）。meetingStart/meetingEnd（'YYYY-MM-DD'）
// はscripts/lib/boj-meeting-schedule.jsのresolveBojMeetingRange()が返す会合開催日レンジ（常に連続2日）。
// 主な意見=年なし・開始日は「日」抜き（「7月30・31日」）、議事要旨=年あり・両日「日」付き
// （「2026年6月15日・16日」）。既刊2週はいずれも同月内の会合のため、月をまたぐ会合（例: 1/31・2/1開催）
// は実例未確認だが、両日それぞれに月を付け直す形で機械的に拡張した（未検証の一般化である点に注意）
function formatOpinionsPeriod(meetingStart, meetingEnd) {
  const [, ms, ds] = meetingStart.split('-').map(Number);
  const [, me, de] = meetingEnd.split('-').map(Number);
  if (ms === me) return `${me}月${ds}・${de}日開催分`;
  return `${ms}月${ds}日・${me}月${de}日開催分`;
}

function formatMinutesPeriod(meetingStart, meetingEnd) {
  const [ys, ms, ds] = meetingStart.split('-').map(Number);
  const [ye, me, de] = meetingEnd.split('-').map(Number);
  if (ys === ye && ms === me) return `${ye}年${me}月${ds}日・${de}日開催分`;
  if (ys === ye) return `${ye}年${ms}月${ds}日・${me}月${de}日開催分`;
  return `${ys}年${ms}月${ds}日・${ye}年${me}月${de}日開催分`;
}

// 国債入札（国別分岐。2026-08-14確定・既刊実例に基づく。SPEC §4.2）
// issueYearMonthJa: 例「2026年8月」
function bondAuctionNameJp(tenorJa, issueYearMonthJa) {
  return `${tenorJa}利付国債（${issueYearMonthJa}債）の入札`;
}

function bondAuctionNameUs(tenorJa) {
  return `米${tenorJa}債入札`;
}

// country（ISO国コード）→ 中銀略称。policy_rate/quarterly_reportのように人名を伴わない
// テンプレートで使う（会見・発言・議会はofficials.jsonのrole_ja自体に略称を含むため別途不要）。
// 登録漏れの挙動: build-ledger.jsのresolveRuleGeneratedNameが未登録国にnullを返し
// FALLBACK_KIND_LABELの汎用ラベル（「政策金利発表」等）へ落ちる（生コード漏れにはならない）。
// ただし検出網が無いと気づかれず表示品質が静かに劣化するため、
// scripts/lib/validate-naming-coverage.js（test/validate-naming-coverage.test.jsの実configゲート、
// task #56）でofficial-sources.json登録国とのカバレッジを検証する
const BANK_ABBR_BY_COUNTRY = {
  JP: '日銀', US: 'FRB', AU: 'RBA', EU: 'ECB',
  GB: 'BOE', CA: 'BOC', NZ: 'RBNZ', CH: 'SNB',
};

// config/officials.jsonのofficials配列から、対象国の中銀総裁エントリを1件解決する
function resolveGovernor(officials, country) {
  return (officials || []).find((o) => o.role_type === 'central_bank_governor' && o.country === country) || null;
}

// official_speech向け: 発言者の英語姓（例: RSSタイトルから抽出した"Cook"）から、
// config/officials.jsonの該当者を解決する。officials.jsonのfull_name欄は非日本人の場合
// 「ミシェル・ブロック（Michele Bullock）」のように日本語表記＋英語フルネームを併記する
// 既存慣行があるため、full_nameに英語姓が部分一致する要素をもって照合する（2026-08-15新設）。
// 2026-08-15時点、officials.jsonにはFRB議長（チェア）以外の個々のFRB理事
// （Cook・Waller等）は未登録（task #17）のため、実運用では常にnull＝役職のみ命名
// （SPEC §4.2のverified:falseフォールバック）になる。task #17でFRB理事個々の登録が
// 追加され、同じfull_name併記慣行が踏襲されれば、本関数はそのまま機能する
// task #88（2026-08-30、しょうさん指摘: BOEのAndrew Bailey/David Bailey同姓問題を受けた横断監査で発覚）。
// 従来はcountryを一切考慮せずofficials.json全件からfull_name部分一致で検索していたため、
// 別の国の話者の姓がたまたま別の国の登録済み総裁のfull_nameの部分文字列と一致すると、
// 誤ってその国の総裁として解決されてしまう構造的な欠陥があった（例: "Bailey"という姓だけの
// 話者がどの国から来ても、英国総裁のfull_name"アンドリュー・ベイリー（Andrew Bailey）"の
// 部分文字列と一致してしまい、国を問わずBOE総裁に誤認識される）。countryを必須の第3引数とし、
// 未指定時はフェールクローズで一致なし（同姓の別人問題と同じ「不確実なら安全側」の方針）。
// 呼び出し側は必ずcandidate.countryを渡すこと（scripts/lib/build-ledger.js参照）
function resolveOfficialBySurname(officials, surnameEn, country) {
  if (!surnameEn || !country) return null;
  return (officials || []).find((o) => o.country === country && o.full_name && o.full_name.includes(surnameEn)) || null;
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
  formatOpinionsPeriod,
  formatMinutesPeriod,
  bondAuctionNameJp,
  bondAuctionNameUs,
  BANK_ABBR_BY_COUNTRY,
  resolveGovernor,
  resolveOfficialBySurname,
};
