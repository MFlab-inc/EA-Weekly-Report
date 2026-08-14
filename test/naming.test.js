'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const naming = require('../scripts/lib/naming');

const officials = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;
const find = (roleJa) => officials.find((o) => o.role_ja === roleJa);

test('policyRateName/quarterlyReportName: design-mock_v1.2.htmlの実例と一致（RBA）', () => {
  assert.equal(naming.policyRateName('RBA'), 'RBA政策金利＆声明発表');
  assert.equal(naming.quarterlyReportName('RBA'), 'RBA四半期金融政策報告');
});

test('pressConferenceName: design-mock_v1.2.htmlの実例と一致（ブロックRBA総裁の記者会見）', () => {
  assert.equal(naming.pressConferenceName(find('RBA総裁'), 'RBA総裁'), 'ブロックRBA総裁の記者会見');
});

test('testimonyName: design-mock_v1.2.htmlの実例と一致（ブロックRBA総裁：下院経済委員会への出席）', () => {
  assert.equal(naming.testimonyName(find('RBA総裁'), 'RBA総裁', '下院経済委員会'), 'ブロックRBA総裁：下院経済委員会への出席');
});

test('nameAndRole: verified:falseの役職は人名を出さない', () => {
  const unverified = { name_ja: '仮名', verified: false };
  assert.equal(naming.nameAndRole(unverified, 'FRB理事'), 'FRB理事');
});

test('bojOpinionsName/bojMinutesName: design-mock_v1.2.htmlの実例と一致', () => {
  assert.equal(naming.bojOpinionsName('7月30・31日開催分'), '日銀 金融政策決定会合における主な意見（7月30・31日開催分）');
  assert.equal(naming.bojMinutesName(), '日銀 金融政策決定会合議事要旨');
});

test('bondAuctionNameJp/bondAuctionNameUs: 既刊実例・SPEC §4.2テンプレートと一致', () => {
  assert.equal(naming.bondAuctionNameJp('10年', '2026年8月'), '10年利付国債（2026年8月債）の入札');
  assert.equal(naming.bondAuctionNameUs('10年'), '米10年債入札');
});
