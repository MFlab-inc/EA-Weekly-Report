'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { businessDaysOfMonth, ismDraftForMonth, ismDraftRange } = require('../scripts/lib/ism-schedule');

test('businessDaysOfMonth: 2026年8月の第1・第3営業日は8/3・8/5（既刊ground truthと一致）', () => {
  const bdays = businessDaysOfMonth(2026, 8);
  // 2026-08-01(土)・08-02(日)は除外。08-03(月)が第1営業日、08-04(火)第2、08-05(水)第3
  assert.equal(bdays[0], '2026-08-03');
  assert.equal(bdays[2], '2026-08-05');
});

test('ismDraftForMonth: 2026年8月ドラフトが既刊実績（製造業8/3・非製造業8/5）と一致する', () => {
  const draft = ismDraftForMonth(2026, 8);
  const mfg = draft.find((e) => e.subtype === 'manufacturing');
  const svc = draft.find((e) => e.subtype === 'services');
  assert.equal(mfg.date, '2026-08-03'); // us_ism_mfg_20260803 ground truth
  assert.equal(svc.date, '2026-08-05'); // us_ism_services_20260805 ground truth
});

test('ismDraftForMonth: 祝日が月初にかかる月（2026年1月・元日+MLK Day）で正しく営業日をスキップする', () => {
  // 2026-01-01(木)=元日、01-02(金)が第1営業日。01-05(月)MLK Dayではない週なので
  // 01-02(1st),01-05(2nd),01-06(3rd)が第1〜3営業日
  const draft = ismDraftForMonth(2026, 1);
  const mfg = draft.find((e) => e.subtype === 'manufacturing');
  const svc = draft.find((e) => e.subtype === 'services');
  assert.equal(mfg.date, '2026-01-02');
  assert.equal(svc.date, '2026-01-06');
});

test('ismDraftRange: 指定月数分のドラフトを連続して返す', () => {
  const draft = ismDraftRange(2026, 8, 2);
  assert.equal(draft.length, 4); // 2ヶ月分×(製造業+非製造業)
  assert.ok(draft.some((e) => e.date === '2026-08-03'));
  assert.ok(draft.some((e) => e.date.startsWith('2026-09')));
});

test('ismDraftRange: 年またぎでも連続して計算できる', () => {
  const draft = ismDraftRange(2026, 12, 2);
  assert.ok(draft.some((e) => e.date.startsWith('2026-12')));
  assert.ok(draft.some((e) => e.date.startsWith('2027-01')));
});
