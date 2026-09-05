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
//
// 2026-09-06追加（task #93、しょうさん指示: Manus突合廃止に伴う欠落検知強化の1点目
// 「FF突合の欠落検出への拡張」）: 上記の突合は「台帳の各イベント→FFに時刻一致するものがあるか」
// という一方向のみで、逆方向（「FFの各イベント→台帳に対応するものがあるか」）は検査していなかった。
// この逆方向こそが、このセッション中に繰り返し発生した「担当ソースの不具合で完全に無警告のまま
// イベントが抜け落ちる」クラスのバグ（BOJ月境界バグ・RBNZ/BOC記者会見・米新規失業保険申請件数・
// 英月次GDP等）を独立に検出できる唯一の仕組みになる。Manus突合を廃止する以上、これが実質的な
// 最後の安全網となるため新設した（findMissingHighImpactFfEvents参照）。
// FF側のimpact値をそのまま重要度に採用しない設計方針（docs/phase0-findings.md項目3
// 「FFのimpact値は本レポートの重要度に使えない」）は維持しつつ、「Highに分類されるほど
// 目立つイベントなのに、台帳に対応するkindのイベントが1件も無い」という粗い一致判定にのみ
// impact値を使う（ノイズ源になりやすいMedium/Lowは対象外とし、既知の高い誤検知率を避ける）。
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
  jobless_claims: ['Unemployment Claims', 'Jobless Claims'],
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

function countriesForCurrency(currency) {
  return Object.entries(CURRENCY_BY_COUNTRY)
    .filter(([, c]) => c === currency)
    .map(([country]) => country);
}

// FF側でimpact="High"のイベントについて、台帳（ledgerEvents）に対応するkindのイベントが
// 同じ日付に1件も無いものを検出する（task #93）。通貨→国の変換はcurrency=EUR等、複数国
// （EU/DE）に対応しうるためmatchesCountryQualifierで絞り込む（forward方向のEU/DE判定と
// 同じロジックをそのまま逆方向に転用）。
// 戻り値:
//   missingRecognizedKind: 通貨・kindとも認識できるのに台帳に対応イベントが無い（実害あり得る、
//     呼び出し側で run失敗の対象とする）
//   unrecognizedKind: 通貨は追跡対象だがKIND_KEYWORDSのどれにも一致しない（このプロジェクトが
//     そもそもモデル化していないイベント種別の可能性がある。ノイズ源になりうるため run失敗には
//     せず、レポートへの記載のみに留める）
function findMissingHighImpactFfEvents(ledgerEvents, ffEvents) {
  const missingRecognizedKind = [];
  const unrecognizedKind = [];
  for (const ff of ffEvents) {
    if (ff.impact !== 'High') continue;
    const countries = countriesForCurrency(ff.currency);
    if (countries.length === 0) continue; // このプロジェクトが追跡していない通貨
    const applicableCountries = countries.filter((c) => matchesCountryQualifier(ff.title, c));
    if (applicableCountries.length === 0) continue; // どの国修飾語にも一致しない表記ゆれ等（ノイズ回避のためスキップ）

    const matchedKinds = Object.keys(KIND_KEYWORDS).filter((k) => titleMatchesKind(ff.title, k));
    if (matchedKinds.length === 0) {
      unrecognizedKind.push({ jst_date: ff.jstDate, jst_time: ff.jstTime, currency: ff.currency, title: ff.title });
      continue;
    }
    const hasLedgerEvent = applicableCountries.some((country) =>
      matchedKinds.some((kind) => ledgerEvents.some((ev) => ev.country === country && ev.kind === kind && ev.dateJst === ff.jstDate))
    );
    if (!hasLedgerEvent) {
      missingRecognizedKind.push({
        jst_date: ff.jstDate,
        jst_time: ff.jstTime,
        currency: ff.currency,
        title: ff.title,
        matched_kinds: matchedKinds,
        applicable_countries: applicableCountries,
      });
    }
  }
  return { missingRecognizedKind, unrecognizedKind };
}

module.exports = { KIND_KEYWORDS, titleMatchesKind, matchesCountryQualifier, findFfCandidates, crossCheck, findMissingHighImpactFfEvents };
