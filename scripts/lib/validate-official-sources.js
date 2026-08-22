'use strict';
// config/official-sources.json の形状検証（純粋関数）。CIでの設定ミス検知用。
const VALID_TYPES = ['date_api_fred', 'weekly_scrape', 'annual_schedule_config'];
const VALID_STATUS = ['active', 'draft_schedule', 'pending_recon'];
// bond_auctionは既刊ground truthで一貫して時刻未公表（time:null）のkindのため、
// announce_time_by_kindの必須要件から除外する（SPEC report-policy.jsonのno_time_note参照）
const TIME_EXEMPT_KINDS = new Set(['bond_auction']);
// access.provides_exact_time:true のソース（例: RSS pubDate・ABS/ONSのtime属性）は
// 抽出結果自体が絶対時刻を持つため、config固定時刻（announce_time_by_kind）を必須としない

function validateOfficialSources(config) {
  const errors = [];
  if (!config || !Array.isArray(config.sources)) {
    return ['sources配列が存在しません'];
  }
  const seenIds = new Set();
  for (const s of config.sources) {
    const tag = `[${s.id || '(id無し)'}]`;
    if (!s.id) errors.push(`${tag} idが必須です`);
    if (seenIds.has(s.id)) errors.push(`${tag} id重複`);
    seenIds.add(s.id);
    if (!s.name_ja) errors.push(`${tag} name_jaが必須です`);
    if (!VALID_STATUS.includes(s.status)) errors.push(`${tag} status不正: ${s.status}`);
    if (!VALID_TYPES.includes(s.type)) errors.push(`${tag} type不正: ${s.type}`);
    if (!Array.isArray(s.kinds) || s.kinds.length === 0) errors.push(`${tag} kindsは1件以上必要`);

    if (s.type === 'date_api_fred') {
      if (!s.fred || !s.fred.api_base) errors.push(`${tag} fred.api_baseが必須です`);
      if (!s.fred || !Array.isArray(s.fred.releases) || s.fred.releases.length === 0) errors.push(`${tag} fred.releasesは1件以上必要`);
    }
    if (s.type === 'annual_schedule_config') {
      if (!Array.isArray(s.schedule)) errors.push(`${tag} scheduleは配列が必須です（空配列可）`);
      if (typeof s.residual_monitor_weeks !== 'number') errors.push(`${tag} residual_monitor_weeksが必須です`);
    }
    if (s.type === 'weekly_scrape' && s.status !== 'pending_recon') {
      if (!s.access || !Array.isArray(s.access.targets)) errors.push(`${tag} access.targetsが必須です`);
    }
    for (const kind of s.kinds || []) {
      const hasTime = s.announce_time_by_kind && s.announce_time_by_kind[kind];
      const isAnnualOrPending =
        s.type === 'annual_schedule_config' ||
        s.status === 'pending_recon' ||
        TIME_EXEMPT_KINDS.has(kind) ||
        s.access?.provides_exact_time === true;
      if (!hasTime && !isAnnualOrPending) {
        errors.push(`${tag} kind="${kind}" のannounce_time_by_kindが未設定`);
      }
      // provides_exact_time:true のソース（例: jp_boj_speeches）はtoRow側が行ごとに個別のlocalTimeを
      // 供給するため、config固定値のlocal_timeは不要（tzのみ必須。ゾーン変換に使うため）。
      // 2026-08-22追加（task #64）: 従来はhasTime設定時にlocal_time/tzを常に両方必須としていたが、
      // us_frb_speeches（utcInstant・announce_time_by_kind自体が空）とは異なる「tzのみ必要」な
      // 中間パターンが新たに生じたため区別した
      if (hasTime) {
        const localTimeRequired = s.access?.provides_exact_time !== true;
        if (!hasTime.tz || (localTimeRequired && !hasTime.local_time)) {
          errors.push(`${tag} kind="${kind}" のannounce_time_by_kindにlocal_time/tzが必要`);
        }
      }
    }
  }
  return errors;
}

module.exports = { validateOfficialSources, TIME_EXEMPT_KINDS };
