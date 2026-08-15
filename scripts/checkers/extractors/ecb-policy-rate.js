'use strict';
// ECB（Governing Council）政策金利カレンダーの抽出（task #19）。
// gc_calendar.htmlは<dt>DD/MM/YYYY</dt><dd>説明</dd>の定義リスト構造。
// 金融政策会合は2日制（Day 1→Day 2, followed by press conference）で、
// 政策金利発表・記者会見は「Day 2, followed by press conference」の日に行われる。
// 非金融政策会合（non-monetary policy meeting）・General Council会合は対象外。
// 実データ確認（2026-08-15）: 2027年通年で年8回の金融政策会合パターンを確認
// （WebSearchで得た「2026年7回」という要約は不正確だった。生データを正とする）。

function pad2(n) {
  return String(n).padStart(2, '0');
}

// "DD/MM/YYYY" -> "YYYY-MM-DD"
function parseEcbDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function extractEcbPolicyRateSchedule(html) {
  const re = /<dt>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/dt>\s*<dd>\s*(.*?)\s*<br>/gs;
  const entries = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const desc = m[2].replace(/\s+/g, ' ').trim();
    if (!/monetary policy meeting/i.test(desc)) continue;
    if (!/Day 2.*followed by press conference/i.test(desc)) continue;
    const date = parseEcbDate(m[1]);
    if (!date) continue;
    entries.push({ date, kind: 'policy_rate' });
    entries.push({ date, kind: 'press_conference' });
  }
  if (entries.length === 0) {
    return { ok: false, reason: '金融政策会合（Day 2, followed by press conference）の日程が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, entries };
}

module.exports = { extractEcbPolicyRateSchedule, parseEcbDate };
