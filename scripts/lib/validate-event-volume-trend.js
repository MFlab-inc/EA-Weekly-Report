'use strict';
// 過去実績（data/ledger/配下の既存台帳群、scripts/lib/event-volume-history.js）と比較した
// 「掲載件数の推移」異常検知（task #93、2026-09-06、しょうさん指示: Manus突合廃止に伴う欠落
// 検知強化の3点目「掲載件数の推移監視」）。
//
// scripts/lib/validate-event-volume.jsの下限チェック（min_displayed_events等）は固定の絶対値
// 基準のため、「通常10件前後の週が急に5件になった」というような相対的な劣化を捉えられない
// （5件は絶対下限4件を上回るためPUBLISH_READYのまま通ってしまう）。
// config/volume-check-policy.jsonのhistorical_median_check（2026-08-15の設計メモで
// 「8週分の実績が溜まったら中央値の50%未満を条件に追加することを検討」としていたもの）を実装した。
//
// 実績データが少ないうち（min_history_weeks未満）は誤検知を避けるため常にbelowThreshold:falseを
// 返す（サイレントに実績を積み上げるだけ。しきい値に達した時点で自動的に効き始める）。
const { median } = require('./event-volume-history');

// displayedCount/star3Count: 対象週の実際の件数。historicalCounts: loadHistoricalCounts()の戻り値
// （対象週自身は含まない前提）。policy: config/volume-check-policy.json.historical_median_check
function checkEventVolumeTrend(displayedCount, star3Count, historicalCounts, policy) {
  const cfg = policy || {};
  if (!cfg.enabled) {
    return { belowThreshold: false, reasons: [], sampleSize: historicalCounts.length, skipped: true, skippedReason: 'historical_median_check.enabled=false' };
  }
  const minHistoryWeeks = cfg.min_history_weeks ?? 8;
  if (historicalCounts.length < minHistoryWeeks) {
    return {
      belowThreshold: false,
      reasons: [],
      sampleSize: historicalCounts.length,
      skipped: true,
      skippedReason: `実績が${historicalCounts.length}週分のみ（${minHistoryWeeks}週分必要）のため今回はスキップします`,
    };
  }

  const displayedMedian = median(historicalCounts.map((c) => c.displayed_count));
  const star3Median = median(historicalCounts.map((c) => c.star3_count));
  const displayedRatio = cfg.displayed_ratio_threshold ?? 0.5;
  const star3Ratio = cfg.star3_ratio_threshold ?? 0.5;
  const reasons = [];
  if (displayedMedian > 0 && displayedCount < displayedMedian * displayedRatio) {
    reasons.push(
      `掲載対象イベント数(${displayedCount}件)が過去${historicalCounts.length}週の中央値(${displayedMedian}件)の${Math.round(displayedRatio * 100)}%未満です`
    );
  }
  if (star3Median > 0 && star3Count < star3Median * star3Ratio) {
    reasons.push(
      `最重要（★★★）イベント数(${star3Count}件)が過去${historicalCounts.length}週の中央値(${star3Median}件)の${Math.round(star3Ratio * 100)}%未満です`
    );
  }
  return { belowThreshold: reasons.length > 0, reasons, sampleSize: historicalCounts.length, displayedMedian, star3Median, skipped: false };
}

module.exports = { checkEventVolumeTrend };
