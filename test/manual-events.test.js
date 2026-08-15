'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateManualEvents, manualEntryToCandidate, candidatesForTargetWeek } = require('../scripts/lib/manual-events');

function baseEntry(overrides = {}) {
  return {
    id: 'rba-testimony-2026-08',
    date: '2026-08-14',
    local_time: '08:30',
    tz: 'Australia/Sydney',
    country: 'AU',
    kind: 'testimony',
    display_name: 'ブロックRBA総裁：下院経済委員会への出席',
    importance: 3,
    source_note: 'aph.gov.au 2026-08-10確認',
    registered_by: 'しょうさん',
    registered_at: '2026-08-15',
    ...overrides,
  };
}

test('validateManualEvents: 妥当なentriesはエラー無し', () => {
  const errors = validateManualEvents({ entries: [baseEntry()] });
  assert.deepEqual(errors, []);
});

test('validateManualEvents: entriesが配列でなければエラー', () => {
  assert.deepEqual(validateManualEvents({}), ['entries配列が存在しません']);
});

test('validateManualEvents: id重複を検出する', () => {
  const errors = validateManualEvents({ entries: [baseEntry(), baseEntry()] });
  assert.ok(errors.some((e) => e.includes('id重複')));
});

test('validateManualEvents: date形式不正を検出する', () => {
  const errors = validateManualEvents({ entries: [baseEntry({ date: '2026/08/14' })] });
  assert.ok(errors.some((e) => e.includes('date')));
});

test('validateManualEvents: importanceが0/2/3以外はエラー', () => {
  const errors = validateManualEvents({ entries: [baseEntry({ importance: 1 })] });
  assert.ok(errors.some((e) => e.includes('importance')));
});

test('validateManualEvents: local_timeのみ・tzのみの片方指定はエラー', () => {
  const errorsA = validateManualEvents({ entries: [baseEntry({ tz: undefined })] });
  assert.ok(errorsA.some((e) => e.includes('local_time/tz')));
  const errorsB = validateManualEvents({ entries: [baseEntry({ local_time: undefined })] });
  assert.ok(errorsB.some((e) => e.includes('local_time/tz')));
});

test('validateManualEvents: local_time/tz両方省略は時刻未定として許容される', () => {
  const errors = validateManualEvents({ entries: [baseEntry({ local_time: undefined, tz: undefined })] });
  assert.deepEqual(errors, []);
});

test('validateManualEvents: source_note/registered_by/registered_at必須', () => {
  const errors = validateManualEvents({
    entries: [baseEntry({ source_note: undefined, registered_by: undefined, registered_at: undefined })],
  });
  assert.ok(errors.some((e) => e.includes('source_note')));
  assert.ok(errors.some((e) => e.includes('registered_by')));
  assert.ok(errors.some((e) => e.includes('registered_at')));
});

test('manualEntryToCandidate: local_time+tzをJSTへ変換し辞書照合を経由せずdisplayNameを直接使う', () => {
  const c = manualEntryToCandidate(baseEntry());
  // Australia/Sydney 08:30（8月=南半球冬・AEST UTC+10、DST無し）→ JST（UTC+9）はシドニーの1時間後ろ＝同日07:30
  assert.equal(c.date, '2026-08-14');
  assert.equal(c.time, '07:30');
  assert.equal(c.kind, 'testimony');
  assert.equal(c.country, 'AU');
  assert.equal(c.importance, 3);
  assert.equal(c.displayName, 'ブロックRBA総裁：下院経済委員会への出席');
  assert.equal(c.sourceId, 'manual_events');
});

test('manualEntryToCandidate: local_time/tz省略時はtime:null（bond_auction等と同じtime-exempt扱い）', () => {
  const c = manualEntryToCandidate(baseEntry({ local_time: undefined, tz: undefined }));
  assert.equal(c.date, '2026-08-14');
  assert.equal(c.time, null);
});

test('manualEntryToCandidate: kind省略時は既定値manual', () => {
  const c = manualEntryToCandidate(baseEntry({ kind: undefined, local_time: undefined, tz: undefined }));
  assert.equal(c.kind, 'manual');
});

test('candidatesForTargetWeek: 対象週内のentriesのみ候補化する', () => {
  const config = {
    entries: [
      baseEntry({ id: 'in-week', date: '2026-08-14', local_time: undefined, tz: undefined }),
      baseEntry({ id: 'out-of-week', date: '2026-08-20', local_time: undefined, tz: undefined }),
    ],
  };
  const candidates = candidatesForTargetWeek(config, '2026-08-10', '2026-08-16');
  assert.deepEqual(candidates.map((c) => c.date), ['2026-08-14']);
});

test('candidatesForTargetWeek: configがnull/entries無しでも空配列を返す', () => {
  assert.deepEqual(candidatesForTargetWeek(null, '2026-08-10', '2026-08-16'), []);
  assert.deepEqual(candidatesForTargetWeek({}, '2026-08-10', '2026-08-16'), []);
});

test('config/manual-events.json はスキーマ検証をパスする（初期状態はentries空）', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'manual-events.json'), 'utf8'));
  assert.deepEqual(validateManualEvents(config), []);
});
