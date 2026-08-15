'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('collect: runChecksとbuildObservationSummaryを合成しtargetWeek/report/candidatesを返す', async () => {
  const { collect } = await import('../scripts/collect.mjs');
  const sourcesConfig = {
    sources: [
      { id: 'au_rba', country: 'AU', type: 'annual_schedule_config', schedule: [{ date: '2026-08-18', kind: 'policy_rate' }], announce_time_by_kind: { policy_rate: { local_time: '14:30', tz: 'Australia/Sydney' } } },
    ],
  };
  const importanceRules = { importance_by_kind: { policy_rate: 3 }, recurring_checks: [] };
  const targetWeek = { collectionDate: '2026-08-15', targetWeekStart: '2026-08-17', targetWeekEnd: '2026-08-21', dates: [{ date: '2026-08-17', md: '8/17', weekday: '月' }] };
  const manualEventsConfig = { entries: [] };

  const result = await collect({ sourcesConfig, importanceRules, eventNames: [], manualEventsConfig, targetWeek });
  assert.deepEqual(result.targetWeek, targetWeek);
  assert.equal(result.report.outcome.status, 'OK');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].kind, 'policy_rate');
  assert.equal(result.candidates[0].date, '2026-08-18');
});
