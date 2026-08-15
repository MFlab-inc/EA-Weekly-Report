'use strict';
// SNB（スイス国民銀行）「Time schedule」ページの金融政策関連イベント抽出（2026-08-15、しょうさん一次ソース訂正対応）。
// event-scheduleページ本文には「DD.MM.YYYY HH:MM タイトル」形式の平文リストが埋め込まれており、
// 各行には個別iCalendarファイル（snb.ch/public/ical/event/en/{uuid}.ics）へのリンクが付属する
// （実測確認2026-08-15: 94件のICSリンクを発見、サンプル3件とも有効なVCALENDAR、
// X-WR-TIMEZONE:Europe/Zurich・REFRESH-INTERVAL:PT6H）。ただしICS個別取得は94件と多く週次には
// 非効率（かつUUID→イベント対応がDOM順とズレるためUUID経由での特定は不安定）なため、
// 本抽出は同じ公式データソースであるこのHTML本文の平文リストを直接パースする方式を採用する
// （BOC等、既存の他ソースと同じ設計。ICSの実在確認はこのページ自体が公式・機械可読であることの
// 裏付けとして扱う）。
//
// 対象イベント種別（しょうさん転記の実測データと完全一致確認済み）:
// - "Monetary policy assessment of {date} (press release)" → kind=policy_rate（09:30 Europe/Zurich）
// - "Monetary policy assessment of {date} (introductory remarks, news conference)" → kind=press_conference（10:00）
// - "Summary of monetary policy discussion" → kind=opinions_summary（09:30。日銀『主な意見』相当）

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#65279;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

// "DD.MM.YYYY HH:MM タイトル"（次の日付行の直前まで）を1エントリとして抽出する
const DATE_ROW_RE = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})\s+([\s\S]*?)(?=\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}|$)/g;

function classifyTitle(title) {
  if (/^Monetary policy assessment.*\(press release\)/i.test(title)) return 'policy_rate';
  if (/^Monetary policy assessment.*(introductory remarks|news conference)/i.test(title)) return 'press_conference';
  if (/^Summary of monetary policy discussion/i.test(title)) return 'opinions_summary';
  return null;
}

function extractSnbEvents(html) {
  const text = decodeEntities(stripTags(html));
  const rows = [];
  let m;
  while ((m = DATE_ROW_RE.exec(text)) !== null) {
    const [, dd, mo, yyyy, hh, mi, titleRaw] = m;
    const title = titleRaw.trim();
    if (!title) continue;
    const kind = classifyTitle(title);
    if (!kind) continue;
    rows.push({ title, date: `${yyyy}-${mo}-${dd}`, localTime: `${hh}:${mi}`, kind });
  }
  if (rows.length === 0) {
    return { ok: false, reason: '「Monetary policy assessment」「Summary of monetary policy discussion」のいずれも見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, rows };
}

module.exports = { extractSnbEvents, classifyTitle };
