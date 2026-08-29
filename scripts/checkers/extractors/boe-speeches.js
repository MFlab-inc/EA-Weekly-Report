'use strict';
// BOE（Bank of England）総裁・幹部講演RSS（config/official-sources.json gb_boe_speeches、
// rss/speeches）の抽出ルール。
// 実データ構造（2026-08-29実測、boe-speeches-recon一時ワークフロー・GitHub Actions実ネットワーク）:
// 標準的なRSS 2.0。<item><title>{講演タイトル} {区切り文字[-/−等]} speech by {話者フルネーム}</title>
// <pubDate>RFC822形式・明示的UTCオフセット付き（例: Tue, 21 Jul 2026 11:00:00 +0100）</pubDate>...</item>
//
// 話者名は「speech by 」以降を丸ごとフルネームで抽出する（姓のみでは不十分）。実測で
// 『Andrew Bailey』（総裁）と『David Bailey』（総裁とは別人のExecutive Director）が同一フィード内に
// 混在することを確認済みのため、姓のみ[Bailey]で抽出するとofficials.jsonのfull_name部分一致
// （naming.resolveOfficialBySurname）で両者を区別できず、David Baileyの講演が誤って総裁級★★★に
// 昇格してしまう。フルネームで抽出すれば"Andrew Bailey"は完全一致し、"David Bailey"は
// officials.json記載の"アンドリュー・ベイリー（Andrew Bailey）"の部分文字列にならないため、
// 正しく未登録話者（★★安全側+WARN）として扱われる。
//
// pubDateは絶対時刻（明示的UTCオフセット付き）のためDST判定不要でJST直接換算できる
// （us_frb_speechesと同じ設計）。

// xml: rss/speechesの生テキスト
// 戻り値: { ok: true, items: [{ speakerLastName, title, pubDateRaw }] } または { ok: false, reason }
// 「speech by」形式でない行（構造変化の可能性）は対象外とする
function extractBoeSpeeches(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const titleM = /<title>([^<]+)<\/title>/.exec(block);
    const pubDateM = /<pubDate>([^<]+)<\/pubDate>/.exec(block);
    if (!titleM || !pubDateM) continue;
    const fullTitle = titleM[1].trim();
    const speakerM = /speech by (.+)$/i.exec(fullTitle);
    if (!speakerM) continue;
    items.push({
      speakerLastName: speakerM[1].trim(),
      title: fullTitle,
      pubDateRaw: pubDateM[1].trim(),
    });
  }
  if (items.length === 0) {
    return { ok: false, reason: 'rss/speechesの<item>要素が1件も見つからない、または全件が「speech by」形式でない。フィード構造変化の疑い' };
  }
  return { ok: true, items };
}

module.exports = { extractBoeSpeeches };
