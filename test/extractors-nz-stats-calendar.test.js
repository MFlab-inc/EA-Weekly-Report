'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractNzStatsCalendar } = require('../scripts/checkers/extractors/nz-stats-calendar');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');

// fixtureは2026-08-22のnz-stats-api-recon一時ワークフロー実行（calendar-export?month=8&year=2026の
// 実レスポンス）から4件を抜粋したもの。ground truth: Retail trade survey（2026-08-24 10:45）
test('extractNzStatsCalendar: 実fixtureからground truth（Retail trade survey, 8/24 10:45 Pacific/Auckland）を抽出できる', () => {
  const r = extractNzStatsCalendar(fx('nz_stats_calendar', 'calendar_export_202608.ics'));
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 4, 'ICS内の全VEVENT（無関係なリリースも含む）を汎用抽出しているはず');
  const retail = r.rows.find((row) => row.title.includes('Retail trade survey'));
  assert.ok(retail, 'Retail trade surveyの行が見つからない');
  assert.equal(retail.date, '2026-08-24');
  assert.equal(retail.localTime, '10:45');
  assert.equal(retail.title, 'Retail trade survey: June 2026 quarter');
});

test('extractNzStatsCalendar: VEVENT要素が無い入力は構造的失敗を返す', () => {
  const r = extractNzStatsCalendar('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
  assert.equal(r.ok, false);
});

test('extractNzStatsCalendar: RFC5545の行折り返し（継続行が空白で始まる）を結合してから解析する', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Pacific/Auckland:20260824T104500',
    'SUMMARY:Retail trade survey: June 2026',
    '  quarter (folded)',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const r = extractNzStatsCalendar(ics);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].title, 'Retail trade survey: June 2026 quarter (folded)');
});
