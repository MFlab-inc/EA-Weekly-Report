'use strict';
// config/event-names.json のmatchキーワードを使い、抽出元の生タイトル文字列から
// 日本語正規名エントリを解決する（SPEC §4.2）。未登録は呼び出し側でWARN＋掲載除外とする
// （このモジュールはnullを返すのみで、掲載除外の判断自体は行わない）。

// entries: config/event-names.json の entries 配列
// country/kind: 対象の国・種別（呼び出し側が抽出元のkinds等から特定して渡す）
// rawTitle: 抽出元の生タイトル文字列（大文字小文字は問わない）
function findEventName(entries, country, kind, rawTitle) {
  const titleLower = (rawTitle || '').toLowerCase();
  const candidates = (entries || []).filter((e) => e.country === country && e.kind === kind);
  for (const c of candidates) {
    if ((c.match || []).some((k) => titleLower.includes(k.toLowerCase()))) {
      return c;
    }
  }
  return null;
}

module.exports = { findEventName };
