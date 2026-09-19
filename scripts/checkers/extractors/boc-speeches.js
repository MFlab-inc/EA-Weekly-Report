'use strict';
// BOC（カナダ銀行）総裁・幹部講演フィードの抽出ルール（config/official-sources.json ca_boc_speeches、
// content_type/speeches/feed/）。task #72（2026-09-19、しょうさん指摘: 9/21週にマックレム総裁の
// 講演★★★が未検出だったことを機にBOC/RBA/ECB/SNBの講演ソースを新設。RBNZは事前調査でサイト
// アクセス不可のため対象外）。
// 実データ構造（2026-09-19実測、live fetch）: RSS 1.0/RDF形式（BOE/FRBのRSS 2.0とは異なる）。
// Central Bank Wiki拡張名前空間（cb: = http://www.cbwiki.net/wiki/index.php/Specification_1.2/）を持ち、
// 実際の講演itemには<cb:speech rdf:parseType="Resource"><rdf:type
// rdf:resource=".../RSS-CB_1.2_RDF_Schema#LocatedAnnouncement"/>...<cb:person
// rdf:parseType="Resource"><cb:nameAsWritten>{フルネーム}</cb:nameAsWritten></cb:person>...</cb:speech>
// が付与される。同一イベントの「告知/ウェブキャスト」用の重複item（<cb:news>型、cb:speechブロック無し）
// も同一フィードに混在するため、LocatedAnnouncement（cb:speech）を持つitemのみを対象とする。
// dc:dateは実測サンプル（2026年3〜9月の複数item）全件で+00:00固定（BOCは年間を通じUTC表記で
// 統一しているとみられる）で明示的オフセット付きのためDST判定不要でJST直接換算できる
// （us_frb_speeches/gb_boe_speechesと同じ設計）。
// 講演の日程は事前公表される（実例: マックレム総裁の2026-09-21ハリファックス講演は9/19時点で
// 本フィードのdc:date=2026-09-21T11:20:45+00:00相当のitemとして既に掲載されていたことを
// config/manual-events.json[boc-speech-macklem-2026-09-21]の裏取りで確認済み）ため、
// FRB（講演実施後にのみ追加される設計）とは異なり事前検出が可能。
// 複数話者（cb:personが複数、例: 金融システムレビュー記者会見でSenior Deputy Governor＋
// Deputy Governorが同時登壇）の場合は先頭のcb:personのみを話者として採用する（共同記者会見は
// 稀なケースであり、本ソースの主目的である総裁個人の講演検出を優先した単純化。全話者を個別
// イベント化すると同一の実イベントが複数件の台帳イベントとして重複しかねないため採用しない）。

function extractBocSpeeches(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    if (!/LocatedAnnouncement/.test(block)) continue;
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
    return { ok: false, reason: 'content_type/speeches/feed/にLocatedAnnouncement（cb:speech）を持つ<item>が1件も見つからない。フィード構造変化の疑い' };
  }
  return { ok: true, items };
}

module.exports = { extractBocSpeeches };
