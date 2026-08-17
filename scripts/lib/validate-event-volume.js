'use strict';
// 対象週のイベント件数が異常に少ない週を検知する下限チェック（純粋関数。しょうさん指示2026-08-15、
// task #38: 8/17週で★★★0件・掲載対象3件のままPUBLISH_READYが出た事例を受けて新設）。
// config/volume-check-policy.json参照。country×kindの必須マトリクス（validate-expected-coverage.js）は
// 「既知の指標種別に担当ソースがあるか」を守るが、想定外の欠落を防ぎきれない可能性があるための
// 二段構えの安全網。HOLDにはしない（閾値の誤検知リスクがあるため、人間の目視確認を促すに留める）。

// 戻り値: { belowThreshold: boolean, reasons: string[], displayedCount: number, star3Count: number }
function checkEventVolume(ledger, volumeCheckPolicy) {
  const events = (ledger.events || []).filter((e) => e.importance === 2 || e.importance === 3);
  const displayedCount = events.length;
  const star3Count = events.filter((e) => e.importance === 3).length;
  const reasons = [];

  if (displayedCount < volumeCheckPolicy.min_displayed_events) {
    reasons.push(`掲載対象イベント数(${displayedCount}件)が下限(${volumeCheckPolicy.min_displayed_events}件)を下回っています`);
  }
  if (volumeCheckPolicy.require_at_least_one_star3 && star3Count === 0) {
    reasons.push('最重要（★★★）イベントが0件です');
  }

  return { belowThreshold: reasons.length > 0, reasons, displayedCount, star3Count };
}

module.exports = { checkEventVolume };
