'use strict';
// config/importance-rules.json による重要度解決（SPEC §4.3）。country_overridesが
// importance_by_kindの既定値より優先する。

function resolveImportance(kind, country, importanceRules) {
  const override = (importanceRules?.country_overrides || []).find((o) => o.kind === kind && o.country === country);
  if (override) return override.importance;
  const base = importanceRules?.importance_by_kind?.[kind];
  return typeof base === 'number' ? base : null;
}

module.exports = { resolveImportance };
