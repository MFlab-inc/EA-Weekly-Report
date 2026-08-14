#!/usr/bin/env node
// カバレッジ欠損の実測（2026-08-15、しょうさん指示）。
// 8/17週の候補が0件だった観測モード結果について、「その週にたまたま★★★が少ない」のか
// 「レジストリが既刊2週分の逆算構築のため構造的に検出できないイベント種別がある」のかを
// FFフィード（lastweek/thisweek/nextweek）と突き合わせて判定する。
// FF週境界の切替状況が未確定（task #2実測中）のため3週分すべて取得し、
// 8/17〜8/21のJST日付を含む週を実際に使う。
//
// 生データはphase1-out/にのみ保存（コミットしない）。アクセスは3リクエストのみ・1500ms間隔。
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; coverage-gap-check)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = {
  lastweek: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json',
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
};

// FFのcountryは通貨コード（USD/AUD等）、official-sources.jsonのcountryはISO国コード（US/AU等）。
// この不一致に気づかず初回実行で「全イベントに追跡ソース無し」という誤った結果を出したため
// （しょうさん指摘の前段階で自己発見）、明示的な対応表で変換する
const CURRENCY_TO_COUNTRY = {
  USD: 'US', JPY: 'JP', GBP: 'GB', AUD: 'AU', CAD: 'CA', NZD: 'NZ', CNY: 'CN', CHF: 'CH',
  EUR: null, // ユーロ圏は単一countryに対応しないため対象外（ECB等は別途要検討）
};

function jstDateTime(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d)) return null;
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  return { date: jst.toISOString().slice(0, 10), time: jst.toISOString().slice(11, 16) };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,*/*;q=0.8' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const text = await res.text();
  try {
    return { ok: true, status: res.status, events: JSON.parse(text) };
  } catch (e) {
    return { ok: false, status: res.status, parseError: String(e.message), bytes: text.length };
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const WEEK_START = '2026-08-17';
  const WEEK_END = '2026-08-21';

  const fetched = {};
  let first = true;
  for (const [name, url] of Object.entries(TARGETS)) {
    if (!first) await sleep(WAIT_MS);
    first = false;
    console.log(`fetching ${name}: ${url}`);
    fetched[name] = await fetchJson(url);
    console.log(`  -> ok=${fetched[name].ok} status=${fetched[name].status} events=${fetched[name].events?.length ?? 'n/a'}`);
  }

  const allEvents = [];
  for (const [name, r] of Object.entries(fetched)) {
    if (!r.ok || !Array.isArray(r.events)) continue;
    for (const e of r.events) {
      const jst = jstDateTime(e.date);
      if (!jst) continue;
      allEvents.push({ feedName: name, jstDate: jst.date, jstTime: jst.time, country: e.country, isoCountry: CURRENCY_TO_COUNTRY[e.country] ?? null, impact: e.impact, title: e.title });
    }
  }

  let inTargetWeek = allEvents.filter((e) => e.jstDate >= WEEK_START && e.jstDate <= WEEK_END);
  let usedFallbackWeek = false;
  let fallbackRange = null;
  if (inTargetWeek.length === 0) {
    // 対象週(8/17-21)がFFにまだ公開されていない場合（task #2実測中の境界問題）、
    // 現在取得できている週（thisweekフィードの実際の範囲）を構造的カバレッジ確認の
    // 代替データとして使う。週固有のイベント有無ではなく「kind種別の構造的欠落」の
    // 検証が目的のため、週がズレていても分析価値がある
    const thisweekEvents = allEvents.filter((e) => e.feedName === 'thisweek');
    if (thisweekEvents.length > 0) {
      usedFallbackWeek = true;
      const dates = thisweekEvents.map((e) => e.jstDate).sort();
      fallbackRange = { start: dates[0], end: dates[dates.length - 1] };
      inTargetWeek = thisweekEvents;
    }
  }
  // 重複除去（複数フィードに同一イベントが重複掲載される場合がある）
  const seen = new Set();
  const dedup = inTargetWeek.filter((e) => {
    const key = `${e.jstDate}|${e.jstTime}|${e.country}|${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  dedup.sort((a, b) => `${a.jstDate}${a.jstTime}`.localeCompare(`${b.jstDate}${b.jstTime}`));

  // official-sources.jsonから「国別に何のkindを追跡しているか」の一覧を作る（statusを問わず全ソース）
  const sourcesConfig = JSON.parse(readFileSync('config/official-sources.json', 'utf8'));
  const kindsByCountry = {};
  for (const s of sourcesConfig.sources) {
    kindsByCountry[s.country] = kindsByCountry[s.country] || [];
    for (const k of s.kinds || []) {
      kindsByCountry[s.country].push({ kind: k, sourceId: s.id, status: s.status });
    }
  }

  const availableWeeks = Object.fromEntries(
    Object.entries(fetched).map(([name, r]) => [
      name,
      r.ok && Array.isArray(r.events) && r.events.length > 0
        ? { minDate: allEvents.filter((e) => e.feedName === name).map((e) => e.jstDate).sort()[0], maxDate: allEvents.filter((e) => e.feedName === name).map((e) => e.jstDate).sort().slice(-1)[0] }
        : null,
    ])
  );

  const result = {
    generatedAt: new Date().toISOString(),
    targetWeek: { start: WEEK_START, end: WEEK_END },
    fetchStatus: Object.fromEntries(Object.entries(fetched).map(([name, r]) => [name, { ok: r.ok, status: r.status, eventCount: r.events?.length }])),
    availableWeeksByFeed: availableWeeks,
    targetWeekFoundInAnyFeed: !usedFallbackWeek && dedup.length > 0,
    usedFallbackWeek,
    fallbackRange,
    ffEventsInAnalyzedWeek: dedup,
    kindsByCountry,
  };

  writeFileSync(`${OUT_DIR}/coverage-gap-check.json`, JSON.stringify(result, null, 2));

  if (usedFallbackWeek) {
    console.log(`\n(注) 対象週(${WEEK_START}〜${WEEK_END})はFFにまだ公開されていない（nextweek 404）。代替として現在公開中の週(${fallbackRange.start}〜${fallbackRange.end})で構造的カバレッジを確認する`);
  }
  console.log(`\n===== 分析対象週のFFイベント: ${dedup.length}件 =====`);
  for (const e of dedup) {
    const isoCountry = CURRENCY_TO_COUNTRY[e.country];
    const tracked = (kindsByCountry[isoCountry] || []).map((k) => `${k.kind}(${k.sourceId}/${k.status})`).join(', ') || (isoCountry ? '(追跡ソース無し)' : '(対応countryコード無し)');
    console.log(`- ${e.jstDate} ${e.jstTime} [${e.country}] impact=${e.impact} "${e.title}" | この国の追跡kind: ${tracked}`);
  }
  if (dedup.length === 0) {
    console.log('(対象週のデータがどのフィードにも見つからなかった可能性。availableWeeksByFeedを確認)');
    console.log(JSON.stringify(availableWeeks, null, 2));
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
