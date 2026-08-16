'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getTargetWeek, getCurrentWeekMonday, parseYmd } = require('../scripts/lib/dates');

// SPEC §2: 実行日（土曜）の翌月曜〜金曜がJST基準の対象週。
// ground truth: reference/sample-report_20260808.html — 作成日2026-08-08(土)→対象週2026-08-10(月)〜08-14(金)、
//               作成日2026-08-01(土)→対象週2026-08-03(月)〜08-07(金)

test('土曜実行（作成日2026-08-08想定）→ 対象週は2026-08-10(月)〜08-14(金)', () => {
  // 2026-08-08 12:00 JST を模した時刻（JSTでは08-08であることをUTCで表現: 08-08 03:00Z）
  const now = new Date('2026-08-08T03:00:00Z');
  const wk = getTargetWeek(now);
  assert.equal(wk.collectionDate, '2026-08-08');
  assert.equal(wk.targetWeekStart, '2026-08-10');
  assert.equal(wk.targetWeekEnd, '2026-08-14');
  assert.deepEqual(
    wk.dates.map((d) => d.date),
    ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
  );
  assert.deepEqual(
    wk.dates.map((d) => d.weekday),
    ['月', '火', '水', '木', '金']
  );
  assert.deepEqual(
    wk.dates.map((d) => d.md),
    ['8/10', '8/11', '8/12', '8/13', '8/14']
  );
});

test('土曜実行（作成日2026-08-01想定）→ 対象週は2026-08-03(月)〜08-07(金)', () => {
  const now = new Date('2026-08-01T03:00:00Z');
  const wk = getTargetWeek(now);
  assert.equal(wk.targetWeekStart, '2026-08-03');
  assert.equal(wk.targetWeekEnd, '2026-08-07');
});

test('JST日付境界: UTC前日23:30(=JST08:30翌日)は翌日として扱われる', () => {
  // 2026-08-07 23:30 UTC = 2026-08-08 08:30 JST（土曜）
  const now = new Date('2026-08-07T23:30:00Z');
  const wk = getTargetWeek(now);
  assert.equal(wk.collectionDate, '2026-08-08');
  assert.equal(wk.targetWeekStart, '2026-08-10');
});

test('日曜実行（保険run想定）→ 直前の土曜と同じ対象週になる', () => {
  // 2026-08-09（日）はcollectionDate自体は日曜だが、直近の月曜は変わらず08-10
  const now = new Date('2026-08-09T03:00:00Z');
  const wk = getTargetWeek(now);
  assert.equal(wk.collectionDate, '2026-08-09');
  assert.equal(wk.targetWeekStart, '2026-08-10');
});

test('月曜実行（手動再実行の異常系）→ 今週ではなく来週の月曜になる（今日を対象に含めない）', () => {
  // 2026-08-10（月）に実行した場合、対象は08-10週ではなく08-17週
  const now = new Date('2026-08-10T03:00:00Z');
  const wk = getTargetWeek(now);
  assert.equal(wk.collectionDate, '2026-08-10');
  assert.equal(wk.targetWeekStart, '2026-08-17');
});

// getCurrentWeekMonday（SPEC §3.3月曜事後突合、task #39用）: getTargetWeekと違い
// 「今日を含む週」の月曜を返す。2026-08-17(月)に実行した実測（task #2/#39）の実例で検証
test('getCurrentWeekMonday: 月曜実行時は当日そのものを返す（2026-08-17実測ground truth）', () => {
  // 2026-08-16T23:02:02Z = 2026-08-17 08:02 JST（月曜）
  const now = new Date('2026-08-16T23:02:02Z');
  assert.equal(getCurrentWeekMonday(now), '2026-08-17');
});

test('getCurrentWeekMonday: 週の他の曜日でも同じ週の月曜を返す（金曜実行）', () => {
  // 2026-08-21（金）
  const now = new Date('2026-08-21T03:00:00Z');
  assert.equal(getCurrentWeekMonday(now), '2026-08-17');
});

test('getCurrentWeekMonday: 日曜実行時は前日までの週（直前の月曜）を返す', () => {
  // 2026-08-16（日）はISO週的には08-10週の最終日
  const now = new Date('2026-08-16T03:00:00Z');
  assert.equal(getCurrentWeekMonday(now), '2026-08-10');
});

test('parseYmdの往復整合性', () => {
  const d = parseYmd('2026-08-10');
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 7); // 0-indexed
  assert.equal(d.getUTCDate(), 10);
});
