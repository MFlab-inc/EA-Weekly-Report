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
const weekData20260803 = require('../scripts/render/week-data-20260803');

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

// しょうさん指摘（2026-08-14修正1）: ★★★イベントがゼロの日は帯・▲・件数バッジ・説明文が
// すべて空になり、「イベントなし」と「取得失敗」の区別がつかなかった。halt_no_star3_noteを
// 説明文位置に明示することで解消する（8/3週の2026-08-04が実例）。
const generated0803 = renderReportHtml(buildReportData(weekData20260803), { reportPolicy, btcGuide });

test('renderer: ★★★イベントがゼロの日はhalt_no_star3_noteが説明文位置に出る（帯・▲は空のまま）', () => {
  const block = haltDayBlock(generated0803, '2026-08-04');
  const { bars, triangles } = barsAndTriangles(block);
  assert.deepEqual(bars, [], '2026-08-04: ★★★がないため帯は空のはず');
  assert.deepEqual(triangles, [], '2026-08-04: ★★★がないため▲は空のはず');
  assert.ok(block.includes(reportPolicy.halt_no_star3_note), 'halt_no_star3_noteが出力に含まれていない');
});

// しょうさん指摘（2026-08-14修正2・任意対応）: 同一時刻の▲が完全に重なる場合は重複描画しない
test('renderer: 同一時刻（同一leftPct）の▲は重複描画されない（8/7 カナダ雇用統計・米雇用統計とも21:30）', () => {
  const block = haltDayBlock(generated0803, '2026-08-07');
  const { triangles } = barsAndTriangles(block);
  assert.equal(triangles.length, 1, '21:30の▲は1つにまとめられているはず');
});

// task #47実バグ修正（2026-08-15、しょうさん監査指摘）: 8/17週フルパイプライン実ネットワーク
// 検証でFOMC議事録8/20(木)03:00の停止窓が丸ごと前日8/19(水)に収まり、修正前は8/20のバーに
// 「停止開始目安 00:00–23:00（前日 水曜15:00〜を含む）」という23時間停止の誤表示が出ていた。
// 実際のFOMC議事録ケースを模した5日分の合成weekInputで、(a)発表日(8/20)自身にはバーが無く
// 「前日 水曜15:00–23:00」という正しいレンジ文言になること、(b)前日(8/19)のバーに実際の
// 停止帯（15:00-23:00）が描画されること、(c)前日のカードに翌日発表分である旨の注記が
// 付くこと、を検証する
const weekDataEntirelyPrevDay = {
  reportMeta: 'ea-weekly-test-entirely-prevday',
  createdDateJa: '2026年8月15日（土）',
  targetWeekStart: '2026-08-17',
  targetWeekEnd: '2026-08-21',
  heroSummary: 'FOMC議事録を確認する週',
  heroPills: ['FOMC議事録 8/20'],
  days: [
    { date: '2026-08-17', md: '8/17', weekday: '月', events: [], windowGroups: [] },
    { date: '2026-08-18', md: '8/18', weekday: '火', events: [], windowGroups: [] },
    { date: '2026-08-19', md: '8/19', weekday: '水', events: [], windowGroups: [] },
    {
      date: '2026-08-20', md: '8/20', weekday: '木',
      events: [
        { id: 'us-fomc-minutes-2026-08-20', time: '03:00', importance: 3, countryJa: '米国', currency: 'USD', displayName: 'FOMC議事録' },
      ],
      windowGroups: [
        { firstTime: '03:00', lastTime: '03:00', countryJa: '米国', currency: 'USD', labelItems: [{ time: '03:00', text: 'FOMC議事録' }] },
      ],
    },
    { date: '2026-08-21', md: '8/21', weekday: '金', events: [], windowGroups: [] },
  ],
};
const generatedEntirelyPrevDay = renderReportHtml(buildReportData(weekDataEntirelyPrevDay), { reportPolicy, btcGuide });

test('renderer: 停止窓が丸ごと前日に収まる場合（FOMC 8/20 03:00）— 発表日自身のバーは空で、レンジ文言は前日を明示', () => {
  const block = haltDayBlock(generatedEntirelyPrevDay, '2026-08-20');
  const { bars, triangles } = barsAndTriangles(block);
  assert.deepEqual(bars, [], '発表日自身には停止窓の帯が描画されないはず（窓は丸ごと前日）');
  assert.equal(triangles.length, 1, '発表時刻の▲は発表日自身に残るはず');
  assert.ok(block.includes('停止開始目安 前日 水曜'), 'レンジ文言が前日を明示していない');
  assert.ok(block.includes('15:00–23:00'), '前日の実際の停止範囲(15:00-23:00)が表示されていない');
  assert.ok(!block.includes('00:00–23:00'), '修正前の誤表示（00:00–23:00）が残っている');
});

test('renderer: 停止窓が丸ごと前日に収まる場合 — 前日(8/19)のバーに実際の停止帯が描画され、翌日発表分の注記が付く', () => {
  const block = haltDayBlock(generatedEntirelyPrevDay, '2026-08-19');
  const { bars } = barsAndTriangles(block);
  assert.equal(bars.length, 1, '前日のバーに帯が1本描画されるはず');
  // 15:00=900分=62.5%、8時間=480分=33.3%
  assert.equal(bars[0][0], '62.5');
  assert.equal(bars[0][1], '33.3');
  assert.ok(block.includes('翌日03:00発表'), '翌日発表分である旨の注記が無い');
  assert.ok(block.includes('FOMC議事録'), '注記に発表名が含まれていない');
});

// task #47実バグ修正: 月曜早朝発表（窓が丸ごと日曜に収まる）は対象週外（日曜）のため
// バー自体は描画されず、注記のみで「週明けの取引開始時点からの停止が目安」を伝える
const weekDataMondayEntirelyPrevDay = {
  ...weekDataEntirelyPrevDay,
  days: [
    {
      date: '2026-08-17', md: '8/17', weekday: '月',
      events: [
        { id: 'jp-test-midnight-2026-08-17', time: '00:30', importance: 3, countryJa: '日本', currency: 'JPY', displayName: 'テスト深夜発表イベント' },
      ],
      windowGroups: [
        { firstTime: '00:30', lastTime: '00:30', countryJa: '日本', currency: 'JPY', labelItems: [{ time: '00:30', text: 'テスト深夜発表イベント' }] },
      ],
    },
    { date: '2026-08-18', md: '8/18', weekday: '火', events: [], windowGroups: [] },
    { date: '2026-08-19', md: '8/19', weekday: '水', events: [], windowGroups: [] },
    { date: '2026-08-20', md: '8/20', weekday: '木', events: [], windowGroups: [] },
    { date: '2026-08-21', md: '8/21', weekday: '金', events: [], windowGroups: [] },
  ],
};
const generatedMondayEntirelyPrevDay = renderReportHtml(buildReportData(weekDataMondayEntirelyPrevDay), { reportPolicy, btcGuide });

test('renderer: 月曜00:30発表（窓が丸ごと日曜に収まる）— 対象週内にバーは一切描画されず、週明け特例文言のみ', () => {
  const mondayBlock = haltDayBlock(generatedMondayEntirelyPrevDay, '2026-08-17');
  const { bars: mondayBars } = barsAndTriangles(mondayBlock);
  assert.deepEqual(mondayBars, [], '月曜自身にも窓丸ごと収まりの帯は描画されない');
  assert.ok(mondayBlock.includes('停止開始目安 前日 日曜'), 'レンジ文言が前日(日曜)を明示していない');
  assert.ok(mondayBlock.includes('12:30–20:30'), '前日の実際の停止範囲(12:30-20:30)が表示されていない');
  assert.ok(mondayBlock.includes('週明けの取引開始時点からの停止が目安'));
  // 日曜は対象週外のため描画対象日が無く、他の4日間にも帯・注記は一切出ない
  for (const date of ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']) {
    const block = haltDayBlock(generatedMondayEntirelyPrevDay, date);
    const { bars } = barsAndTriangles(block);
    assert.deepEqual(bars, [], `${date}にはこのイベント由来の帯が出ないはず`);
  }
});
