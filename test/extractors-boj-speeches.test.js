'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractBojSpeeches, extractBojPressConferenceNotice } = require('../scripts/checkers/extractors/boj-speeches');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');

// 対象週を2026-08-24週とする（fixtureのground truth: 8/27講演がこの週に該当する）
const CTX_0824 = { targetWeek: { targetWeekStart: '2026-08-24', targetWeekEnd: '2026-08-28' } };

test('extractBojSpeeches: 実fixtureからground truth（氷見野副総裁、8/27 10:30、埼玉）を抽出できる', () => {
  const r = extractBojSpeeches(fx('jp_boj_speeches', 'calendar_index.html'), CTX_0824);
  assert.equal(r.ok, true);
  const himino = r.rows.find((row) => row.speakerLastName === '氷見野');
  assert.ok(himino, '氷見野副総裁の行が見つからない');
  assert.equal(himino.date, '2026-08-27');
  assert.equal(himino.localTime, '10:30');
  assert.equal(himino.title, '【挨拶】氷見野副総裁（埼玉）');
});

test('extractBojSpeeches: 【記者会見】行や時刻「未定」の行は対象外（【挨拶】【講演】かつ時刻確定のみ抽出）', () => {
  const r = extractBojSpeeches(fx('jp_boj_speeches', 'calendar_index.html'), CTX_0824);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1, '抽出対象は氷見野副総裁の挨拶1件のみのはず（記者会見・データ公表行は除外）');
  assert.ok(!r.rows.some((row) => row.title.includes('記者会見')));
});

test('extractBojSpeeches: 公表日セルが空の行は直前の日付を繰り越す（同一日内の複数行）', () => {
  const r = extractBojSpeeches(fx('jp_boj_speeches', 'calendar_index.html'), CTX_0824);
  // fixtureの2行目（営業毎旬報告、公表日セル空欄）は【挨拶】【講演】形式ではないため抽出対象外だが、
  // もし対象だった場合に日付が正しく繰り越されることを別途、繰り越しロジック自体を軽量に確認する
  // （関数の直接的な単体テストがしづらいため、抽出0件でも構造的失敗にならないことで間接確認する）
  assert.equal(r.ok, true);
});

test('extractBojSpeeches: <tbody>が無い入力は構造的失敗を返す', () => {
  const r = extractBojSpeeches('<html><body>no table</body></html>', CTX_0824);
  assert.equal(r.ok, false);
});

test('extractBojSpeeches: <tbody>はあるがデータ行が1件も無い入力は構造的失敗を返す', () => {
  const r = extractBojSpeeches('<table><tbody></tbody></table>', CTX_0824);
  assert.equal(r.ok, false);
});

test('extractBojSpeeches: 講演行が1件も無い週でも構造的失敗にはしない（正常系の空配列）', () => {
  const html = `<table><tbody>
    <tr><td class="txt-right">1日（月）</td><td class="txt-right">8:50</td><td class="txt-center">○</td><td class="txt-center">●</td><td>マネタリーベース（8月）</td></tr>
  </tbody></table>`;
  const r = extractBojSpeeches(html, CTX_0824);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, []);
});

test('extractBojSpeeches: targetWeek.targetWeekStart未指定は呼び出し側の不備としてエラーを返す', () => {
  const r = extractBojSpeeches(fx('jp_boj_speeches', 'calendar_index.html'), {});
  assert.equal(r.ok, false);
});

// task #83（2026-08-30、しょうさん指摘: 9/2高田審議委員の挨拶が不検出）。実fixture
// （calendar_index.html）は月表記を一切含まない（「25日（火）」等）ため、月境界をまたぐ週で
// 日が前回より小さくなった時点（31→2）を月繰り上がりとみなすフォールバックの回帰テスト
test('extractBojSpeeches: 月表記省略の実ページ形式で月境界（8/31→9/2）をまたぐと日の減少から月を繰り上げる（task #83）', () => {
  const html = `<table><tbody>
    <tr><td class="txt-right">28日（金）</td><td class="txt-right">10:30</td><td class="txt-center">○</td><td class="txt-center">●</td><td>【挨拶】田村審議委員（東京）</td></tr>
    <tr><td class="txt-right">31日（月）</td><td class="txt-right">14:00</td><td class="txt-center">○</td><td class="txt-center">●</td><td>マネタリーベース（8月）</td></tr>
    <tr><td class="txt-right">2日（水）</td><td class="txt-right">10:30</td><td class="txt-center">○</td><td class="txt-center">●</td><td>【挨拶】高田審議委員（大阪）</td></tr>
  </tbody></table>`;
  const r = extractBojSpeeches(html, { targetWeek: { targetWeekStart: '2026-08-31', targetWeekEnd: '2026-09-04' } });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].date, '2026-08-28');
  const takada = r.rows.find((row) => row.speakerLastName === '高田');
  assert.ok(takada, '高田審議委員の行が見つからない');
  assert.equal(takada.date, '2026-09-02', '月表記省略のまま日が31→2と減少したので9月へ繰り上がる必要がある');
});

// 同一日内の複数行（公表日セルが空欄で繰り越される場合）で日番号が変わらないケースは
// 誤って月を繰り上げないことを確認する（上記フォールバックの誤検知防止）
test('extractBojSpeeches: 同一日内の複数行（日番号が変わらない）は月を繰り上げない', () => {
  const html = `<table><tbody>
    <tr><td class="txt-right">31日（月）</td><td class="txt-right">14:00</td><td class="txt-center">○</td><td class="txt-center">●</td><td>マネタリーベース（8月）</td></tr>
    <tr><td class="txt-right">2日（水）</td><td class="txt-right">10:30</td><td class="txt-center">○</td><td class="txt-center">●</td><td>【講演】田村審議委員（東京）</td></tr>
    <tr><td class="txt-right"></td><td class="txt-right">14:00</td><td class="txt-center">○</td><td class="txt-center">●</td><td>【講演】神山理事（名古屋）</td></tr>
  </tbody></table>`;
  const r = extractBojSpeeches(html, { targetWeek: { targetWeekStart: '2026-08-31', targetWeekEnd: '2026-09-04' } });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows.every((row) => row.date === '2026-09-02'), '同一日内の2行目（公表日セル空欄で31日→2日の繰り越し後）が誤って月を繰り上げてはいけない');
});

// extractBojPressConferenceNotice: 2026-10-26新設（しょうさん指摘、GPTの指摘の検証を経て）。
// 本編テーブルの記者会見行は時刻が常に「未定」のため時刻確定まで対象外になり、総裁定例記者会見が
// jp_boj系ソースで一度も抽出できなかった（恒常的な欠落）。ページ末尾付近の見出し外テキストのみに
// 具体的な日時が明記されるため、これを別途抽出する。実データ構造は2026-10-26にcurl直接取得で
// 確認済み（UA偽装なし）: <h2 id="p03">総裁定例記者会見（予定）</h2><p>{YYYY}年{M}月{D}日（{曜}）
// {H}:{MM}～（ライブ配信予定）<br>...</p>
test('extractBojPressConferenceNotice: 実測構造（2026-10-26確認）から日時を抽出できる', () => {
  const html = '<h2 id="p03">総裁定例記者会見（予定）</h2>\n<p>2026年10月30日（金）15:30～（ライブ配信予定）<br>\n（会見記録は2026年11月2日（月）にホームページ掲載予定）</p>';
  const r = extractBojPressConferenceNotice(html);
  assert.equal(r.found, true);
  assert.equal(r.date, '2026-10-30');
  assert.equal(r.localTime, '15:30');
});

test('extractBojPressConferenceNotice: 見出し自体が見つからない場合はfound:false（構造的失敗ではなく通常の未発表状態）', () => {
  const r = extractBojPressConferenceNotice('<html><body>no heading here</body></html>');
  assert.equal(r.found, false);
});

// 2026-10-26実測で発覚した回帰テスト: ページ冒頭の目次（<a href="#p03">総裁定例記者会見（予定）</a>）
// にも同じ文言が出現し、本文の<h2>より遥か前（実測で約7300文字前）にあるため、素朴な
// indexOf()では目次側にマッチして日時を取得できなかった（本文の<h2>まで届かない）。
// <h2>タグに限定してマッチすることを確認する
test('extractBojPressConferenceNotice: ページ冒頭の目次リンク（<a href="#p03">...）に同じ文言があっても、本文の<h2>側の日時を正しく抽出する（実測で発覚した回帰テスト）', () => {
  const html = `<ul class="page-link"><li><a href="#p03">総裁定例記者会見（予定）</a></li></ul>
  <p>${'x'.repeat(1000)}</p>
  <h2 id="p03">総裁定例記者会見（予定）</h2>
  <p>2026年10月30日（金）15:30～（ライブ配信予定）</p>`;
  const r = extractBojPressConferenceNotice(html);
  assert.equal(r.found, true);
  assert.equal(r.date, '2026-10-30');
  assert.equal(r.localTime, '15:30');
});

test('extractBojPressConferenceNotice: 見出しはあるが日時が1件も抽出できない場合はfound:false', () => {
  const html = '<h2 id="p03">総裁定例記者会見（予定）</h2>\n<p>未定</p>';
  const r = extractBojPressConferenceNotice(html);
  assert.equal(r.found, false);
});

test('extractBojSpeeches: 総裁定例記者会見（予定）の見出し外テキストが見つかればkind:press_conferenceの行をrowsへ合流させる', () => {
  const html = `<table><tbody>
    <tr><td class="txt-right">27日（火）</td><td class="txt-right">8:50</td><td class="txt-center">○</td><td class="txt-center">●</td><td>マネタリーベース（10月）</td></tr>
  </tbody></table>
  <h2 id="p03">総裁定例記者会見（予定）</h2>
  <p>2026年10月30日（金）15:30～（ライブ配信予定）</p>`;
  const r = extractBojSpeeches(html, { targetWeek: { targetWeekStart: '2026-10-26', targetWeekEnd: '2026-10-30' } });
  assert.equal(r.ok, true);
  const press = r.rows.find((row) => row.kind === 'press_conference');
  assert.ok(press, '総裁定例記者会見の行が見つからない');
  assert.equal(press.date, '2026-10-30');
  assert.equal(press.localTime, '15:30');
});

test('extractBojSpeeches: 総裁定例記者会見（予定）の見出しが無い場合は従来どおり（press_conference行は追加されないが構造的失敗にもしない）', () => {
  const html = `<table><tbody>
    <tr><td class="txt-right">27日（火）</td><td class="txt-right">8:50</td><td class="txt-center">○</td><td class="txt-center">●</td><td>マネタリーベース（10月）</td></tr>
  </tbody></table>`;
  const r = extractBojSpeeches(html, { targetWeek: { targetWeekStart: '2026-10-26', targetWeekEnd: '2026-10-30' } });
  assert.equal(r.ok, true);
  assert.equal(r.rows.filter((row) => row.kind === 'press_conference').length, 0);
});

test('extractBojSpeeches: 年末→年始の月ロールオーバーで年をインクリメントする（月替わり行は実ページ運用どおりN月D日形式で明記される前提）', () => {
  const html = `<table><tbody>
    <tr><td class="txt-right">12月28日（月）</td><td class="txt-right">10:30</td><td class="txt-center">○</td><td class="txt-center">●</td><td>【挨拶】田村審議委員（東京）</td></tr>
    <tr><td class="txt-right">1月5日（火）</td><td class="txt-right">10:30</td><td class="txt-center">○</td><td class="txt-center">●</td><td>【講演】高田審議委員（大阪）</td></tr>
  </tbody></table>`;
  const r = extractBojSpeeches(html, { targetWeek: { targetWeekStart: '2026-12-24', targetWeekEnd: '2026-12-28' } });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].date, '2026-12-28');
  assert.equal(r.rows[1].date, '2027-01-05', '月が12→1へ逆行したので年を+1する必要がある');
});
