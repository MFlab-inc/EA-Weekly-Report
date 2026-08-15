'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ledgerToWeekInput, buildDays, commentFor, timeFromDatetimeJst, countryJaOf } = require('../scripts/render/ledger-to-week-input');

function baseLedger(events) {
  return {
    meta: { target_week_start: '2026-08-10', target_week_end: '2026-08-14' },
    events,
  };
}

test('timeFromDatetimeJst: ISO日時からHH:MMを取り出す。nullはnullのまま', () => {
  assert.equal(timeFromDatetimeJst('2026-08-11T13:30:00+09:00'), '13:30');
  assert.equal(timeFromDatetimeJst(null), null);
});

test('countryJaOf: ISO国コード→国名ピル表示（NZのみ「ニュージーランド」ではなく「NZ」のまま）', () => {
  assert.equal(countryJaOf('AU'), '豪州');
  assert.equal(countryJaOf('NZ'), 'NZ');
  assert.equal(countryJaOf('ZZ'), 'ZZ', '未登録国コードはそのままフォールバック');
});

test('commentFor: importance=3のみコメントを返す。辞書未登録kindはundefined', () => {
  const eventComments = { comments: { policy_rate: '政策判断と声明の文言を確認します。' } };
  assert.equal(commentFor('policy_rate', 3, eventComments), '政策判断と声明の文言を確認します。');
  assert.equal(commentFor('policy_rate', 2, eventComments), undefined);
  assert.equal(commentFor('unknown_kind', 3, eventComments), undefined);
  assert.equal(commentFor('policy_rate', 3, undefined), undefined);
});

test('buildDays: 対象週5日分（月〜金）を、イベントが無い日も含めてすべて生成する', () => {
  const ledger = baseLedger([]);
  const days = buildDays(ledger, undefined);
  assert.equal(days.length, 5);
  assert.deepEqual(days.map((d) => d.date), ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']);
  assert.deepEqual(days.map((d) => d.weekday), ['月', '火', '水', '木', '金']);
  assert.deepEqual(days.map((d) => d.md), ['8/10', '8/11', '8/12', '8/13', '8/14']);
  assert.ok(days.every((d) => d.events.length === 0 && d.windowGroups.length === 0));
});

test('buildDays: RBA3件クラスタは束ねず1イベント=1windowGroupとして扱う（しょうさん指示2026-08-15、束ねは次タスク）', () => {
  const ledger = baseLedger([
    { event_id: 'au-policy_rate-2026-08-11', date_jst: '2026-08-11', datetime_jst: '2026-08-11T13:30:00+09:00', country: 'AU', currency: 'AUD', kind: 'policy_rate', name_ja: 'RBA政策金利＆声明発表', importance: 3 },
    { event_id: 'au-quarterly_report-2026-08-11', date_jst: '2026-08-11', datetime_jst: '2026-08-11T13:30:00+09:00', country: 'AU', currency: 'AUD', kind: 'quarterly_report', name_ja: 'RBA四半期金融政策報告', importance: 3 },
    { event_id: 'au-press_conference-2026-08-11', date_jst: '2026-08-11', datetime_jst: '2026-08-11T14:30:00+09:00', country: 'AU', currency: 'AUD', kind: 'press_conference', name_ja: 'ブロックRBA総裁の記者会見', importance: 3 },
  ]);
  const days = buildDays(ledger, undefined);
  const day11 = days.find((d) => d.date === '2026-08-11');
  assert.equal(day11.events.length, 3);
  assert.equal(day11.windowGroups.length, 3, '束ね未実装のため3件とも別windowとして生成される');
  assert.deepEqual(day11.windowGroups.map((g) => g.firstTime), ['13:30', '13:30', '14:30']);
});

test('buildDays: time_status=unpublished（datetime_jst:null）はevents[].time:null・windowGroups対象外', () => {
  const ledger = baseLedger([
    { event_id: 'jp-bond_auction-2026-08-11', date_jst: '2026-08-11', datetime_jst: null, country: 'JP', currency: 'JPY', kind: 'bond_auction', name_ja: '10年利付国債（2026年8月債）の入札', importance: 2 },
  ]);
  const days = buildDays(ledger, undefined);
  const day = days.find((d) => d.date === '2026-08-11');
  assert.equal(day.events[0].time, null);
  assert.equal(day.windowGroups.length, 0, 'importance=2はwindowGroups対象外');
});

test('buildDays: importance=2はcomment未付与・importance=3はevent-comments.json辞書から付与', () => {
  const eventComments = { comments: { policy_rate: '政策判断と声明の文言を確認します。' } };
  const ledger = baseLedger([
    { event_id: 'au-policy_rate-2026-08-11', date_jst: '2026-08-11', datetime_jst: '2026-08-11T13:30:00+09:00', country: 'AU', currency: 'AUD', kind: 'policy_rate', name_ja: 'RBA政策金利＆声明発表', importance: 3 },
    { event_id: 'us-trade_balance-2026-08-11', date_jst: '2026-08-11', datetime_jst: '2026-08-11T10:30:00+09:00', country: 'US', currency: 'USD', kind: 'trade_balance', name_ja: '貿易収支', importance: 2 },
  ]);
  const days = buildDays(ledger, eventComments);
  const day = days.find((d) => d.date === '2026-08-11');
  const rate = day.events.find((e) => e.id === 'au-policy_rate-2026-08-11');
  const trade = day.events.find((e) => e.id === 'us-trade_balance-2026-08-11');
  assert.equal(rate.comment, '政策判断と声明の文言を確認します。');
  assert.equal(trade.comment, undefined);
});

test('ledgerToWeekInput: narrativeとledgerを合成しweekInput形を組み立てる', () => {
  const ledger = baseLedger([
    { event_id: 'jp-opinions_summary-2026-08-10', date_jst: '2026-08-10', datetime_jst: '2026-08-10T08:50:00+09:00', country: 'JP', currency: 'JPY', kind: 'opinions_summary', name_ja: '日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）', importance: 3 },
  ]);
  const narrative = {
    reportMeta: 'ea-weekly-20260810',
    createdDateJa: '2026年8月8日（土）',
    heroSummary: 'テスト用ヒーロー要約',
    heroPills: ['テストピル1'],
  };
  const weekInput = ledgerToWeekInput(ledger, narrative, undefined);
  assert.equal(weekInput.reportMeta, 'ea-weekly-20260810');
  assert.equal(weekInput.targetWeekStart, '2026-08-10');
  assert.equal(weekInput.targetWeekEnd, '2026-08-14');
  assert.equal(weekInput.heroSummary, 'テスト用ヒーロー要約');
  assert.equal(weekInput.days.length, 5);
  assert.equal(weekInput.days[0].events[0].displayName, '日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）');
});
