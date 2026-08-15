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
