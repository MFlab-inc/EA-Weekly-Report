'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveBojMeetingRange } = require('../scripts/lib/boj-meeting-schedule');

// config/official-sources.jsonのjp_boj.scheduleから抜粋した実際のpolicy_rate日程
const POLICY_RATE_DATES = ['2026-01-23', '2026-03-19', '2026-04-28', '2026-06-16', '2026-07-31', '2026-09-18'];

test('resolveBojMeetingRange: indexFromMostRecent=0（直近会合）は既刊のjp-boj-summary-2026-08-10（主な意見）と一致', () => {
  const range = resolveBojMeetingRange(POLICY_RATE_DATES, '2026-08-10', 0);
  assert.deepEqual(range, { meetingStart: '2026-07-30', meetingEnd: '2026-07-31' });
});

test('resolveBojMeetingRange: indexFromMostRecent=1（1つ前の会合）は既刊のjp_boj_minutes_20260805（議事要旨）と一致', () => {
  const range = resolveBojMeetingRange(POLICY_RATE_DATES, '2026-08-05', 1);
  assert.deepEqual(range, { meetingStart: '2026-06-15', meetingEnd: '2026-06-16' });
});

test('resolveBojMeetingRange: 該当する会合が見つからない（scheduleの範囲外）場合はnull', () => {
  assert.equal(resolveBojMeetingRange(POLICY_RATE_DATES, '2026-01-01', 0), null);
  assert.equal(resolveBojMeetingRange(POLICY_RATE_DATES, '2026-08-10', 5), null);
});

test('resolveBojMeetingRange: announceDateJst当日の会合日も対象範囲に含む（<=判定）', () => {
  const range = resolveBojMeetingRange(POLICY_RATE_DATES, '2026-07-31', 0);
  assert.deepEqual(range, { meetingStart: '2026-07-30', meetingEnd: '2026-07-31' });
});

test('resolveBojMeetingRange: 重複日程・順不同の入力でも正しく動作する', () => {
  const shuffled = ['2026-07-31', '2026-01-23', '2026-06-16', '2026-06-16', '2026-04-28'];
  const range = resolveBojMeetingRange(shuffled, '2026-08-05', 1);
  assert.deepEqual(range, { meetingStart: '2026-06-15', meetingEnd: '2026-06-16' });
});
