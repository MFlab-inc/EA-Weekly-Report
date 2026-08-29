'use strict';
// Stats NZ「Release calendar」ICS書き出し（config/official-sources.json nz_stats_calendar、
// www.stats.govt.nz/release-calendar/calendar-export?month={M}&year={Y}）の抽出ルール。
// 2026-08-22実測（nz-stats-api-recon一時ワークフロー、task #66/#70しょうさん指示）:
// release-calendarページ自体はJS描画のため生HTMLからは内容を取得できなかったが（task #15/#66既知の
// 構造的ブロッカー）、同ページが呼び出すcalendar-exportエンドポイントはtext/calendarのICSファイルを
// 直接返し、月・年をクエリパラメータで指定できることを新規発見した（旧・廃止済みのopen data API
// [api.stats.govt.nz、2024-08-30閉鎖]とは別物）。VEVENTごとの実データ形式:
//   BEGIN:VEVENT
//   DTSTART;TZID=Pacific/Auckland:20260824T104500
//   SUMMARY:Retail trade survey: June 2026 quarter
//   END:VEVENT
// 1ファイルにStats NZの全リリース種別（小売売上高以外にも運輸統計・酒類統計等多数）が混在するため、
// row.kindは確定せずevent-names.jsonのmatchキーワードによるclassifyRowKind絞り込みに委ねる。

// RFC5545の行折り返し（継続行は単一の空白/タブで始まる）を1行へ結合する
function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

// ics: calendar-exportの生テキスト
// 戻り値: { ok: true, rows: [{ title, date, localTime }] } または { ok: false, reason }
// localTimeはICSのTZID（実測では常にPacific/Auckland）に基づく現地時刻。tz変換自体は
// harness.mjs側（source.announce_time_by_kind経由のctx.tz）が担うため、本抽出はtzを返さない
function extractNzStatsCalendar(ics) {
  const unfolded = unfoldIcs(ics);
  const rows = [];
  const eventRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m;
  while ((m = eventRe.exec(unfolded))) {
    const block = m[1];
    const dtStartM = /DTSTART;TZID=[^:]+:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(block);
    const summaryM = /SUMMARY:([^\r\n]+)/.exec(block);
    if (!dtStartM || !summaryM) continue;
    const [, y, mo, d, h, mi] = dtStartM;
    rows.push({
      title: summaryM[1].trim(),
      date: `${y}-${mo}-${d}`,
      localTime: `${h}:${mi}`,
    });
  }
  if (rows.length === 0) {
    return { ok: false, reason: 'calendar-exportのVEVENT要素が1件も見つからない。ICS構造変化の疑い' };
  }
  return { ok: true, rows };
}

module.exports = { extractNzStatsCalendar };
