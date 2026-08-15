'use strict';
// config/official-sources.jsonに登場する全ての国が、レンダラー用の国名ピル辞書
// （scripts/render/ledger-to-week-input.jsのCOUNTRY_JA_BY_ISO）と台帳用の通貨コード辞書
// （scripts/lib/build-ledger.jsのCURRENCY_BY_COUNTRY）の両方に登録されているかを検証する
// （純粋関数。task #54、しょうさん指摘2026-08-15: DE国追加時にこの2つの並行dictへの
// 追加を漏らし、国名ピル・通貨ピルが生のISOコードのまま「DEDE」と二重表示された事故の
// 再発防止。両dictともフォールバックが「未登録なら生のISOコードをそのまま返す」設計のため、
// 登録漏れはHOLDにならず読者可視テキストへサイレントに漏れる）

// NZのみ意図的に日本語化せず「NZ」のまま表示する既刊実例（ledger-to-week-input.js参照）。
// この1件のみ「countryJaByIso[country] === country」でも正当とみなす
const DEFAULT_RAW_CODE_ALLOWLIST = new Set(['NZ']);

// config/official-sources.jsonのsources[].countryから、実際に使われている国コードの集合を導出する
function collectRegistryCountries(sourcesConfig) {
  return [...new Set((sourcesConfig.sources || []).map((s) => s.country).filter(Boolean))];
}

// 戻り値: { ok, countries, missing: [{country, missingJa, missingCurrency, rawCodeLeak}] }
// rawCodeLeak: countryJaByIso[country]は登録されているが値が生のISOコードと同一（NZ以外での
// 「登録したつもりが誤って生コードを値にしてしまった」事故を検出する。countryJaOf()の
// フォールバック（未登録キー→生コードを返す）と結果的に同じ表示になるため、キーの有無だけを
// 見るmissingJaチェックでは捕捉できない）
function validateCountryCurrencyCoverage(sourcesConfig, countryJaByIso, currencyByCountry, { rawCodeAllowlist = DEFAULT_RAW_CODE_ALLOWLIST } = {}) {
  const countries = collectRegistryCountries(sourcesConfig);
  const missing = [];
  for (const country of countries) {
    const missingJa = !(country in (countryJaByIso || {}));
    const missingCurrency = !(country in (currencyByCountry || {}));
    const rawCodeLeak = !missingJa && countryJaByIso[country] === country && !rawCodeAllowlist.has(country);
    if (missingJa || missingCurrency || rawCodeLeak) missing.push({ country, missingJa, missingCurrency, rawCodeLeak });
  }
  return { ok: missing.length === 0, countries, missing };
}

module.exports = { collectRegistryCountries, validateCountryCurrencyCoverage, DEFAULT_RAW_CODE_ALLOWLIST };
