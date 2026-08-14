'use strict';
// 日本財務省（MOF）月別入札カレンダーページの抽出ルール（config/official-sources.json jp_mof）。
// 実データ構造（2026-08-14実測fixtureで確認）: auction_calendar_index.htmは月別インデックス
// （年次一括公表ではなく、直近数ヶ月分のみ月別ページへのリンクが順次追加される。2026-08-14時点で
// 2026年1〜10月分のみリンク済み・11/12月は未リンク）。実際の入札一覧は月別ページ
// （例: 2608e.htm=2026年8月分）の<table class="table2a">にあり、行ごとに
// 「Auction Date（例: Aug. 4, 2026）｜ Issue（例: 10-year(383)）｜...」の列を持つ。
// 命名（SPEC §4.2の「{年限}利付国債（{発行年月}債）の入札」テンプレート）は
// レンダラー実装（task #12）側の責務のため、本抽出は{date, tenorJa, kind}までを返す。
const MONTH_ABBR = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

// "10-year" → "10年" のような年限表記の変換（既刊実例: 10年・30年）
function tenorToJa(tenorEn) {
  const m = /^(\d+)[- ]year$/i.exec(tenorEn.trim());
  return m ? `${m[1]}年` : null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// html: 月別入札カレンダーページ（例: 2608e.htm）の生テキスト
// 戻り値: { ok: true, rows: [{ date, tenorJa, issueRaw }] } または { ok: false, reason }
// tenorJaがnullの行（Treasury Discount Bills等、既刊命名テンプレート対象外の短期証券）は除外する
function extractMofAuctions(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})<\/td>\s*<td[^>]*>([^<]+?)(?:<span>[^<]*<\/span>)?<\/td>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const monthNum = MONTH_ABBR[m[1]];
    if (!monthNum) continue;
    const date = `${m[3]}-${pad2(monthNum)}-${pad2(Number(m[2]))}`;
    const issueRaw = m[4].trim();
    const tenorJa = tenorToJa(issueRaw);
    if (tenorJa) rows.push({ date, tenorJa, issueRaw, kind: 'bond_auction' });
  }
  if (rows.length === 0) {
    return { ok: false, reason: '月別入札カレンダーページの入札行が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, rows };
}

module.exports = { extractMofAuctions, tenorToJa };
