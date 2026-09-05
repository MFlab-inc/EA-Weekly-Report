'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { titleMatchesKind, matchesCountryQualifier, findFfCandidates, crossCheck, findMissingHighImpactFfEvents } = require('../scripts/lib/ff-cross-check');

test('titleMatchesKind: kind別キーワードで大小無視の部分一致判定', () => {
  assert.equal(titleMatchesKind('CPI y/y', 'cpi'), true);
  assert.equal(titleMatchesKind('German ZEW Economic Sentiment', 'sentiment'), true);
  assert.equal(titleMatchesKind('Unemployment Rate', 'employment_situation'), true);
  assert.equal(titleMatchesKind('GDP q/q', 'trade_balance'), false);
});

test('matchesCountryQualifier: DEは国名接頭辞ありのみ、EUは接頭辞無しのみ、他国は常にtrue', () => {
  assert.equal(matchesCountryQualifier('German Flash Manufacturing PMI', 'DE'), true);
  assert.equal(matchesCountryQualifier('Flash Manufacturing PMI', 'DE'), false);
  assert.equal(matchesCountryQualifier('Flash Manufacturing PMI', 'EU'), true);
  assert.equal(matchesCountryQualifier('French Flash Manufacturing PMI', 'EU'), false);
  assert.equal(matchesCountryQualifier('German Flash Manufacturing PMI', 'EU'), false);
  assert.equal(matchesCountryQualifier('CPI y/y', 'GB'), true);
});

test('findFfCandidates: country(通貨)・日付・kindキーワード・国名修飾子で絞り込む', () => {
  const ffEvents = [
    { jstDate: '2026-08-18', jstTime: '18:00', currency: 'EUR', title: 'German ZEW Economic Sentiment' },
    { jstDate: '2026-08-18', jstTime: '18:00', currency: 'EUR', title: 'ZEW Economic Sentiment' },
    { jstDate: '2026-08-18', jstTime: '15:00', currency: 'GBP', title: 'Claimant Count Change' },
  ];
  const deZew = { country: 'DE', kind: 'sentiment', dateJst: '2026-08-18' };
  const candidates = findFfCandidates(deZew, ffEvents);
  assert.deepEqual(candidates.map((c) => c.title), ['German ZEW Economic Sentiment']);
});

test('crossCheck: time_status=unpublished（datetimeJst無し）は比較対象外', () => {
  const ledgerEvents = [{ eventId: 'jp-bond_auction-2026-08-18', nameJa: '5年利付国債の入札', country: 'JP', kind: 'bond_auction', dateJst: '2026-08-18', datetimeJst: null, timeStatus: 'unpublished' }];
  const result = crossCheck(ledgerEvents, []);
  assert.deepEqual(result, { matched: [], discrepancies: [], notFoundInFf: [] });
});

test('crossCheck: FFに候補が無いイベントはnotFoundInFfへ（discrepancyにはしない）', () => {
  const ledgerEvents = [{ eventId: 'nz-cpi-2026-08-18', nameJa: 'NZ CPI', country: 'NZ', kind: 'cpi', dateJst: '2026-08-18', datetimeJst: '2026-08-18T10:45:00+09:00', timeStatus: 'published' }];
  const result = crossCheck(ledgerEvents, []);
  assert.equal(result.discrepancies.length, 0);
  assert.equal(result.notFoundInFf.length, 1);
});

// task #39実行結果（2026-08-17、実データ）: 対象週(8/17週)実配信予定17イベントのうち時刻確定14件を
// FFフィード（Actions run 31977973749、2026-08-17 08:02 JST取得・96イベント）と突合。
// 全17イベント・FF該当抜粋を実データのまま固定化した回帰テスト。
// 結論: 14件中13件が完全一致、DE ZEW（de_zew）の1件のみ5分の相違を検出
//（台帳18:05 JST=11:05 CEST・FF18:00 JST=11:00 CEST。config/official-sources.jsonの
// de_zewはzew.de公式プレスリリース直接引用「11:05 a.m. Frankfurt Time」に基づく実測値のため、
// 台帳側を誤りとは判断していない。FF側が一般的な通念[11:00]に基づく丸めの可能性が高い。
// discrepancy-report.jsonとして出力し、しょうさんの最終判断を仰ぐ運用とする）
test('task #39 実データ回帰: 2026-08-17週の台帳とFF thisweekの突合結果を固定化する', () => {
  const ledgerEvents = [
    { eventId: 'jp-gdp-2026-08-17', nameJa: 'GDP【速報値】', country: 'JP', kind: 'gdp', dateJst: '2026-08-17', datetimeJst: '2026-08-17T08:50:00+09:00', timeStatus: 'published' },
    { eventId: 'ca-cpi-2026-08-17', nameJa: '消費者物価指数（CPI）', country: 'CA', kind: 'cpi', dateJst: '2026-08-17', datetimeJst: '2026-08-17T21:30:00+09:00', timeStatus: 'published' },
    { eventId: 'jp-bond_auction-2026-08-18', nameJa: '5年利付国債（2026年8月債）の入札', country: 'JP', kind: 'bond_auction', dateJst: '2026-08-18', datetimeJst: null, timeStatus: 'unpublished' },
    { eventId: 'gb-employment_situation-2026-08-18', nameJa: '雇用統計', country: 'GB', kind: 'employment_situation', dateJst: '2026-08-18', datetimeJst: '2026-08-18T15:00:00+09:00', timeStatus: 'published' },
    { eventId: 'de-sentiment-2026-08-18', nameJa: 'ZEW景況感指数', country: 'DE', kind: 'sentiment', dateJst: '2026-08-18', datetimeJst: '2026-08-18T18:05:00+09:00', timeStatus: 'published' },
    { eventId: 'us-bond_auction-2026-08-19', nameJa: '米20年債入札', country: 'US', kind: 'bond_auction', dateJst: '2026-08-19', datetimeJst: null, timeStatus: 'unpublished' },
    { eventId: 'gb-cpi-2026-08-19', nameJa: '消費者物価指数（CPI）', country: 'GB', kind: 'cpi', dateJst: '2026-08-19', datetimeJst: '2026-08-19T15:00:00+09:00', timeStatus: 'published' },
    { eventId: 'jp-bond_auction-2026-08-20', nameJa: '20年利付国債（2026年8月債）の入札', country: 'JP', kind: 'bond_auction', dateJst: '2026-08-20', datetimeJst: null, timeStatus: 'unpublished' },
    { eventId: 'us-minutes_summary-2026-08-20', nameJa: 'FOMC議事録', country: 'US', kind: 'minutes_summary', dateJst: '2026-08-20', datetimeJst: '2026-08-20T03:00:00+09:00', timeStatus: 'published' },
    { eventId: 'jp-trade_balance-2026-08-20', nameJa: '貿易収支', country: 'JP', kind: 'trade_balance', dateJst: '2026-08-20', datetimeJst: '2026-08-20T08:50:00+09:00', timeStatus: 'published' },
    { eventId: 'au-employment_situation-2026-08-20', nameJa: '雇用統計', country: 'AU', kind: 'employment_situation', dateJst: '2026-08-20', datetimeJst: '2026-08-20T10:30:00+09:00', timeStatus: 'published' },
    { eventId: 'jp-cpi-2026-08-21', nameJa: '全国消費者物価指数（CPI）', country: 'JP', kind: 'cpi', dateJst: '2026-08-21', datetimeJst: '2026-08-21T08:30:00+09:00', timeStatus: 'published' },
    { eventId: 'gb-retail_sales-2026-08-21', nameJa: '小売売上高＆【除自動車】', country: 'GB', kind: 'retail_sales', dateJst: '2026-08-21', datetimeJst: '2026-08-21T15:00:00+09:00', timeStatus: 'published' },
    { eventId: 'de-pmi_ism-2026-08-21', nameJa: '独フラッシュPMI（製造業＆サービス業）', country: 'DE', kind: 'pmi_ism', dateJst: '2026-08-21', datetimeJst: '2026-08-21T16:30:00+09:00', timeStatus: 'published' },
    { eventId: 'eu-pmi_ism-2026-08-21', nameJa: 'ユーロ圏フラッシュPMI（製造業＆サービス業）', country: 'EU', kind: 'pmi_ism', dateJst: '2026-08-21', datetimeJst: '2026-08-21T17:00:00+09:00', timeStatus: 'published' },
    { eventId: 'gb-pmi_ism-2026-08-21', nameJa: '英フラッシュPMI（製造業＆サービス業）', country: 'GB', kind: 'pmi_ism', dateJst: '2026-08-21', datetimeJst: '2026-08-21T17:30:00+09:00', timeStatus: 'published' },
    { eventId: 'ca-retail_sales-2026-08-21', nameJa: '小売売上高＆【除自動車】', country: 'CA', kind: 'retail_sales', dateJst: '2026-08-21', datetimeJst: '2026-08-21T21:30:00+09:00', timeStatus: 'published' },
  ];

  // Actions run 31977973749のff_calendar_thisweek.json実データから、上記ledgerと同一国・同一日の
  // 抜粋（該当なしの大量のLow系他国イベントは省略。デコイとしてFR/US系flash PMIを含める）
  const ffEvents = [
    { jstDate: '2026-08-17', jstTime: '08:50', currency: 'JPY', title: 'Prelim GDP Price Index y/y' },
    { jstDate: '2026-08-17', jstTime: '08:50', currency: 'JPY', title: 'Prelim GDP q/q' },
    { jstDate: '2026-08-17', jstTime: '21:30', currency: 'CAD', title: 'CPI m/m' },
    { jstDate: '2026-08-17', jstTime: '21:30', currency: 'CAD', title: 'Median CPI y/y' },
    { jstDate: '2026-08-18', jstTime: '15:00', currency: 'GBP', title: 'Claimant Count Change' },
    { jstDate: '2026-08-18', jstTime: '15:00', currency: 'GBP', title: 'Average Earnings Index 3m/y' },
    { jstDate: '2026-08-18', jstTime: '18:00', currency: 'EUR', title: 'ZEW Economic Sentiment' },
    { jstDate: '2026-08-18', jstTime: '18:00', currency: 'EUR', title: 'German ZEW Economic Sentiment' },
    { jstDate: '2026-08-19', jstTime: '15:00', currency: 'GBP', title: 'CPI y/y' },
    { jstDate: '2026-08-20', jstTime: '03:00', currency: 'USD', title: 'FOMC Meeting Minutes' },
    { jstDate: '2026-08-20', jstTime: '08:50', currency: 'JPY', title: 'Trade Balance' },
    { jstDate: '2026-08-20', jstTime: '10:30', currency: 'AUD', title: 'Employment Change' },
    { jstDate: '2026-08-20', jstTime: '10:30', currency: 'AUD', title: 'Unemployment Rate' },
    { jstDate: '2026-08-21', jstTime: '08:30', currency: 'JPY', title: 'National Core CPI y/y' },
    { jstDate: '2026-08-21', jstTime: '15:00', currency: 'GBP', title: 'Retail Sales m/m' },
    { jstDate: '2026-08-21', jstTime: '16:15', currency: 'EUR', title: 'French Flash Manufacturing PMI' },
    { jstDate: '2026-08-21', jstTime: '16:30', currency: 'EUR', title: 'German Flash Manufacturing PMI' },
    { jstDate: '2026-08-21', jstTime: '16:30', currency: 'EUR', title: 'German Flash Services PMI' },
    { jstDate: '2026-08-21', jstTime: '17:00', currency: 'EUR', title: 'Flash Manufacturing PMI' },
    { jstDate: '2026-08-21', jstTime: '17:00', currency: 'EUR', title: 'Flash Services PMI' },
    { jstDate: '2026-08-21', jstTime: '17:30', currency: 'GBP', title: 'Flash Manufacturing PMI' },
    { jstDate: '2026-08-21', jstTime: '17:30', currency: 'GBP', title: 'Flash Services PMI' },
    { jstDate: '2026-08-21', jstTime: '21:30', currency: 'CAD', title: 'Core Retail Sales m/m' },
    { jstDate: '2026-08-21', jstTime: '21:30', currency: 'CAD', title: 'Retail Sales m/m' },
    { jstDate: '2026-08-21', jstTime: '22:45', currency: 'USD', title: 'Flash Manufacturing PMI' },
  ];

  const result = crossCheck(ledgerEvents, ffEvents);

  assert.equal(result.matched.length, 13, JSON.stringify(result.matched.map((m) => m.eventId)));
  assert.equal(result.notFoundInFf.length, 0, JSON.stringify(result.notFoundInFf.map((n) => n.eventId)));
  assert.equal(result.discrepancies.length, 1);
  assert.deepEqual(result.discrepancies[0], {
    event_id: 'de-sentiment-2026-08-18',
    name_ja: 'ZEW景況感指数',
    country: 'DE',
    date_jst: '2026-08-18',
    ledger_time_jst: '18:05',
    ff_time_jst_candidates: ['18:00'],
    ff_titles: ['German ZEW Economic Sentiment'],
  });
});

// task #93（2026-09-06、しょうさん指示: Manus突合廃止に伴う欠落検知強化の1点目
// 「FF突合の欠落検出への拡張」）: 「FF→台帳」の逆方向検査。このセッション中に実際に発生した
// 完全欠落クラスのバグ（米新規失業保険申請件数が丸ごと未実装だった、task #89）を、
// もしManus突合ではなくこの機構が先に検出していたら捕まえられたはずのシナリオとして再現する
test('findMissingHighImpactFfEvents: 高インパクトFFイベントに対応する台帳イベントが1件も無ければ検出する（task #89の再現）', () => {
  const ledgerEvents = [
    { country: 'US', kind: 'ppi', dateJst: '2026-09-10' },
  ];
  const ffEvents = [
    { jstDate: '2026-09-10', jstTime: '21:30', currency: 'USD', title: 'PPI m/m', impact: 'High' },
    // task #89が実際に発覚する前の状態を再現: 新規失業保険申請件数はFFにHigh impactで載っているが、
    // 当時のconfig/event-names.json・importance-rules.jsonには一切登録が無く、台帳に対応イベントが無い
    { jstDate: '2026-09-10', jstTime: '21:30', currency: 'USD', title: 'Unemployment Claims', impact: 'High' },
  ];
  const result = findMissingHighImpactFfEvents(ledgerEvents, ffEvents);
  assert.equal(result.missingRecognizedKind.length, 1);
  assert.equal(result.missingRecognizedKind[0].title, 'Unemployment Claims');
  assert.deepEqual(result.missingRecognizedKind[0].matched_kinds, ['jobless_claims']);
  assert.deepEqual(result.missingRecognizedKind[0].applicable_countries, ['US']);
});

test('findMissingHighImpactFfEvents: 対応する台帳イベントがあれば検出しない', () => {
  const ledgerEvents = [{ country: 'US', kind: 'jobless_claims', dateJst: '2026-09-10' }];
  const ffEvents = [{ jstDate: '2026-09-10', jstTime: '21:30', currency: 'USD', title: 'Unemployment Claims', impact: 'High' }];
  const result = findMissingHighImpactFfEvents(ledgerEvents, ffEvents);
  assert.equal(result.missingRecognizedKind.length, 0);
});

test('findMissingHighImpactFfEvents: Medium/Lowインパクトは対象外（ノイズ回避）', () => {
  const ffEvents = [
    { jstDate: '2026-09-10', jstTime: '21:30', currency: 'USD', title: 'Unemployment Claims', impact: 'Medium' },
    { jstDate: '2026-09-10', jstTime: '21:30', currency: 'USD', title: 'Some Low Impact Thing', impact: 'Low' },
  ];
  const result = findMissingHighImpactFfEvents([], ffEvents);
  assert.equal(result.missingRecognizedKind.length, 0);
  assert.equal(result.unrecognizedKind.length, 0);
});

test('findMissingHighImpactFfEvents: 追跡していない通貨は対象外', () => {
  const ffEvents = [{ jstDate: '2026-09-10', jstTime: '10:00', currency: 'ZAR', title: 'Some ZAR High Impact Event', impact: 'High' }];
  const result = findMissingHighImpactFfEvents([], ffEvents);
  assert.equal(result.missingRecognizedKind.length, 0);
  assert.equal(result.unrecognizedKind.length, 0);
});

test('findMissingHighImpactFfEvents: KIND_KEYWORDSのどれにも一致しないタイトルはunrecognizedKindへ（run失敗の対象外）', () => {
  const ffEvents = [{ jstDate: '2026-09-10', jstTime: '10:00', currency: 'USD', title: 'Some Brand New Indicator Nobody Has Modeled', impact: 'High' }];
  const result = findMissingHighImpactFfEvents([], ffEvents);
  assert.equal(result.missingRecognizedKind.length, 0);
  assert.equal(result.unrecognizedKind.length, 1);
  assert.equal(result.unrecognizedKind[0].title, 'Some Brand New Indicator Nobody Has Modeled');
});

// EUR通貨はEU（ユーロ圏集計）・DE（ドイツ単独）の両方に対応しうるため、逆方向でも
// matchesCountryQualifierで正しく振り分けられることを確認する（forward方向のtask #53と同じ懸念）
test('findMissingHighImpactFfEvents: EUR通貨のEU集計値・DE単独値を国名修飾語で正しく振り分ける', () => {
  const ledgerEvents = [{ country: 'EU', kind: 'sentiment', dateJst: '2026-09-10' }];
  const ffEvents = [
    // ドイツ単独のZEW（Highと仮定）は台帳にDE分の対応イベントが無いため検出されるべき
    { jstDate: '2026-09-10', jstTime: '18:00', currency: 'EUR', title: 'German ZEW Economic Sentiment', impact: 'High' },
    // ユーロ圏集計のZEWは台帳のEU分と対応するため検出されないべき
    { jstDate: '2026-09-10', jstTime: '18:00', currency: 'EUR', title: 'ZEW Economic Sentiment', impact: 'High' },
  ];
  const result = findMissingHighImpactFfEvents(ledgerEvents, ffEvents);
  assert.equal(result.missingRecognizedKind.length, 1);
  assert.equal(result.missingRecognizedKind[0].title, 'German ZEW Economic Sentiment');
  assert.deepEqual(result.missingRecognizedKind[0].applicable_countries, ['DE']);
});
