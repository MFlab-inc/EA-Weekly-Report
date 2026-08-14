'use strict';
// 期待カバレッジ表の検証（純粋関数。SPEC設計判断、task #19・docs/coverage-gap-2026-08-15.md）。
// 「担当ソースが無いkindはフェールクローズのHOLD/WARNすら発動せずサイレント欠落する」という
// しょうさん指摘への対処。FF突合は実行時にnextweekが存在せず使えないため、コミット/CI時点で
// 静的に「国×イベント種別」の担当ソース有無を検査する（config/expected-coverage.json参照）。

// active/draft_schedule状態のソースのみ「充足」とみなす。pending_reconはrunChecks()側で
// skip扱い（実質何もチェックしない）のため、カバレッジがあるとはみなさない
const COVERING_STATUSES = new Set(['active', 'draft_schedule']);

// officials.json由来のderived_rulesから、必要な{country, kind, note}の一覧を導出する
function deriveRequiredCoverage(officials, expectedCoverageConfig) {
  const required = [];
  for (const rule of expectedCoverageConfig.derived_rules || []) {
    const matches = (officials.officials || []).filter((o) => o.role_type === rule.officials_role_type);
    for (const o of matches) {
      if (!o.country) continue; // country未設定の役職は導出対象外（設定漏れ。別途スキーマ検証で拾う想定）
      required.push({ country: o.country, kind: rule.required_kind, note: `${o.role_ja}（${rule.name}）` });
    }
  }
  for (const extra of expectedCoverageConfig.additional_required || []) {
    required.push({ country: extra.country, kind: extra.kind, note: extra.note || '(additional_required)' });
  }
  return required;
}

// official-sources.jsonに{country, kind}を充足するactive/draft_scheduleソースが存在するか
function isCovered(sourcesConfig, country, kind) {
  return (sourcesConfig.sources || []).some(
    (s) => s.country === country && (s.kinds || []).includes(kind) && COVERING_STATUSES.has(s.status)
  );
}

// 戻り値: { ok, required: [...], missing: [{country, kind, note}] }
function validateExpectedCoverage(sourcesConfig, officials, expectedCoverageConfig) {
  const required = deriveRequiredCoverage(officials, expectedCoverageConfig);
  const missing = required.filter((r) => !isCovered(sourcesConfig, r.country, r.kind));
  return { ok: missing.length === 0, required, missing };
}

module.exports = { deriveRequiredCoverage, isCovered, validateExpectedCoverage, COVERING_STATUSES };
