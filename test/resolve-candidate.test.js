'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCandidateEvent, auGdpQuarterDisplayName } = require('../scripts/lib/resolve-candidate');
const { findEventName } = require('../scripts/lib/match-event-name');
const { resolveImportance } = require('../scripts/lib/importance');

const EVENT_NAMES = [
  { country: 'US', kind: 'trade_balance', match: ['international trade in goods and services'], display_name: '貿易収支' },
  { country: 'US', kind: 'retail_sales', match: ['advance monthly sales for retail'], display_name: '小売売上高＆【除自動車】' },
  { country: 'AU', kind: 'trade_balance', match: ['international trade in goods'], display_name: '貿易収支' },
  { country: 'AU', kind: 'gdp', match: ['national income, expenditure and product'], display_name: 'GDP' },
];
const IMPORTANCE_RULES = {
  importance_by_kind: { trade_balance: 2, retail_sales: 3, gdp: 3 },
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

// 2026-09-19新設（task #94フォローアップ、米フラッシュPMI追加に伴う衝突回避）: US×pmi_ismは
// ISM向けに country_overrides で★★★昇格済みだが、同じUS×pmi_ism kindを使う米フラッシュPMI
// （subtype:flash）はDE/EU/GBフラッシュPMIと同じ理由で★★据え置きが必要。subtype付きの
// エントリがsubtype無しの一般エントリより優先されることを確認する
test('resolveImportance: 同一country×kindでもsubtype付きのcountry_overridesが優先される（米フラッシュPMI vs ISM）', () => {
  const rules = {
    importance_by_kind: { pmi_ism: 2 },
    country_overrides: [
      { kind: 'pmi_ism', country: 'US', importance: 3 },
      { kind: 'pmi_ism', country: 'US', subtype: 'flash', importance: 2 },
    ],
  };
  assert.equal(resolveImportance('pmi_ism', 'US', rules, 'manufacturing'), 3, 'ISM製造業はsubtype無しの一般エントリ（★★★）を使うはず');
  assert.equal(resolveImportance('pmi_ism', 'US', rules), 3, 'subtype省略時も従来どおり一般エントリ（★★★）を使うはず');
  assert.equal(resolveImportance('pmi_ism', 'US', rules, 'flash'), 2, '米フラッシュPMIはsubtype:flash専用エントリ（★★）を優先して使うはず');
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

// SPEC §4.2の規則生成命名kind（policy_rate等）向け: ctx.ruleGenerated=trueは
// event-names.json辞書照合をスキップする（task #19、BOC等がevent-names.json未登録でも
// WARN誤検知にならないようにするための分岐）
test('resolveCandidateEvent: ruleGenerated=trueはevent-names.json未登録でも辞書照合をスキップしdisplayName=nullで成功する', () => {
  const row = { title: 'Interest Rate Announcement', date: '2026-09-02', localTime: '09:45' };
  const r = resolveCandidateEvent(row, {
    country: 'CA', kind: 'policy_rate', tz: 'America/Toronto', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES, ruleGenerated: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.displayName, null);
  assert.equal(r.kind, 'policy_rate');
});

test('resolveCandidateEvent: ruleGenerated=falseかつeventNames未登録の場合は従来どおりWARN対象', () => {
  const row = { title: 'Interest Rate Announcement', date: '2026-09-02', localTime: '09:45' };
  const r = resolveCandidateEvent(row, {
    country: 'CA', kind: 'policy_rate', tz: 'America/Toronto', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /未登録/);
});

// bond_auction等の時刻未公表kind（validate-official-sources.jsのTIME_EXEMPT_KINDSと同一基準）は
// localTime/utcInstantが無くてもtime:nullで成功扱いとする（no_time_note、SPEC report-policy.json）
test('resolveCandidateEvent: bond_auctionはlocalTime無しでもtime:nullで成功する', () => {
  const row = { title: '10-year JGB auction', date: '2026-08-04' };
  const r = resolveCandidateEvent(row, { country: 'JP', kind: 'bond_auction', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES, ruleGenerated: true });
  assert.equal(r.ok, true);
  assert.equal(r.date, '2026-08-04');
  assert.equal(r.time, null);
});

test('resolveCandidateEvent: time-exempt対象外のkindはlocalTime無しだとok:falseのまま', () => {
  const row = { title: 'International Trade in Goods', date: '2026-08-06' };
  const r = resolveCandidateEvent(row, { country: 'AU', kind: 'trade_balance', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES, ruleGenerated: true });
  assert.equal(r.ok, false);
});

// 2026-09-19新設（しょうさん指示、PR #28/#29フォローアップ確認事項3）: AU四半期GDPの表示名を
// 発表月から「第N四半期GDP」へ機械的に決定する。ABS公式メソドロジーで単一発表・段階分けなしと
// 確認済みのため「【速報値】」は付けない。発表月→対象四半期: 3月→前年第4四半期・6月→第1四半期・
// 9月→第2四半期・12月→第3四半期（3月は年をまたいで前年の第4四半期を指す点に注意）
test('auGdpQuarterDisplayName: 発表月3/6/9/12月をそれぞれ正しい四半期へ変換する（3月は年をまたいで前年第4四半期）', () => {
  assert.equal(auGdpQuarterDisplayName(3), '第4四半期GDP');
  assert.equal(auGdpQuarterDisplayName(6), '第1四半期GDP');
  assert.equal(auGdpQuarterDisplayName(9), '第2四半期GDP');
  assert.equal(auGdpQuarterDisplayName(12), '第3四半期GDP');
});

test('auGdpQuarterDisplayName: 3/6/9/12月以外（想定外の発表月）はnullを返す（呼び出し側は既定表示名「GDP」へフォールバック）', () => {
  assert.equal(auGdpQuarterDisplayName(7), null);
  assert.equal(auGdpQuarterDisplayName(1), null);
});

test('resolveCandidateEvent: AU×gdpは発表月から「第N四半期GDP」へ表示名を上書きする（【速報値】は付けない）', () => {
  const cases = [
    { utcInstant: '2026-03-04T00:30:00Z', expected: '第4四半期GDP' }, // 3月発表＝前年第4四半期
    { utcInstant: '2026-06-03T01:30:00Z', expected: '第1四半期GDP' },
    { utcInstant: '2026-09-02T01:30:00Z', expected: '第2四半期GDP' },
    { utcInstant: '2026-12-02T00:30:00Z', expected: '第3四半期GDP' },
  ];
  for (const { utcInstant, expected } of cases) {
    const row = { title: 'Australian National Accounts: National Income, Expenditure and Product', utcInstant };
    const r = resolveCandidateEvent(row, { country: 'AU', kind: 'gdp', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES });
    assert.equal(r.ok, true);
    assert.equal(r.displayName, expected, `utcInstant=${utcInstant}`);
    assert.doesNotMatch(r.displayName, /速報値/, 'ABS四半期GDPは単一発表・段階分けなしのため【速報値】を付けない');
  }
});

test('resolveCandidateEvent: AU×gdpが想定外の月に発表された場合はevent-names.jsonの既定表示名「GDP」へフォールバックする', () => {
  const row = { title: 'Australian National Accounts: National Income, Expenditure and Product', utcInstant: '2026-07-15T01:30:00Z' };
  const r = resolveCandidateEvent(row, { country: 'AU', kind: 'gdp', eventNames: EVENT_NAMES, importanceRules: IMPORTANCE_RULES });
  assert.equal(r.ok, true);
  assert.equal(r.displayName, 'GDP');
});
