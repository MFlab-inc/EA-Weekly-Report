'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const naming = require('../scripts/lib/naming');

const officials = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;
const find = (roleJa) => officials.find((o) => o.role_ja === roleJa);

test('policyRateName/quarterlyReportName: 既刊実例と一致（RBA）', () => {
  assert.equal(naming.policyRateName('RBA'), 'RBA政策金利＆声明発表');
  assert.equal(naming.quarterlyReportName('RBA'), 'RBA四半期金融政策報告');
});

test('pressConferenceName: 既刊実例と一致（ブロックRBA総裁の記者会見）', () => {
  assert.equal(naming.pressConferenceName(find('RBA総裁'), 'RBA総裁'), 'ブロックRBA総裁の記者会見');
});

test('testimonyName: 既刊実例と一致（ブロックRBA総裁：下院経済委員会への出席）', () => {
  assert.equal(naming.testimonyName(find('RBA総裁'), 'RBA総裁', '下院経済委員会'), 'ブロックRBA総裁：下院経済委員会への出席');
});

test('nameAndRole: verified:falseの役職は人名を出さない', () => {
  const unverified = { name_ja: '仮名', verified: false };
  assert.equal(naming.nameAndRole(unverified, 'FRB理事'), 'FRB理事');
});

test('bojOpinionsName/bojMinutesName: 既刊実例と一致', () => {
  assert.equal(naming.bojOpinionsName('7月30・31日開催分'), '日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）');
  assert.equal(naming.bojMinutesName('2026年6月15日・16日開催分'), '金融政策決定会合議事要旨（2026年6月15日・16日開催分）');
  assert.equal(naming.bojMinutesName(), '金融政策決定会合議事要旨');
});

test('bondAuctionNameJp/bondAuctionNameUs: 既刊実例・SPEC §4.2テンプレートと一致', () => {
  assert.equal(naming.bondAuctionNameJp('10年', '2026年8月'), '10年利付国債（2026年8月債）の入札');
  assert.equal(naming.bondAuctionNameJp('30年', '2026年8月'), '30年利付国債（2026年8月債）の入札');
  assert.equal(naming.bondAuctionNameUs('10年'), '米10年債入札');
});

// 既刊2週（reference/sample-report_20260808.html）の実表記を正解データとした回帰テスト
// （2026-08-15しょうさん指示「既刊2週の実表記を正解データとして、命名結果が一致することを
// テストしてください」）。抽出方法: 2026-08-10週はdata-ea-event-display-name-ja属性、
// 2026-08-03週はaria-level="4"見出しテキスト（node -eで直接抽出・目視確認済み）。
test('既刊2週の実表記との一致（ground truth regression）', () => {
  const cases = [
    // 2026-08-10週（jp-boj-summary-2026-08-10）
    { got: naming.bojOpinionsName('7月30・31日開催分'), want: '日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）' },
    // 2026-08-10週（au-rba-rate-2026-08-11）
    { got: naming.policyRateName('RBA'), want: 'RBA政策金利＆声明発表' },
    // 2026-08-10週（au-rba-smp-2026-08-11）
    { got: naming.quarterlyReportName('RBA'), want: 'RBA四半期金融政策報告' },
    // 2026-08-10週（au-rba-press-2026-08-11）
    { got: naming.pressConferenceName(find('RBA総裁'), 'RBA総裁'), want: 'ブロックRBA総裁の記者会見' },
    // 2026-08-10週（au-rba-bullock-2026-08-14）
    { got: naming.testimonyName(find('RBA総裁'), 'RBA総裁', '下院経済委員会'), want: 'ブロックRBA総裁：下院経済委員会への出席' },
    // 2026-08-03週（jp_boj_minutes_20260805、aria-level="4"見出し）
    { got: naming.bojMinutesName('2026年6月15日・16日開催分'), want: '金融政策決定会合議事要旨（2026年6月15日・16日開催分）' },
    // 2026-08-03週（jp_jgb_10y_auction_20260804）
    { got: naming.bondAuctionNameJp('10年', '2026年8月'), want: '10年利付国債（2026年8月債）の入札' },
    // 2026-08-03週（jp_jgb_30y_auction_20260806）
    { got: naming.bondAuctionNameJp('30年', '2026年8月'), want: '30年利付国債（2026年8月債）の入札' },
  ];
  for (const c of cases) assert.equal(c.got, c.want);
});

// us_cook_speech_20260805は既刊生HTML上は「FRB理事リサ・クック講演」（役職+フルネーム+講演、
// SPEC §4.2の「{人名}{役職}の発言」とは異なる語順）だが、Cook氏はconfig/officials.json未登録
// （task #17）のため、SPEC §4.2の「verified:falseは役職のみ」規則どおり「FRB理事の発言」と
// 役職のみで命名するのが正しい（人名を推測で埋めない。既存のweek-data-20260803.jsのdisplayName
// 'FRB理事の発言'と同じ判断）。既刊の生テキストをそのまま再現することは意図的に不採用とする
test('official_speech: 既刊のCook講演はverified:falseのため役職のみで命名する（人名は推測しない）', () => {
  const unverifiedCook = { name_ja: 'クック', verified: false };
  assert.equal(naming.speechName(unverifiedCook, 'FRB理事'), 'FRB理事の発言');
});

// 8中銀すべてに命名テンプレートが効くことの確認（policy_rate/quarterly_report/press_conference）。
// RBA以外は既刊2週に実例が無いため、SPEC §4.2テンプレート・config/officials.jsonの実データに
// 対する機械的な一貫性の確認（ground truthとの一致ではない点に注意）
test('policyRateName: 8中銀すべてで規則どおりの文字列を生成する', () => {
  const expected = {
    日銀: '日銀政策金利＆声明発表',
    FRB: 'FRB政策金利＆声明発表',
    RBA: 'RBA政策金利＆声明発表',
    ECB: 'ECB政策金利＆声明発表',
    BOE: 'BOE政策金利＆声明発表',
    BOC: 'BOC政策金利＆声明発表',
    RBNZ: 'RBNZ政策金利＆声明発表',
    SNB: 'SNB政策金利＆声明発表',
  };
  for (const [abbr, want] of Object.entries(expected)) {
    assert.equal(naming.policyRateName(abbr), want);
  }
});

test('pressConferenceName: 8中銀すべてでofficials.jsonの現職者名・役職を反映する', () => {
  const cases = [
    ['日銀総裁', '植田日銀総裁の記者会見'],
    ['FRB議長', 'ウォーシュFRB議長の記者会見'],
    ['RBA総裁', 'ブロックRBA総裁の記者会見'],
    ['ECB総裁', 'ラガルドECB総裁の記者会見'],
    ['BOE総裁', 'ベイリーBOE総裁の記者会見'],
    ['BOC総裁', 'マックレムBOC総裁の記者会見'],
    ['RBNZ総裁', 'ブレマンRBNZ総裁の記者会見'],
    ['SNB総裁', 'シュレーゲルSNB総裁の記者会見'],
  ];
  for (const [roleJa, want] of cases) {
    assert.equal(naming.pressConferenceName(find(roleJa), roleJa), want);
  }
});

test('BANK_ABBR_BY_COUNTRY: 8中銀すべてのISO国コードを網羅する', () => {
  assert.deepEqual(naming.BANK_ABBR_BY_COUNTRY, {
    JP: '日銀', US: 'FRB', AU: 'RBA', EU: 'ECB',
    GB: 'BOE', CA: 'BOC', NZ: 'RBNZ', CH: 'SNB',
  });
});

test('resolveGovernor: country×role_type=central_bank_governorで1件解決する', () => {
  const gov = naming.resolveGovernor(officials, 'CH');
  assert.equal(gov.role_ja, 'SNB総裁');
  assert.equal(gov.name_ja, 'シュレーゲル');
});

test('resolveGovernor: 該当なしはnull（財務長官等はcentral_bank_governorではない）', () => {
  assert.equal(naming.resolveGovernor(officials, 'JP_NONEXISTENT'), null);
  const financeMinistryOnly = officials.filter((o) => o.role_type !== 'central_bank_governor');
  assert.equal(naming.resolveGovernor(financeMinistryOnly, 'US'), null);
});
