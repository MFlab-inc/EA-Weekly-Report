'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWeekFromFileName, sortedWeeks, buildIndexHtml } = require('../scripts/render/build-pages-index');

test('parseWeekFromFileName: ea-weekly-YYYYMMDD.html形式を解析する', () => {
  assert.deepEqual(parseWeekFromFileName('ea-weekly-20260817.html'), { fileName: 'ea-weekly-20260817.html', ymd: '2026-08-17', sortKey: '20260817' });
});

test('parseWeekFromFileName: 形式に合わないファイル名はnull', () => {
  assert.equal(parseWeekFromFileName('index.html'), null);
  assert.equal(parseWeekFromFileName('ea-weekly-2026-08-17.html'), null);
});

test('sortedWeeks: 新しい週が先頭になるよう降順ソートし、パース不能なものは除外する', () => {
  const result = sortedWeeks(['ea-weekly-20260803.html', 'ea-weekly-20260817.html', 'ea-weekly-20260810.html', 'README.html']);
  assert.deepEqual(result.map((w) => w.ymd), ['2026-08-17', '2026-08-10', '2026-08-03']);
});

test('buildIndexHtml: 空配列でも例外にならず「まだレポートがありません」を出す', () => {
  const html = buildIndexHtml([]);
  assert.match(html, /まだレポートがありません/);
});

test('buildIndexHtml: 最新週にlatestバッジを付け、各週のリンクを含む', () => {
  const html = buildIndexHtml(['ea-weekly-20260803.html', 'ea-weekly-20260817.html', 'ea-weekly-20260810.html']);
  assert.match(html, /href="\.\/output\/ea-weekly-20260817\.html"/);
  assert.match(html, /2026-08-17週<span class="latest">最新<\/span>/);
  assert.match(html, /href="\.\/output\/ea-weekly-20260803\.html"/);
  // 2番目以降にはlatestバッジが付かない
  const idx2026_08_10 = html.indexOf('2026-08-10週');
  assert.ok(!html.slice(idx2026_08_10, idx2026_08_10 + 40).includes('latest'));
});

test('buildIndexHtml: HTMLエスケープする（ファイル名由来の値のみのため通常は不要だが念のため）', () => {
  const html = buildIndexHtml(['ea-weekly-20260817.html'], { generatedAt: '<script>' });
  assert.doesNotMatch(html, /<script>2026/);
  assert.match(html, /&lt;script&gt;/);
});
