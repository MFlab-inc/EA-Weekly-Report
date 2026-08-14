'use strict';
// BOC（カナダ銀行）政策金利発表カレンダーの抽出（task #19）。
// upcoming_events.htmlは<article class="media" id='post-NNNNNN'>...</article>の
// ローリング約4ヶ月先までの催事一覧（FRB/ECB/BOEのような年次一括公表ページではない）。
// 実データ確認（2026-08-15）: <span class='...media-date pull-right'>{Month D, YYYY}</span>、
// <h3 class="media-heading"><a>{タイトル}</a></h3>、<div class='media-excerpt'>に
// "{HH:MM} (ET)<br />..."という発表時刻テキストを持つ。「Interest Rate Announcement」
// （四半期報告を伴う回は「Interest Rate Announcement and Monetary Policy Report」）以外の
// 催事（Release: ...・Publication: ...・祝日等）は対象外として除外する。
// ローリング公開のため年次一括のannual_schedule_config型にはできず、weekly_scrape型で
// row.kindを抽出側で確定させる（SPEC §4.2の規則生成命名kind。event-names.json辞書照合は行わない）。

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// "August 21, 2026" -> "2026-08-21"
function parseBocDate(s) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  return `${m[3]}-${pad2(month)}-${pad2(Number(m[2]))}`;
}

function extractBocPolicyRateSchedule(html) {
  const blockRe = /<article class="media" id='post-\d+'>([\s\S]*?)<\/article>/g;
  const rows = [];
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];
    const dateM = /media-date pull-right'>([^<]+)</.exec(block);
    const titleM = /<h3 class="media-heading">\s*<a[^>]*>([^<]+)<\/a>/.exec(block);
    if (!dateM || !titleM) continue;
    const title = titleM[1].trim();
    if (!/^Interest Rate Announcement\b/.test(title)) continue;
    const date = parseBocDate(dateM[1]);
    if (!date) continue;
    const timeM = /(\d{1,2}:\d{2})\s*\(ET\)/.exec(block);
    const localTime = timeM ? timeM[1] : null;
    if (!localTime) continue;
    rows.push({ title, date, localTime, kind: 'policy_rate' });
    if (/Monetary Policy Report/i.test(title)) {
      rows.push({ title, date, localTime, kind: 'quarterly_report' });
    }
  }
  if (rows.length === 0) {
    return { ok: false, reason: '「Interest Rate Announcement」催事が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, rows };
}

module.exports = { extractBocPolicyRateSchedule, parseBocDate };
