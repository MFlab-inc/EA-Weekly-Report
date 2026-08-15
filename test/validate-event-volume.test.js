'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEventVolume } = require('../scripts/lib/validate-event-volume');

const POLICY = { min_displayed_events: 4, require_at_least_one_star3: true };

function ledgerWith(events) {
  return { events };
}

test('checkEventVolume: 掲載対象4件以上・★★★1件以上なら下限を下回らない', () => {
  const r = checkEventVolume(ledgerWith([
    { importance: 3 }, { importance: 2 }, { importance: 2 }, { importance: 2 },
  ]), POLICY);
  assert.equal(r.belowThreshold, false);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.displayedCount, 4);
  assert.equal(r.star3Count, 1);
});

// task #38実ネットワーク検証（しょうさん指摘2026-08-15）の再現ケース: 8/17週は掲載対象3件・
// ★★★0件のままPUBLISH_READYが出てしまった。このケースがbelowThreshold:trueになることを確認する
test('checkEventVolume: 8/17週の実例（入札3件・★★★0件）はbelowThreshold:trueになる', () => {
  const r = checkEventVolume(ledgerWith([
    { importance: 2 }, { importance: 2 }, { importance: 2 },
  ]), POLICY);
  assert.equal(r.belowThreshold, true);
  assert.equal(r.reasons.length, 2);
  assert.match(r.reasons[0], /掲載対象イベント数\(3件\)/);
  assert.match(r.reasons[1], /★★★.*0件/);
});

test('checkEventVolume: 掲載対象は4件以上だが★★★が0件なら下限を下回る（件数条件は満たしていても）', () => {
  const r = checkEventVolume(ledgerWith([
    { importance: 2 }, { importance: 2 }, { importance: 2 }, { importance: 2 }, { importance: 2 },
  ]), POLICY);
  assert.equal(r.belowThreshold, true);
  assert.deepEqual(r.reasons, ['最重要（★★★）イベントが0件です']);
});

test('checkEventVolume: importance=0/nullのイベントは掲載対象カウントに含めない', () => {
  const r = checkEventVolume(ledgerWith([
    { importance: 3 }, { importance: 2 }, { importance: 2 }, { importance: 2 }, { importance: 0 }, { importance: null },
  ]), POLICY);
  assert.equal(r.displayedCount, 4);
  assert.equal(r.belowThreshold, false);
});

test('checkEventVolume: require_at_least_one_star3:falseなら★★★0件でも下限を下回らない（件数条件のみ）', () => {
  const r = checkEventVolume(ledgerWith([
    { importance: 2 }, { importance: 2 }, { importance: 2 }, { importance: 2 },
  ]), { min_displayed_events: 4, require_at_least_one_star3: false });
  assert.equal(r.belowThreshold, false);
});
