'use strict';
// naming.js/build-ledger.jsの国別命名辞書（BANK_ABBR_BY_COUNTRY・MINUTES_SUMMARY_NAME_BY_COUNTRY・
// OFFICIAL_SPEECH_ROLE_BY_COUNTRY）が、config/official-sources.jsonの実登録ソースに対して
// 欠落していないかを検証する（task #56、しょうさん指示2026-08-16: 「EUR:nullバグ・DEDEバグと
// 同種の通貨コード・国コードのマッピング漏れが他にないか点検してほしい」への対応）。
//
// validate-country-currency-coverage.jsの対象（CURRENCY_BY_COUNTRY/COUNTRY_JA_BY_ISO）と異なり、
// これらの辞書は「登録済み全国」を必須とするものではなく「該当kindを持つソースが実際に
// 登録されている国」のみが対象（例: policy_rateソースを持たない国にBANK_ABBR_BY_COUNTRYの
// エントリは不要）。またフォールバック自体は安全（build-ledger.jsのresolveRuleGeneratedNameが
// 明示的にnullを返し、FALLBACK_KIND_LABELの汎用ラベルへ落ちるだけで生コード漏れにはならない）。
// ただしこの安全なフォールバックゆえに、新しい中銀国（policy_rate/minutes_summary/
// official_speechソース）が追加された際に辞書への追加を忘れても、HOLD・WARNにならず表示名が
// 静かに汎用ラベルへ劣化するだけで気づかれない。この検出網を追加する。
const COVERING_STATUSES = new Set(['active', 'draft_schedule']);

// sourcesConfig.sourcesから、指定kindを持つ(active/draft_schedule)ソースのcountry集合を導出する
function countriesWithKind(sourcesConfig, kind) {
  const countries = new Set();
  for (const s of sourcesConfig.sources || []) {
    if (!COVERING_STATUSES.has(s.status)) continue;
    if ((s.kinds || []).includes(kind)) countries.add(s.country);
  }
  return [...countries].sort();
}

// requiredCountries全てがdict（{country: value}形式）にキーとして存在するかを検証する。
// excludeCountries: 別ロジックで命名される国（例: minutes_summaryのJP=BOJ専用テンプレート
// naming.bojMinutesName）を対象から除外する
function missingCountriesInDict(requiredCountries, dict, { excludeCountries = [] } = {}) {
  const excluded = new Set(excludeCountries);
  return requiredCountries.filter((c) => !excluded.has(c) && !(c in (dict || {})));
}

module.exports = { COVERING_STATUSES, countriesWithKind, missingCountriesInDict };
