'use strict';
// ニュージーランド統計局（Stats NZ）の抽出（task #15）。
// open data API（api.stats.govt.nz）は2024-08-30に閉鎖済み、年次PDFカレンダーも
// 発見できなかったため、各四半期の情報公開ページ自体が本文に埋め込む次回リリース
// 予定日（「Labour market statistics: {月} {年} quarter will be released on {date}.」）
// を抽出対象とする。ページはSilverStripe CMSのブロックデータをHTMLエンティティ＋
// JSON文字列エスケープの二重エンコードで属性値に埋め込んでいるため、正規表現で
// 直接パースする（「(income)」派生系列は"statistics: "の直後に"("が来ないことで自然に除外される）。
//
// 運用上の注意（config/official-sources.jsonのnext_release_maintenance参照）:
// access.targetsは「直近に公表された四半期ページ」を指す必要があり、四半期ごとの
// 手動更新が必要。更新を怠るとfindLatestAnnouncedRelease()が対象週を含む発表を
// 見つけられずok:falseを返す（フェールクローズ規則へ接続）。

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// "5 August 2026" -> "2026-08-05"
function parseDayMonthYear(s) {
  const m = /^(\d{1,2}) (\w+) (\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  return `${m[3]}-${pad2(month)}-${pad2(Number(m[1]))}`;
}

// html: labour-market-statistics-{month}-{year}-quarter/ ページのHTML全文。
// 戻り値: { ok, releases: [{quarterLabel, releaseDate}] } — quarterLabelは"June 2026"等（対象四半期）。
// "(income)"系列は除外する（config/event-names.jsonのemployment_situation kindは
// 通常のLabour market statisticsのみを追跡対象とするため）
function extractNzNextRelease(html) {
  const re = /Labour market statistics: (\w+ \d{4}) quarter.{0,30}?will be released on (\d{1,2} \w+ \d{4})\./g;
  const releases = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const releaseDate = parseDayMonthYear(m[2]);
    if (releaseDate) releases.push({ quarterLabel: m[1], releaseDate });
  }
  if (releases.length === 0) {
    return { ok: false, reason: '次回リリース予定日の埋め込みテキストが見つからない（ページ構造変化またはURL更新漏れの可能性）', releases: [] };
  }
  return { ok: true, releases };
}

module.exports = { extractNzNextRelease, parseDayMonthYear };
