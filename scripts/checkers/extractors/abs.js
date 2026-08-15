'use strict';
// 豪州統計局（ABS）future-releases-calendar.htmlの抽出ルール（config/official-sources.json au_abs）。
// 実データ構造（2026-08-14実測fixtureで確認）:
//   <strong class="event-name">タイトル</strong> ... <time datetime="ISO8601（UTC）" class="datetime">現地表示時刻</time>
// datetime属性がUTC ISO8601で確定値のため、これを正として使う（現地表示時刻はUIラベルのみ）。
const ROW_RE = /<strong class="event-name">\s*([^<]+?)\s*<\/strong>[\s\S]*?<time datetime="([^"]+)"/g;

// html: future-releases-calendar.htmlの生テキスト
// 戻り値: { ok: true, rows: [{ title, utcInstant: 'ISO8601' }] } または { ok: false, reason }
function extractAbsCalendar(html) {
  const rows = [];
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html))) {
    rows.push({ title: m[1].trim(), utcInstant: m[2] });
  }
  if (rows.length === 0) {
    return { ok: false, reason: 'future-releases-calendar.htmlのevent-name/time要素が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, rows };
}

module.exports = { extractAbsCalendar };
