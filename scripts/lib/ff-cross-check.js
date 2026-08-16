'use strict';
// SPEC §3.3「月曜事後突合」の実装（task #39、2026-08-17に対象週(8/17週)の実データで
// 初回実行し動作確認済み）。配信済み台帳（data/ledger/）とFFフィード
// （ff_calendar_thisweek.json、月曜朝の時点では対象週分を指す。task #2実測で確認済み）を
// 突き合わせ、同一と判定できるイベントの発表時刻に相違があれば discrepancy-report.json を
// 出力する（SPEC §3.3: 相違ゼロ→静かに成功、相違あり→discrepancy-report.json出力＋run失敗）。
//
// 用途はあくまで「FFにも載っている予定と時刻がズレていないか」の確認。FF側の未収録
// （発言系の欠落・低インパクト指標の非掲載等、Phase 0実測docs/phase0-findings.md項目3で
// 判明済みの既知の限界）はdiscrepancy扱いにしない（HOLDにもしない。公式ソースチェッカーが
// 一次情報源であり、FFは補助という設計のため）。
const { CURRENCY_BY_COUNTRY } = require('./build-ledger');

// kind別にFFタイトルへ現れやすいキーワード（部分一致・大小無視、いずれか1つでも含めばヒット）。
// 完全一致の照合表ではなく緩やかなヒント（FFのタイトル表記は発表元により揺れるため）
const KIND_KEYWORDS = {
  gdp: ['GDP'],
  cpi: ['CPI'],
  ppi: ['PPI'],
  retail_sales: ['Retail Sales'],
  employment_situation: ['Unemployment Rate', 'Employment Change', 'Claimant Count', 'Employment Situation', 'Non-Farm', 'Nonfarm'],
  employment_indicator: ['JOLTS', 'ADP'],
  trade_balance: ['Trade Balance'],
  sentiment: ['ZEW', 'Sentiment', 'Confidence'],
  pmi_ism: ['PMI', 'ISM'],
  industrial_production: ['Industrial Production'],
  minutes_summary: ['Minutes'],
  opinions_summary: ['Summary of Opinions', 'Opinions'],
  bond_auction: ['Bond Auction'],
  policy_rate: ['Rate Statement', 'Cash Rate', 'Official Bank Rate', 'Interest Rate Decision', 'Overnight Rate', 'Policy Rate'],
  press_conference: ['Press Conference'],
  official_speech: ['Speaks'],
  testimony: ['Testimony', 'Hearing'],
  quarterly_report: ['Monetary Policy Report', 'Quarterly'],
};

function titleMatchesKind(title, kind) {
  const keywords = KIND_KEYWORDS[kind] || [];
  return keywords.some((k) => title.toLowerCase().includes(k.toLowerCase()));
}

// DE固有イベント（ledger country=DE）はFFタイトルに'German'を含むもののみ対象とする。
// EU集計イベント（ledger country=EU）はタイトルに主要国の国名接頭辞が無いもののみ対象とする
// （FF実運用: ユーロ圏集計値は無接頭辞、加盟国別値は国名接頭辞付きで別行。task #53調査で確認）。
// それ以外の国はFFのcountry（通貨）フィルタのみで一意に絞り込めるため常にtrue
function matchesCountryQualifier(title, ledgerCountry) {
  const hasEuroAreaCountryPrefix = /\b(German|France|French|Italy|Italian|Spain|Spanish)\b/i.test(title);
  if (ledgerCountry === 'DE') return /\bGerman\b/i.test(title);
  if (ledgerCountry === 'EU') return !hasEuroAreaCountryPrefix;
  return true;
}

// ffEvents: [{ jstDate: 'YYYY-MM-DD', jstTime: 'HH:MM', currency: 'USD'等, title }]
function findFfCandidates(ledgerEvent, ffEvents) {
  const currency = CURRENCY_BY_COUNTRY[ledgerEvent.country];
  if (!currency) return [];
  return ffEvents.filter(
    (e) =>
      e.currency === currency &&
      e.jstDate === ledgerEvent.dateJst &&
      titleMatchesKind(e.title, ledgerEvent.kind) &&
      matchesCountryQualifier(e.title, ledgerEvent.country)
  );
}

// ledgerEvents: [{ eventId, nameJa, country, kind, dateJst, datetimeJst, timeStatus }]
// 戻り値: { matched, discrepancies, notFoundInFf }
// time_status=unpublished（datetimeJst無し）のイベントは比較対象外（時刻自体が無いため）
function crossCheck(ledgerEvents, ffEvents) {
  const matched = [];
  const discrepancies = [];
  const notFoundInFf = [];
  for (const ev of ledgerEvents) {
    if (ev.timeStatus !== 'published' || !ev.datetimeJst) continue;
    const candidates = findFfCandidates(ev, ffEvents);
    if (candidates.length === 0) {
      notFoundInFf.push(ev);
      continue;
    }
    const ledgerTime = ev.datetimeJst.slice(11, 16);
    const ffTimes = [...new Set(candidates.map((c) => c.jstTime))];
    if (ffTimes.includes(ledgerTime)) {
      matched.push({ ...ev, ff_time_jst: ledgerTime });
    } else {
      discrepancies.push({
        event_id: ev.eventId,
        name_ja: ev.nameJa,
        country: ev.country,
        date_jst: ev.dateJst,
        ledger_time_jst: ledgerTime,
        ff_time_jst_candidates: ffTimes,
        ff_titles: [...new Set(candidates.map((c) => c.title))],
      });
    }
  }
  return { matched, discrepancies, notFoundInFf };
}

module.exports = { KIND_KEYWORDS, titleMatchesKind, matchesCountryQualifier, findFfCandidates, crossCheck };
