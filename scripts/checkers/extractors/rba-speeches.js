'use strict';
// RBA（豪州準備銀行）講演RSSの抽出ルール（config/official-sources.json au_rba_speeches、
// rss/rss-cb-speeches.xml）。task #72（2026-09-19）。
// 実データ構造（2026-09-19実測、live fetch）: RSS 1.0/RDF形式（BOC/SNBと同じCentral Bank Wiki
// 拡張cb:名前空間）。BOE/BOCと異なり話者名は<cb:person><cb:nameAsWritten>{フルネーム}
// </cb:nameAsWritten><cb:role><cb:jobTitle>{役職}</cb:jobTitle></cb:role></cb:person>という
// 構造化フィールドを持つため、タイトル文字列からの姓抽出（BOEの「speech by」パース）は不要。
// dc:date/cb:occurrenceDateはISO8601形式で明示的UTCオフセット付き（実測+10:00=AEST。豪東部は
// 10-4月は+11:00=AEDTになるが、各itemが個別に明示オフセットを持つためDST判定不要で直接JST
// 換算できる）。
// 実測で判明した制約: フィードは常に「直近1件のみ」を掲載する設計（<rdf:Seq>のrdf:liが1件のみ）
// であり、BOE/BOCのような複数件のローリング履歴ではない。同一週内に複数講演があった場合、
// 週次チェック実行タイミングによっては先の講演が既にフィードから消えている（後の講演に上書き
// される）リスクがある点に注意（実運用で漏れが観測されたら別ソース[coming-up/schedules-events/
// calendar等]の追加を検討する。task #72の「実際に漏れが観測されたら着手」の方針を踏襲）。

function extractRbaSpeeches(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const titleM = /<title>([^<]*)<\/title>/.exec(block);
    const dateM = /<dc:date>([^<]+)<\/dc:date>/.exec(block);
    const personM = /<cb:nameAsWritten>([^<]+)<\/cb:nameAsWritten>/.exec(block);
    if (!titleM || !dateM || !personM) continue;
    items.push({
      speakerLastName: personM[1].trim(),
      title: titleM[1].trim(),
      pubDateRaw: dateM[1].trim(),
    });
  }
  if (items.length === 0) {
    return { ok: false, reason: 'rss-cb-speeches.xmlにcb:nameAsWrittenを持つ<item>が1件も見つからない。フィード構造変化の疑い' };
  }
  return { ok: true, items };
}

module.exports = { extractRbaSpeeches };
