'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { zonedWallTimeToJst, offsetMinutesAt } = require('../scripts/lib/tz-convert');

// 停止目安計算はJST時刻に依存するため、DST切替週の換算を必須テストとする
// （しょうさん指示・2026-08-14）。対象: 米ET・英GMT/BST・豪AEST/AEDT。
// 期待値はNode組み込みIANAデータ(Intl)から算出し、実在の発表時刻慣行
// （米CPI=8:30ET、英GDP=7:00現地、RBA=14:30現地）に沿ったフィクスチャを用いる。

test('米ET: 3月DST開始（2026-03-08）を跨ぐ週 — CPI想定08:30の換算が1時間変わる', () => {
  // 3/6(金)=EST(-5)基準、3/10(火)=EDT(-4)基準
  const pre = zonedWallTimeToJst(2026, 3, 6, 8, 30, 'America/New_York');
  const post = zonedWallTimeToJst(2026, 3, 10, 8, 30, 'America/New_York');
  assert.deepEqual(pre, { date: '2026-03-06', time: '22:30', utcInstant: pre.utcInstant });
  assert.deepEqual(post, { date: '2026-03-10', time: '21:30', utcInstant: post.utcInstant });
});

test('米ET: 11月DST終了（2026-11-01）を跨ぐ週 — 換算が1時間戻る', () => {
  const pre = zonedWallTimeToJst(2026, 10, 30, 8, 30, 'America/New_York'); // EDT
  const post = zonedWallTimeToJst(2026, 11, 3, 8, 30, 'America/New_York'); // EST
  assert.equal(pre.time, '21:30');
  assert.equal(post.time, '22:30');
});

test('英GMT/BST: 3月DST開始（2026-03-29）を跨ぐ週 — GDP想定07:00の換算', () => {
  const pre = zonedWallTimeToJst(2026, 3, 27, 7, 0, 'Europe/London'); // GMT
  const post = zonedWallTimeToJst(2026, 3, 31, 7, 0, 'Europe/London'); // BST
  assert.equal(pre.time, '16:00');
  assert.equal(post.time, '15:00');
});

test('英GMT/BST: 10月DST終了（2026-10-25）を跨ぐ週', () => {
  const pre = zonedWallTimeToJst(2026, 10, 23, 7, 0, 'Europe/London'); // BST
  const post = zonedWallTimeToJst(2026, 10, 27, 7, 0, 'Europe/London'); // GMT
  assert.equal(pre.time, '15:00');
  assert.equal(post.time, '16:00');
});

test('豪AEST/AEDT: 4月DST終了（2026-04-05、南半球は北半球と逆）を跨ぐ週 — RBA想定14:30の換算', () => {
  const pre = zonedWallTimeToJst(2026, 4, 3, 14, 30, 'Australia/Sydney'); // AEDT(+11)
  const post = zonedWallTimeToJst(2026, 4, 7, 14, 30, 'Australia/Sydney'); // AEST(+10)
  assert.equal(pre.time, '12:30');
  assert.equal(post.time, '13:30');
});

test('豪AEST/AEDT: 10月DST開始（2026-10-04）を跨ぐ週', () => {
  const pre = zonedWallTimeToJst(2026, 10, 2, 14, 30, 'Australia/Sydney'); // AEST(+10)
  const post = zonedWallTimeToJst(2026, 10, 6, 14, 30, 'Australia/Sydney'); // AEDT(+11)
  assert.equal(pre.time, '13:30');
  assert.equal(post.time, '12:30');
});

test('日付またぎ: 米ET深夜の発表がJSTでは翌日になる', () => {
  // 23:00 ET(EST,-5) = 翌04:00 UTC = 翌13:00 JST
  const r = zonedWallTimeToJst(2026, 1, 15, 23, 0, 'America/New_York');
  assert.equal(r.date, '2026-01-16');
  assert.equal(r.time, '13:00');
});

test('日本(JST)自体はDSTを持たないため常にUTC+9固定', () => {
  const r = zonedWallTimeToJst(2026, 3, 8, 8, 50, 'Asia/Tokyo');
  assert.equal(r.date, '2026-03-08');
  assert.equal(r.time, '08:50');
});

test('offsetMinutesAt: 既知の実測（8/10週RBA=13:30JST）と整合する', () => {
  // Phase 0実測: RBA Cash Rate 2026-08-11T00:30:00-04:00(ET) = 13:30 JST（design-mock実例と一致）
  const r = zonedWallTimeToJst(2026, 8, 11, 0, 30, 'America/New_York');
  assert.equal(r.date, '2026-08-11');
  assert.equal(r.time, '13:30');
});
