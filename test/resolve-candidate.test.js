'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCandidateEvent } = require('../scripts/lib/resolve-candidate');
const { findEventName } = require('../scripts/lib/match-event-name');
const { resolveImportance } = require('../scripts/lib/importance');

const EVENT_NAMES = [
  { country: 'US', kind: 'trade_balance', match: ['international trade in goods and services'], display_name: '貿易収支' },
  { country: 'US', kind: 'retail_sales', match: ['advance monthly sales for retail'], display_name: '小売売上高＆【除自動車】' },
  { country: 'AU', kind: 'trade_balance', match: ['international trade in goods'], display_name: '貿易収支' },
];
const IMPORTANCE_RULES = {
  importance_by_kind: { trade_balance: 2, retail_sales: 3 },
  country_overrides: [{ kind: 'trade_balance', country: 'AU', importance: 3 }],
};

test('findEventName: country+kind+キーワード一致でエントリを返す', () => {
  const r = findEventName(EVENT_NAMES, 'US', 'trade_balance', 'U.S. International Trade in Goods and Services');
  assert.equal(r.display_name, '貿易収支');
});

test('findEventName: 一致しなければnull', () => {
  assert.equal(findEventName(EVENT_NAMES, 'US', 'trade_balance', 'Unrelated Report'), null);
});

test('resolveImportance: country_overridesがimportance_by_kindより優先する', () => {
  assert.equal(resolveImportance('trade_balance', 'AU', IMPORTANCE_RULES), 3);
  assert.equal(resolveImportance('trade_balance', 'US', IMPORTANCE_RULES), 2);
});

test('resolveCandidateEvent: utcInstant（ABS想定）からJST日時を正しく導出する', () => {
  const row = { title: 'International Trade in Goods', utcInstant: '2026-08-06T01:30:00Z' };
  const r = resolveCandidateEvent(row, { country: 'AU', kind: 'trade_balance', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES });
  assert.equal(r.ok, true);
  assert.equal(r.date, '2026-08-06');
  assert.equal(r.time, '10:30'); // ground truth au_trade_20260806と一致
  assert.equal(r.displayName, '貿易収支');
  assert.equal(r.importance, 3);
});

test('resolveCandidateEvent: date+localTime+tz（Census想定）からJST日時をDST対応で導出する', () => {
  const row = { title: 'Advance Monthly Sales for Retail and Food Services', date: '2026-08-14', localTime: '08:30' };
  const r = resolveCandidateEvent(row, { country: 'US', kind: 'retail_sales', tz: 'America/New_York', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES });
  assert.equal(r.ok, true);
  assert.equal(r.date, '2026-08-14');
  assert.equal(r.time, '21:30'); // ground truth us-retail-sales-2026-08-14と一致
  assert.equal(r.importance, 3);
});

test('resolveCandidateEvent: event-names.json未登録タイトルはWARN対象としてok:falseを返す', () => {
  const row = { title: 'Some Unregistered Release', utcInstant: '2026-08-06T01:30:00Z' };
  const r = resolveCandidateEvent(row, { country: 'AU', kind: 'trade_balance', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES });
  assert.equal(r.ok, false);
  assert.match(r.reason, /未登録/);
});

test('resolveCandidateEvent: 時刻情報が全く無い場合はok:false', () => {
  const row = { title: 'International Trade in Goods' };
  const r = resolveCandidateEvent(row, { country: 'AU', kind: 'trade_balance', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES });
  assert.equal(r.ok, false);
});
