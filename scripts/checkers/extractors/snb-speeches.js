'use strict';
// SNB（スイス国民銀行）講演専用RSS（public/rss/en/speeches）の抽出ルール
// （config/official-sources.json snb_speeches）。task #72（2026-09-19）。
// 既存のsnb_policy_rate（event-scheduleページ、policy_rate/press_conference/opinions_summaryの
// みが対象）とは別ソース。一般講演（総裁講演等）はevent-scheduleページには不定期・不統一な
// 書式でしか載らないため（実測確認: "Speech by {name} and {name}, '{title}'"形式が稀に混在する
// 程度）、専用の講演RSS（RSS 2.0 + Central Bank Wiki拡張cb:名前空間）を別途使う。
// 実データ構造（2026-09-19実測、live fetch）: <cb:nameAsWritten>・<cb:jobTitle>が" / "区切りの
// 並行リストで複数話者を表現する（例: 記者会見の総裁+副総裁+委員3名連名イントロで
// "Martin Schlegel / Antoine Martin / Petra Tschudin"のように並ぶ）。BOEと異なり役職自体が
// フィールドで明示されるため、姓の突合による格の判定は不要だが、他行の講演抽出（BOC/ECB）と
// 設計を揃えるため、speakerLastNameには先頭の話者フルネームのみを渡す（複数話者の場合、
// 2人目以降は捨てる単純化）。
// cb:occurrenceDate（dc:dateと重複）はISO8601・Z（UTC）固定（実測10件全てZ終端）のため
// DST判定不要でJST直接換算できる。
// SNBのGoverning Board（金融政策を担う理事会）以外の関係者（Bank Council＝監督機関、実測で
// 混在を確認済み）を誤って含めないよう、cb:jobTitleに"Governing Board"を含む話者のitemのみを
// 対象とする（Chairman of the Governing Board / Vice Chairman of the Governing Board /
// Member of the Governing Boardのいずれか）。

function extractSnbSpeeches(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const titleM = /<title>([^<]*)<\/title>/.exec(block);
    const dateM = /<cb:occurrenceDate>([^<]+)<\/cb:occurrenceDate>/.exec(block);
    const nameM = /<cb:nameAsWritten>([^<]+)<\/cb:nameAsWritten>/.exec(block);
    const jobM = /<cb:jobTitle>([^<]+)<\/cb:jobTitle>/.exec(block);
    if (!titleM || !dateM || !nameM || !jobM) continue;
    const firstJobTitle = jobM[1].split('/')[0].trim();
    if (!/Governing Board/.test(firstJobTitle)) continue;
    const firstName = nameM[1].split('/')[0].trim();
    items.push({
      speakerLastName: firstName,
      title: titleM[1].trim(),
      pubDateRaw: dateM[1].trim(),
    });
  }
  if (items.length === 0) {
    return { ok: false, reason: 'public/rss/en/speechesにGoverning Board話者のcb:speechを持つ<item>が1件も見つからない。フィード構造変化の疑い' };
  }
  return { ok: true, items };
}

module.exports = { extractSnbSpeeches };
