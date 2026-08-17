'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findEventName } = require('../scripts/lib/match-event-name');

const fs = require('node:fs');
const path = require('node:path');
const eventNames = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'event-names.json'), 'utf8')).entries;

test('findEventName: GB/gdpはONS実タイトル「GDP first quarterly estimate, UK: ...」で解決する（2026-08-15訂正・WebSearchでons.gov.uk実在ブリテン名を確認）', () => {
  // 実際のONS releases API（gb_ons）が返すタイトル形式。旧matchキーワード（gdp m/m・prelim gdp q/q）は
  // FF想定の表記でこの実タイトルには一致しないと判明したため、event-names.jsonへ
  // 'gdp first quarterly estimate' を追加した（config/event-names.json参照）
  const entry = findEventName(eventNames, 'GB', 'gdp', 'GDP first quarterly estimate, UK: April to June 2026');
  assert.ok(entry, 'ONS実タイトルで解決できるはず');
  assert.equal(entry.display_name, 'GDP【速報値】');
});

// task #50/51（2026-08-15、しょうさんのManus突合指摘）の回帰テスト: gb_onsは登録済みだが
// 雇用統計・小売売上高がkind未登録のため8/18・8/21分が欠落していた
test('findEventName: GB/employment_situationはONS実タイトル「UK Labour Market: {月} {年}」で解決する（8/17週の欠損事例の回帰テスト）', () => {
  const entry = findEventName(eventNames, 'GB', 'employment_situation', 'UK Labour Market: August 2026');
  assert.ok(entry, 'ONS実タイトルで解決できるはず');
  assert.equal(entry.display_name, '雇用統計');
});

// query=Labourの実APIレスポンスには類似タイトルの別リリースが混在する（ライブ検証2026-08-15で確認）。
// これらが誤って雇用統計としてマッチしないことを確認する
test('findEventName: GB/employment_situationは類似タイトルの別リリースとは一致しない（ライブ検証で確認した混在リリース）', () => {
  assert.equal(findEventName(eventNames, 'GB', 'employment_situation', 'Labour market statistics time series: August 2026'), null);
  assert.equal(findEventName(eventNames, 'GB', 'employment_situation', 'Labour market in the regions of the UK: August 2026'), null);
  assert.equal(findEventName(eventNames, 'GB', 'employment_situation', 'Earnings and employment from Pay As You Earn Real Time Information, UK: August 2026'), null);
});

test('findEventName: GB/retail_salesはONS実タイトル「Retail Sales, Great Britain: {月} {年}」で解決する（8/17週の欠損事例の回帰テスト）', () => {
  const entry = findEventName(eventNames, 'GB', 'retail_sales', 'Retail Sales, Great Britain: July 2026');
  assert.ok(entry, 'ONS実タイトルで解決できるはず');
  assert.equal(entry.display_name, '小売売上高＆【除自動車】');
});

// task #50/51（2026-08-15、一括監査で発覚）の回帰テスト: au_absは登録済みだがretail_salesがkind未登録だった
// （ABSの月次『Retail Trade』は2025-07-31付けで『Monthly Household Spending Indicator』へ統合済み）
test('findEventName: AU/retail_salesはABS実タイトル「Monthly Household Spending Indicator」で解決する（一括監査の回帰テスト）', () => {
  const entry = findEventName(eventNames, 'AU', 'retail_sales', 'Monthly Household Spending Indicator');
  assert.ok(entry, 'ABS実タイトルで解決できるはず');
  assert.equal(entry.display_name, '小売売上高＆【除自動車】');
});

test('findEventName: 未登録の組み合わせはnull', () => {
  assert.equal(findEventName(eventNames, 'GB', 'gdp', '存在しない架空のタイトル文字列'), null);
  assert.equal(findEventName(eventNames, 'ZZ', 'gdp', 'GDP first quarterly estimate, UK: April to June 2026'), null);
});
