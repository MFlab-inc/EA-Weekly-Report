'use strict';
// scripts/check/policy-lint.mjs のユニットテスト（task #13・SPEC.md §8「新設」）。
// checkLinkReachability以外は純粋関数のためモック無しで直接検証できる。
// checkLinkReachabilityはfetchImplを注入してネットワークアクセス無しでテストする（ci.yml対応）。
const { test } = require('node:test');
const assert = require('node:assert/strict');

async function loadPolicyLint() {
  return import('../scripts/check/policy-lint.mjs');
}

test('lintForbiddenTags: script/style/formタグとonXxxハンドラを検出する', async () => {
  const { lintForbiddenTags } = await loadPolicyLint();
  const errors = lintForbiddenTags('<div>ok</div><script>bad</script><button onclick="x()">bad</button>');
  assert.ok(errors.some((e) => e.includes('<script>')));
  assert.ok(errors.some((e) => e.includes('onclick')));
});

test('lintForbiddenTags: 禁止タグが無ければエラー無し', async () => {
  const { lintForbiddenTags } = await loadPolicyLint();
  assert.deepEqual(lintForbiddenTags('<div><span>ok</span></div>'), []);
});

test('lintForbiddenTerms: 読者向け禁止語（JST・仮想通貨）を検出する', async () => {
  const { lintForbiddenTerms } = await loadPolicyLint();
  const errors = lintForbiddenTerms('発表は21:30 JSTです。仮想通貨の話題も。', ['JST', '仮想通貨']);
  assert.equal(errors.length, 2);
});

test('lintForbiddenTerms: 禁止語が無ければエラー無し', async () => {
  const { lintForbiddenTerms } = await loadPolicyLint();
  assert.deepEqual(lintForbiddenTerms('発表は21:30 日本時間です。', ['JST', '仮想通貨']), []);
});

test('lintForbiddenSections: 市況サマリー等の禁止セクションを検出する', async () => {
  const { lintForbiddenSections } = await loadPolicyLint();
  const errors = lintForbiddenSections('今週の市況サマリー：ドル円は堅調', ['市況サマリー', '相場展望']);
  assert.equal(errors.length, 1);
});

test('lintDisclaimerPresence: footer_disclaimer/footer_source_statementが無ければエラー', async () => {
  const { lintDisclaimerPresence } = await loadPolicyLint();
  const errors = lintDisclaimerPresence('本文のみ', { footer_disclaimer: '免責文言', footer_source_statement: '出典文言' });
  assert.equal(errors.length, 2);
});

test('lintDisclaimerPresence: 両方存在すればエラー無し', async () => {
  const { lintDisclaimerPresence } = await loadPolicyLint();
  const errors = lintDisclaimerPresence('本文 免責文言 出典文言 続き', { footer_disclaimer: '免責文言', footer_source_statement: '出典文言' });
  assert.deepEqual(errors, []);
});

test('extractHrefs: aタグのhrefを抽出する', async () => {
  const { extractHrefs } = await loadPolicyLint();
  const hrefs = extractHrefs('<a href="https://coinpost.jp/">x</a><a href="https://example.test/y">y</a>');
  assert.deepEqual(hrefs, ['https://coinpost.jp/', 'https://example.test/y']);
});

test('lintLinkDomains: 許可ドメイン外のリンクを検出する（類似ドメイン事故防止）', async () => {
  const { lintLinkDomains } = await loadPolicyLint();
  const errors = lintLinkDomains(['https://coinpost.jp/', 'https://coindeskjapan.co.jp/fake'], ['coinpost.jp', 'www.coindesk.com']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /coindeskjapan\.co\.jp/);
});

test('lintLinkDomains: 不正なURL・非http(s)スキームを検出する', async () => {
  const { lintLinkDomains } = await loadPolicyLint();
  const errors = lintLinkDomains(['not a url', 'javascript:alert(1)'], ['coinpost.jp']);
  assert.equal(errors.length, 2);
});

// task #54（2026-08-15、しょうさん指摘: DE国追加時にCOUNTRY_JA_BY_ISOへの登録漏れで
// 国名ピル・ヒーロー文言が「DE」のまま漏れ「DEDE」と二重表示された）の回帰テスト。
// 国名ピル<span>DE</span>通貨ピル<span>DE</span>はstripTags（各タグを空白1個に置換）を
// 経由すると「DE DE」相当のテキストになる（実際のrunStaticLint内部の処理を反映した入力）
test('lintLeakedCountryCodes: 読者可視テキストに生のISO国コードが漏れていれば検出する（ピル同士が隣接するケース）', async () => {
  const { lintLeakedCountryCodes } = await loadPolicyLint();
  const errors = lintLeakedCountryCodes('DE DE ▲18:05 ZEW景況感指数', ['DE', 'GB', 'JP']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /DE/);
});

test('lintLeakedCountryCodes: 日本語国名（ドイツ・英国等）のみならエラー無し', async () => {
  const { lintLeakedCountryCodes } = await loadPolicyLint();
  const errors = lintLeakedCountryCodes('ドイツZEW景況感指数 8/18、英国雇用統計 8/18', ['DE', 'GB', 'JP']);
  assert.deepEqual(errors, []);
});

test('lintLeakedCountryCodes: 通貨コード（JPY・USD等の3文字）とは単語境界で衝突しない', async () => {
  const { lintLeakedCountryCodes } = await loadPolicyLint();
  const errors = lintLeakedCountryCodes('米国雇用統計（USD高） 日本のCPI（JPY安）', ['US', 'JP']);
  assert.deepEqual(errors, []);
});

// 既知の限界（policy-lint.mjsのコメント参照）: リーク値の直後に区切り無しで別のラテン文字列が
// 続く場合（修正漏れの「DE」+「ZEW景況感指数」）は単語境界が内部に無く検出できない。
// この完全な取りこぼしはvalidate-country-currency-coverage.jsのrawCodeLeakチェックで捕捉する
test('lintLeakedCountryCodes: 既知の限界 — リーク値の直後に区切り無しでラテン文字列が続くと検出できない', async () => {
  const { lintLeakedCountryCodes } = await loadPolicyLint();
  const errors = lintLeakedCountryCodes('DEZEW景況感指数 8/18', ['DE']);
  assert.deepEqual(errors, []); // 本来は漏れだが、この関数の設計上は検出不可（コメント参照）
});

// 2026-08-29追加（しょうさん指摘: AU/gdpの手動登録エントリでdisplay_nameに公式英語名の断片
// 『Australian National Accounts』がそのまま残っていたが、既存のforbidden_reader_terms・
// lintLeakedCountryCodesのどちらも検出できなかった）。「大文字始まりの単語が2語以上連続」
// という強めのシグナルで検出する（ea-halt-day/ea-date-group内に限定）
test('lintEnglishEventNameLeak: ea-date-group内の英語表記の断片（複数語連続）を検出する', async () => {
  const { lintEnglishEventNameLeak } = await loadPolicyLint();
  const html = '<div class="ea-date-group" data-ea-date="2026-09-02" data-ea-date-event-count="1"><div class="ea-event-card" data-ea-event-id="au-gdp-2026-09-02" data-ea-event-importance="3"><span>GDP（Australian National Accounts）</span></div></div>';
  const errors = lintEnglishEventNameLeak(html);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Australian National Accounts/);
});

test('lintEnglishEventNameLeak: ea-halt-day内の英語表記も検出する', async () => {
  const { lintEnglishEventNameLeak } = await loadPolicyLint();
  const html = '<div class="ea-halt-day" data-ea-date="2026-09-02"><span>GDP（Australian National Accounts）</span></div>';
  const errors = lintEnglishEventNameLeak(html);
  assert.equal(errors.length, 1);
});

// 国名ピル「NZ」＋通貨ピル「NZD」、国名ピル「NZ」＋中銀略称「RBNZ」開始の名称のように、
// 全て大文字のコード・略称同士が隣接して「2語連続」に見えるケースは誤検知にしない
// （実際にrunStaticLintを通した8/31週の実生成HTMLで発生していた誤検知パターンの回帰テスト）
test('lintEnglishEventNameLeak: 全大文字コード同士の隣接（NZ NZD・NZ RBNZ等）は誤検知しない', async () => {
  const { lintEnglishEventNameLeak } = await loadPolicyLint();
  const html = '<div class="ea-halt-day" data-ea-date="2026-09-02">'
    + '<span>NZ</span><span>NZD</span>　▲<span>11:00</span>　RBNZ政策金利＆声明発表'
    + '</div>';
  assert.deepEqual(lintEnglishEventNameLeak(html), []);
});

test('lintEnglishEventNameLeak: 単体の英語略称（GDP・ISM・RBNZ等）は誤検知しない', async () => {
  const { lintEnglishEventNameLeak } = await loadPolicyLint();
  const html = '<div class="ea-date-group" data-ea-date="2026-09-01" data-ea-date-event-count="1"><div class="ea-event-card" data-ea-event-id="us-pmi_ism-2026-09-01" data-ea-event-importance="3"><span>ISM製造業景況指数</span></div></div>';
  assert.deepEqual(lintEnglishEventNameLeak(html), []);
});

// 土日のBTC/USDガイド（Crypto Risk Monitor・TradingView等の承認済み外部サイト名）は
// ea-halt-day/ea-date-groupのclassを持たないため、スコープ限定により対象外になることを確認する
test('lintEnglishEventNameLeak: ea-halt-day/ea-date-group以外（BTCガイド等）は対象外', async () => {
  const { lintEnglishEventNameLeak } = await loadPolicyLint();
  const html = '<div style="padding:0 14px 10px;"><a href="https://mflab-inc.github.io/Crypto-Risk-Monitor/">Crypto Risk Monitor（金曜の事前確認）</a></div>';
  assert.deepEqual(lintEnglishEventNameLeak(html), []);
});

// runStaticLintのデフォルトcountryCodesはCOUNTRY_JA_BY_ISOからNZ（意図的に生コードのまま
// 表示する既刊実例）を除外している。含めてしまうと「NZ雇用統計」等の正常表記を誤検出する
test('runStaticLint: デフォルトの国コード検査はNZを除外する（意図的な非日本語化のため誤検出しない）', async () => {
  const { runStaticLint } = await loadPolicyLint();
  const html = '<div>NZ雇用統計 8/5 免責文言 出典文言</div>';
  const errors = runStaticLint(html, {
    reportPolicy: { forbidden_reader_terms: [], forbidden_sections: [], footer_disclaimer: '免責文言', footer_source_statement: '出典文言' },
    btcGuide: { allowed_domains: [] },
  });
  assert.deepEqual(errors.filter((e) => e.startsWith('LEAKED_COUNTRY_CODE')), []);
});

test('runStaticLint: 妥当なHTMLはエラー無し', async () => {
  const { runStaticLint } = await loadPolicyLint();
  const html = '<div>発表は21:30 日本時間です。免責文言 出典文言 <a href="https://coinpost.jp/">CoinPost</a></div>';
  const errors = runStaticLint(html, {
    reportPolicy: { forbidden_reader_terms: ['JST', '仮想通貨'], forbidden_sections: ['市況サマリー'], footer_disclaimer: '免責文言', footer_source_statement: '出典文言' },
    btcGuide: { allowed_domains: ['coinpost.jp'] },
  });
  assert.deepEqual(errors, []);
});

test('checkLinkReachability: fetchImplを注入してネットワーク無しで到達性チェックできる（WARNING扱い）', async () => {
  const { checkLinkReachability } = await loadPolicyLint();
  const fetchImpl = async (url) => (url.includes('down') ? { ok: false, status: 503 } : { ok: true, status: 200 });
  const warnings = await checkLinkReachability(['https://up.example/', 'https://down.example/'], { fetchImpl });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /down\.example/);
});

test('checkLinkReachability: fetch例外もWARNING化する（HOLDしない）', async () => {
  const { checkLinkReachability } = await loadPolicyLint();
  const fetchImpl = async () => {
    throw new Error('network unreachable');
  };
  const warnings = await checkLinkReachability(['https://example.test/'], { fetchImpl });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /network unreachable/);
});

test('checkLinkReachability: HEADが405/501の場合はGETへフォールバックする', async () => {
  const { checkLinkReachability } = await loadPolicyLint();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(opts.method);
    if (opts.method === 'HEAD') return { ok: false, status: 405 };
    return { ok: true, status: 200 };
  };
  const warnings = await checkLinkReachability(['https://example.test/'], { fetchImpl });
  assert.deepEqual(calls, ['HEAD', 'GET']);
  assert.deepEqual(warnings, []);
});
