'use strict';
// 米財務省 Fiscal Data API（config/official-sources.json us_treasury、upcoming_auctions）の抽出ルール。
// 実データ構造（2026-08-14実測fixtureで確認）: { data: [{record_date, security_type, security_term,
// reopening, cusip, offering_amt, announcemt_date, auction_date, issue_date}], meta:{...} }。
// クエリパラメータ無しで叩くと record_date 2024年3月〜直近まで約90件が返る（ページングやsortは
// 未適用の生応答）ため、本抽出は「対象週内のauction_dateを持つ行」を自前でフィルタする。
// TreasuryDirect本体（treasurydirect.gov・TA_WS API含む）はrobots.txtで全面ブロックのため使用しない。
// 命名（SPEC §4.2の「米{年限}債入札」テンプレート）はレンダラー実装（task #12）側の責務のため、
// 本抽出は{date, tenorJa, securityType, kind}までを返す。

// "10-Year"→"10年"、"29-Year 6-Month"はSPEC命名テンプレート対象外（月単位混在のため）としてnullを返す
function termToJa(securityTerm) {
  const m = /^(\d+)-Year$/i.exec(securityTerm.trim());
  return m ? `${m[1]}年` : null;
}

// json: fiscaldata upcoming_auctions APIの生レスポンス文字列
// weekStart/weekEnd: 'YYYY-MM-DD'（対象週）
// 戻り値: { ok: true, rows: [{ date, tenorJa, securityType, securityTerm, kind }] } または { ok: false, reason }
function extractUsTreasuryAuctions(json, weekStart, weekEnd) {
  let body;
  try {
    body = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `JSON解析失敗: ${e.message}` };
  }
  if (!Array.isArray(body?.data)) {
    return { ok: false, reason: 'data配列が存在しない。API応答構造の変化の疑い' };
  }
  const rows = body.data
    .filter((r) => r.auction_date >= weekStart && r.auction_date <= weekEnd)
    .map((r) => ({
      date: r.auction_date,
      tenorJa: termToJa(r.security_term || ''),
      securityType: r.security_type,
      securityTerm: r.security_term,
      kind: 'bond_auction',
    }))
    .filter((r) => r.tenorJa);
  return { ok: true, rows };
}

module.exports = { extractUsTreasuryAuctions, termToJa };
