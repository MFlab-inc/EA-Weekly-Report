'use strict';
// BTC/USD週末ガイドのカード描画（scripts/render/html-renderer.js btcCard()）のテスト。
// 2026-08-22、しょうさん指示: Crypto Risk Monitorダッシュボードカード新設＋既存3チェックポイント
// カードの週末中再確認化（5カード構成）に伴い、card.no位置依存だったレンダリング分岐を
// card.type（text/state_badges/tiers）ベースへ切り替えた。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { btcCard, renderReportHtml } = require('../scripts/render/html-renderer');
const { buildReportData } = require('../scripts/render/build-report-data');
const weekData20260810 = require('../scripts/render/week-data-20260810');

test('btcCard: type=text はtitle+bodyのみ描画する', () => {
  const html = btcCard({ type: 'text', title: '① タイトル', body: '本文テキスト' });
  assert.ok(html.includes('① タイトル'));
  assert.ok(html.includes('本文テキスト'));
  assert.ok(!html.includes('確認先'));
});

test('btcCard: type=state_badges は1リンク＋3状態バッジ＋注記を描画する', () => {
  const html = btcCard({
    type: 'state_badges',
    title: '② 稼働前チェック（Crypto Risk Monitor）',
    check_at: [{ name: 'Crypto Risk Monitor（金曜の事前確認）', url: 'https://mflab-inc.github.io/Crypto-Risk-Monitor/' }],
    states: [
      { symbol: '✓', label: '新規可', tone: 'normal', desc: '通常どおり稼働' },
      { symbol: '◆', label: '新規グリッド禁止', tone: 'partial', desc: '新規グリッドの開始・段数追加を停止' },
      { symbol: '■', label: '新規全停止', tone: 'stop', desc: '新規エントリーを全面停止' },
    ],
    note: '既存ポジションの決済(TP)は常に許可。',
  });
  assert.ok(html.includes('href="https://mflab-inc.github.io/Crypto-Risk-Monitor/"'));
  assert.ok(html.includes('Crypto Risk Monitor（金曜の事前確認）'));
  assert.ok(html.includes('✓新規可'));
  assert.ok(html.includes('◆新規グリッド禁止'));
  assert.ok(html.includes('■新規全停止'));
  assert.ok(html.includes('通常どおり稼働'));
  assert.ok(html.includes('既存ポジションの決済(TP)は常に許可。'));
  // 3状態は色が異なる（normal=緑/partial=黄/stop=橙、既存tierBadgeと同じ配色を流用）
  assert.ok(html.includes('#d1fae5')); // normal
  assert.ok(html.includes('#fef3c7')); // partial
  assert.ok(html.includes('#fde8c8')); // stop
});

test('btcCard: type=tiers はintro・footerと、tiersありitem/note一文のみitemを両方描画する', () => {
  const html = btcCard({
    type: 'tiers',
    title: '③ 週末中の確認（随時）',
    intro: '冒頭の注記文',
    items: [
      {
        label: '1. Crypto Risk Monitorの判定',
        check_at: [{ name: 'Crypto Risk Monitor（週末中の再確認）', url: 'https://mflab-inc.github.io/Crypto-Risk-Monitor/' }],
        note: 'ダッシュボード再確認の指示文',
      },
      {
        label: '2. ニュース・公式発表',
        check_at: [{ name: 'CoinPost（速報）', url: 'https://coinpost.jp/' }],
        tiers: { stop: '重大速報', half: '警戒継続', normal: '特段の報道なし' },
      },
    ],
    footer: '優先規則の一文',
  });
  assert.ok(html.includes('冒頭の注記文'));
  assert.ok(html.includes('Crypto Risk Monitor（週末中の再確認）'));
  assert.ok(html.includes('ダッシュボード再確認の指示文'));
  assert.ok(!html.includes('undefined')); // tiers無しitemがtiersアクセスで例外/undefined化していないか
  assert.ok(html.includes('稼働停止'));
  assert.ok(html.includes('重大速報'));
  assert.ok(html.includes('優先規則の一文'));
});

// 2026-08-22修正の回帰テスト: 旧実装はcheck_atが複数件かつcard.items内のidxが0以外だと
// 「（代替：」を差し込み閉じ括弧を出力しない実装バグがあった（テンプレート正典
// templates/design-mock_v1.2.htmlでは一貫して「　＋　」結合）。idxに関わらず統一結合されることを確認する
test('btcCard: type=tiersの2件目以降のitemでも、複数check_atは「　＋　」で結合され閉じ括弧漏れが起きない', () => {
  const html = btcCard({
    type: 'tiers',
    title: 'タイトル',
    items: [
      { label: '1つ目', check_at: [{ name: 'A', url: null }], tiers: { stop: 's', half: 'h', normal: 'n' } },
      {
        label: '2つ目',
        check_at: [
          { name: 'CoinGecko（日本語）', url: 'https://www.coingecko.com/ja' },
          { name: 'CoinMarketCap（代替）', url: 'https://coinmarketcap.com/ja/' },
        ],
        tiers: { stop: 's', half: 'h', normal: 'n' },
      },
    ],
  });
  assert.ok(html.includes('CoinGecko（日本語）</a>　＋　<a'), '2件目のitem（idx!==0）でも＋結合になっているはず');
  assert.ok(!html.includes('（代替：'), '閉じ括弧の無い旧結合パターンが残っていないこと');
});

test('btcCard: check_atが1件のみの場合は結合記号を挟まない', () => {
  const html = btcCard({
    type: 'state_badges',
    title: 't',
    check_at: [{ name: 'Only', url: 'https://example.com/' }],
    states: [{ symbol: '✓', label: 'L', tone: 'normal', desc: 'd' }],
    note: 'n',
  });
  assert.ok(!html.includes('　＋　'));
});

// 実configでの結合テスト（回帰）: 実際にrenderReportHtmlへ通して5カード構成が
// 例外なく描画でき、しょうさん承認済みの要素（用語統一・URL2箇所・info欠落無し）を確認する
test('renderReportHtml: 実config/btc-weekend-guide.jsonの5カードが例外なく描画され、承認済み要件を満たす', () => {
  const reportPolicy = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'report-policy.json'), 'utf8'));
  const btcGuide = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'btc-weekend-guide.json'), 'utf8'));
  assert.equal(btcGuide.cards.length, 5, 'カードは5枚構成のはず');
  assert.ok(btcGuide.allowed_domains.includes('mflab-inc.github.io'), 'allowed_domainsにmflab-inc.github.ioが必要');

  const html = renderReportHtml(buildReportData(weekData20260810), { reportPolicy, btcGuide });

  // 用語統一: 「新規グリッド禁止」を使用、「新規グリッド停止」は使用しない
  assert.ok(html.includes('新規グリッド禁止'));
  assert.ok(!html.includes('新規グリッド停止'));
  // 閾値の数値は転記しない（ダッシュボード側の仮置き閾値の具体的な言い回しが出現しないことを確認。
  // "80"のような単純な数字文字列は日付・CSS値等と衝突するため、閾値の文脈がわかる語で確認する）
  for (const n of ['パーセンタイル80', '≥95', '150%超', 'ADR20']) assert.ok(!html.includes(n), `閾値関連の文言「${n}」が転記されていないこと`);
  // カード②③でmflab-inc.github.ioへのリンクが2箇所（金曜の事前確認／週末中の再確認）出現する
  const linkCount = (html.match(/mflab-inc\.github\.io\/Crypto-Risk-Monitor/g) || []).length;
  assert.equal(linkCount, 2);
  assert.ok(html.includes('金曜の事前確認'));
  assert.ok(html.includes('週末中の再確認'));
  // 優先規則の文言（カード③末尾）
  assert.ok(html.includes('ダッシュボードの判定と上記の判断が食い違う場合は、より保守的な方を採用してください。'));
});
