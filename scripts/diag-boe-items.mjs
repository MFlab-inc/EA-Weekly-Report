// 一時調査用スクリプト（10/19週パイプライン失敗調査、しょうさん指示2026-10-17）。
// extractBoeCalendarが「表示ウィンドウ7日間隔」チェックで構造的失敗を返すため、
// 対象週(2026-10-19〜23)に実際にどんな予定が載っているかを見られない。本番コードは
// 一切変更せず、exportされているparseDeclaredWindow/buildWindowDates/parseBoeCalendarTimeを
// そのまま再利用し、本体の行解析ループ（extractBoeCalendar内部処理の複製、ガード2点のみ
// スキップ）で対象週の該当行を直接確認する。調査終了後に削除する。
import { readFileSync } from 'node:fs';
const mod = await import('./checkers/extractors/boe-calendar.js');
const { parseDeclaredWindow, buildWindowDates, parseBoeCalendarTime } = mod.default ?? mod;

const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; checker-harness)';
const res = await fetch('https://www.bankofengland.co.uk/events/upcoming-events', { headers: { 'User-Agent': UA } });
const body = await res.text();

const window_ = parseDeclaredWindow(body);
console.log('declared window:', window_);
const windowDates = buildWindowDates(window_.monday1);
console.log('windowDates:', windowDates);

const startIdx = body.indexOf('<div class="page-content"');
const endIdx = body.indexOf('<h2>Upcoming key publications</h2>');
const section = body.slice(startIdx, endIdx);

const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
const WEEKDAY_RE = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const HEADING_EXACT_RE = new RegExp(`^${WEEKDAY_RE} (\\d{1,2}) (${MONTH_RE})$`);
const SPEAKER_LINE_RE = /^((?:[A-Z][a-zA-Z'’]*\.?\s+){1,2}[A-Z][a-zA-Z'’]*)\s*:\s*(.+)$/;
const BLOCK_RE = /<(h3|p)[^>]*>([\s\S]*?)<\/\1>/g;

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lsquo;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function stripTags(html) { return html.replace(/<[^>]+>/g, ' '); }
function cleanText(html) { return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim(); }
function findDateForHeading(wd, day, monthName) {
  const mm = MONTHS[monthName.toLowerCase()];
  if (!mm) return null;
  return wd.find((iso) => { const [, m, d] = iso.split('-').map(Number); return m === mm && d === day; }) || null;
}

const items = [];
let currentDate = null;
let m;
BLOCK_RE.lastIndex = 0;
while ((m = BLOCK_RE.exec(section))) {
  const text = cleanText(m[2]);
  if (!text) continue;
  const headingM = HEADING_EXACT_RE.exec(text);
  if (headingM) {
    currentDate = findDateForHeading(windowDates, Number(headingM[1]), headingM[2]);
    continue;
  }
  if (!currentDate) continue;
  const chunks = m[2].split(/<br\s*\/?>\s*<br\s*\/?>/i);
  for (const chunkHtml of chunks) {
    const chunkText = cleanText(chunkHtml);
    const speakerM = SPEAKER_LINE_RE.exec(chunkText);
    if (!speakerM) continue;
    const firstParenM = /\(([^)]*)\)/.exec(chunkText);
    const parenContent = firstParenM ? firstParenM[1] : null;
    items.push({ date: currentDate, speaker: speakerM[1].trim(), text: chunkText, paren: parenContent });
  }
}

console.log('=== ALL items (date + speaker) ===');
for (const it of items) console.log(it.date, '|', it.speaker, '|', it.paren);

console.log('\n=== items within target week 2026-10-19..2026-10-23 ===');
const targetItems = items.filter((it) => it.date >= '2026-10-19' && it.date <= '2026-10-23');
if (targetItems.length === 0) console.log('(none)');
for (const it of targetItems) console.log(JSON.stringify(it, null, 2));
