'use strict';
// scripts/lib/validate-event-volume-trend.js（task #93、2026-09-06、しょうさん指示:
// 「掲載件数の推移監視」）の単体テスト。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEventVolumeTrend } = require('../scripts/lib/validate-event-volume-trend.js');

const ENABLED_POLICY = { enabled: true, min_history_weeks: 4, displayed_ratio_threshold: 0.5, star3_ratio_threshold: 0.5 };

function history(pairs) {
  return pairs.map(([displayed, star3], i) => ({ target_week_start: `2026-0${i + 1}-01`, displayed_count: displayed, star3_count: star3 }));
}

test('checkEventVolumeTrend: enabled=falseなら常にbelowThreshold:false（スキップ）', () => {
  const r = checkEventVolumeTrend(10, 5, history([[10, 5], [10, 5], [10, 5], [10, 5]]), { enabled: false });
  assert.equal(r.belowThreshold, false);
  assert.equal(r.skipped, true);
});

test('checkEventVolumeTrend: 実績がmin_history_weeks未満ならスキップ（誤検知回避）', () => {
  const r = checkEventVolumeTrend(2, 0, history([[10, 5], [10, 5]]), ENABLED_POLICY);
  assert.equal(r.belowThreshold, false);
  assert.equal(r.skipped, true);
  assert.match(r.skippedReason, /2週分/);
});

// task #93の核心: 絶対下限は上回るが、過去実績と比べて明らかに少ない週を検出する
test('checkEventVolumeTrend: 掲載件数が過去中央値の50%未満なら検出する（絶対下限は上回っていても）', () => {
  const hist = history([[10, 4], [11, 5], [9, 4], [10, 5]]); // displayed中央値=10, star3中央値=4.5
  const r = checkEventVolumeTrend(4, 4, hist, ENABLED_POLICY); // 4件は絶対下限4件はクリアするが中央値10の50%=5未満
  assert.equal(r.belowThreshold, true);
  assert.ok(r.reasons.some((x) => x.includes('掲載対象イベント数')));
});

test('checkEventVolumeTrend: ★★★件数が過去中央値の50%未満なら検出する', () => {
  const hist = history([[10, 8], [10, 8], [10, 8], [10, 8]]); // star3中央値=8
  const r = checkEventVolumeTrend(10, 3, hist, ENABLED_POLICY); // 3件は8の50%=4未満
  assert.equal(r.belowThreshold, true);
  assert.ok(r.reasons.some((x) => x.includes('★★★')));
});

test('checkEventVolumeTrend: 過去実績の範囲内なら検出しない', () => {
  const hist = history([[10, 5], [11, 6], [9, 4], [10, 5]]);
  const r = checkEventVolumeTrend(9, 5, hist, ENABLED_POLICY);
  assert.equal(r.belowThreshold, false);
  assert.equal(r.skipped, false);
});

test('checkEventVolumeTrend: policy省略時のデフォルト閾値（min_history_weeks=8, ratio=0.5）が適用される', () => {
  const r = checkEventVolumeTrend(1, 1, history([[10, 5], [10, 5], [10, 5], [10, 5]]), { enabled: true });
  assert.equal(r.belowThreshold, false);
  assert.equal(r.skipped, true);
  assert.match(r.skippedReason, /8週分必要/);
});
