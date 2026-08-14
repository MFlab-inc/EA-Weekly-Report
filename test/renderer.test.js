'use strict';
// レンダラーの回帰テスト（しょうさん指示・2026-08-14条件4）:
// templates/design-mock_v1.2.html自身のデータ（2026-08-10週）をweek-data-20260810.jsとして
// 転記し、レンダラーに通した出力の停止バー%・▲位置・停止目安テキスト・イベントカードID列・
// ヒーロー統計が、モックの実際のHTML文字列と完全一致することを検証する。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildReportData } = require('../scripts/render/build-report-data');
const { renderReportHtml } = require('../scripts/render/html-renderer');
const weekData20260810 = require('../scripts/render/week-data-20260810');

const reportPolicy = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'report-policy.json'), 'utf8'));
const btcGuide = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'btc-weekend-guide.json'), 'utf8'));
const mock = readFileSync(join(__dirname, '..', 'templates', 'design-mock_v1.2.html'), 'utf8');

function haltDayBlock(html, date) {
  const start = html.indexOf(`<div class="ea-halt-day" data-ea-date="${date}"`);
  const next = html.indexOf('<div class="ea-halt-day"', start + 10);
  const boundary = html.indexOf('停止・再開の最終判断', start);
  const end = Math.min(...[next, boundary].filter((x) => x > 0).concat([html.length]));
  return html.slice(start, end);
}

function barsAndTriangles(block) {
  const bars = [...block.matchAll(/left:([\d.]+)%;width:([\d.]+)%;background:linear-gradient/g)].map((m) => [m[1], m[2]]);
  const triangles = [...block.matchAll(/top:-8px;left:([\d.]+)%/g)].map((m) => m[1]);
  return { bars, triangles };
}

const generated = renderReportHtml(buildReportData(weekData20260810), { reportPolicy, btcGuide });

test('renderer: 生成HTMLがdata-ea-report-meta等の必須data-ea-*属性を持つ', () => {
  assert.match(generated, /data-ea-report-meta="ea-weekly-20260810"/);
  assert.match(generated, /data-ea-layout-version="ea-only-v4"/);
  assert.match(generated, /class="ea-section-band"/);
  assert.match(generated, /class="ea-halt-day"/);
  assert.match(generated, /class="ea-date-group"/);
  assert.match(generated, /class="ea-event-card"/);
});

for (const date of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']) {
  test(`renderer: ${date}の停止バー%・▲位置がdesign-mock_v1.2.htmlと完全一致`, () => {
    const genBlock = haltDayBlock(generated, date);
    const mockBlock = haltDayBlock(mock, date);
    const gen = barsAndTriangles(genBlock);
    const moc = barsAndTriangles(mockBlock);
    assert.deepEqual(gen.bars, moc.bars, `${date}: bars不一致`);
    assert.deepEqual(gen.triangles, moc.triangles, `${date}: triangles不一致`);
  });

  test(`renderer: ${date}の停止目安テキスト行がdesign-mock_v1.2.htmlと完全一致`, () => {
    const genBlock = haltDayBlock(generated, date);
    const mockBlock = haltDayBlock(mock, date);
    const genLine = /<div style="font-size:12.5px;line-height:1.8;color:#2b3d35;">.*?<\/div>/s.exec(genBlock)[0];
    const mockLine = /<div style="font-size:12.5px;line-height:1.8;color:#2b3d35;">.*?<\/div>/s.exec(mockBlock)[0];
    assert.equal(genLine, mockLine);
  });
}

test('renderer: イベントカードのID・重要度の並びがdesign-mock_v1.2.htmlと完全一致', () => {
  const idRe = /ea-event-card" data-ea-event-id="([^"]+)" data-ea-event-importance="(\d)"/g;
  const genIds = [...generated.matchAll(idRe)].map((m) => [m[1], m[2]]);
  const mockIds = [...mock.matchAll(idRe)].map((m) => [m[1], m[2]]);
  assert.deepEqual(genIds, mockIds);
});

test('renderer: ヒーロー統計（★★★件数・発表枠・対象日数）がdesign-mock_v1.2.htmlと完全一致', () => {
  const statRe = /最重要（★★★）\d+件 ／ 発表枠 \d+ ／ 対象 \d+日/;
  assert.equal(statRe.exec(generated)[0], statRe.exec(mock)[0]);
});

test('renderer: 対象週見出し（8月10日（月）〜 8月14日（金））がdesign-mock_v1.2.htmlと完全一致', () => {
  const headerRe = /font-size:21px;font-weight:800;color:#ffffff;[^>]*>([^<]+)</;
  assert.equal(headerRe.exec(generated)[1], headerRe.exec(mock)[1]);
});

test('renderer: show_prev_forecast=falseのため個別イベントカードに前回/予想の数値行が出ない', () => {
  // 数値行はイベントカードのdisplayName直後には出ず、section2劣頭のvalues_off_textとフッターのみに現れる
  const eventCardBlocks = generated.split('class="ea-event-card"').slice(1);
  for (const block of eventCardBlocks) {
    const upToNextCard = block.split('</div>\n      </div>')[0];
    assert.doesNotMatch(upToNextCard, /前回[^ぁ-ん]*予想/, '個別イベントカードに前回/予想の数値行が出てはならない');
  }
});

test('renderer: show_prev_forecast=false時、section2劣頭にvalues_off_textが出る', () => {
  assert.ok(generated.includes(reportPolicy.values_off_text));
});

test('renderer: 禁止語（JST・仮想通貨）が読者向け文言に出ない', () => {
  for (const term of reportPolicy.forbidden_reader_terms) {
    assert.ok(!generated.includes(term), `禁止語「${term}」が出力に含まれている`);
  }
});
