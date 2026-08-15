'use strict';
// FRB理事講演RSS（config/official-sources.json us_frb_speeches、feeds/speeches.xml）の抽出ルール。
// 実データ構造（2026-08-14実測fixtureで確認）: 標準的なRSS 2.0。<item><title>姓, 講演タイトル</title>
// <pubDate>Wed, 5 Aug 2026 20:05:00 GMT</pubDate>...</item>。pubDateは絶対UTC値のため
// DST判定不要でJST直接換算できる（utcToJstParts、他の日程のみソースと同じ設計）。
// 姓から人物・役職を確定するにはconfig/officials.jsonの解決が必要だが、現時点でFRB理事
// （議長ではなく理事個人）はofficials.jsonに未登録のため、本抽出は{date, time, speakerLastName,
// title}までを返す（人名・役職解決＋SPEC §4.2命名テンプレート適用はofficials.json拡充後に対応）。

// xml: speeches.xmlの生テキスト
// 戻り値: { ok: true, items: [{ speakerLastName, title, pubDateRaw }] } または { ok: false, reason }
function extractFrbSpeeches(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const titleM = /<title>([^<]+)<\/title>/.exec(block);
    const pubDateM = /<pubDate><!\[CDATA\[([^\]]+)\]\]><\/pubDate>|<pubDate>([^<]+)<\/pubDate>/.exec(block);
    if (!titleM || !pubDateM) continue;
    const fullTitle = titleM[1].trim();
    const commaIdx = fullTitle.indexOf(',');
    const speakerLastName = commaIdx > 0 ? fullTitle.slice(0, commaIdx).trim() : null;
    items.push({
      speakerLastName,
      title: fullTitle,
      pubDateRaw: (pubDateM[1] || pubDateM[2]).trim(),
    });
  }
  if (items.length === 0) {
    return { ok: false, reason: 'speeches.xmlの<item>要素が1件も見つからない。フィード構造変化の疑い' };
  }
  return { ok: true, items };
}

module.exports = { extractFrbSpeeches };
