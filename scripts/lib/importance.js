'use strict';
// config/importance-rules.json による重要度解決（SPEC §4.3）。country_overridesが
// importance_by_kindの既定値より優先する。
//
// subtype引数（2026-09-19新設、しょうさん指示: 米フラッシュPMI追加に伴う衝突回避）:
// 同一country×kindに複数のsubtypeが同居し、片方だけ重要度を変えたいケースに対応する
// （実例: US×pmi_ism は既にISM向けに country_overrides で★★★昇格済みだが、同じUS×pmi_ism
// kindを使う新設の米フラッシュPMI[subtype:flash]はDE/EU/GBフラッシュPMIと同じ理由で★★据え置きが
// 必要）。country_overridesにsubtypeフィールドを持つエントリを先に探し、無ければ従来どおり
// subtypeフィールドを持たない国×kind単位のエントリにフォールバックする（既存の呼び出し側・
// 既存configはsubtype省略時と完全に同じ挙動を維持する後方互換設計）
function resolveImportance(kind, country, importanceRules, subtype) {
  const overrides = importanceRules?.country_overrides || [];
  if (subtype) {
    const specific = overrides.find((o) => o.kind === kind && o.country === country && o.subtype === subtype);
    if (specific) return specific.importance;
  }
  const general = overrides.find((o) => o.kind === kind && o.country === country && !o.subtype);
  if (general) return general.importance;
  const base = importanceRules?.importance_by_kind?.[kind];
  return typeof base === 'number' ? base : null;
}

module.exports = { resolveImportance };
