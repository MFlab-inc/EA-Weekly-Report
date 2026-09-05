'use strict';
// data/ledger/*.json（既にgit管理されている過去の台帳群）から、掲載件数・★★★件数の実績分布を
// 集計する（task #93、2026-09-06、しょうさん指示: Manus突合廃止に伴う欠落検知強化の3点目
// 「掲載件数の推移監視」）。新しい履歴ファイルは持たず、既存のdata/ledger/配下の台帳そのものを
// 実績データソースとして使う（別ファイルで二重管理すると同期ズレのリスクがあるため）。

const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ledgerDir: data/ledger/のディレクトリパス。excludeWeekStart: 対象週自身（これから判定する週）の
// 台帳ファイルを実績から除外するために指定する（'YYYY-MM-DD'、target_week_startと同じ命名規則）。
// 戻り値: [{ target_week_start, displayed_count, star3_count }, ...]（日付昇順は保証しない）
function loadHistoricalCounts(ledgerDir, excludeWeekStart) {
  let files;
  try {
    files = readdirSync(ledgerDir).filter((f) => f.endsWith('.json'));
  } catch (e) {
    return [];
  }
  const counts = [];
  for (const f of files) {
    const weekStart = f.replace(/\.json$/, '');
    if (weekStart === excludeWeekStart) continue;
    let ledger;
    try {
      ledger = JSON.parse(readFileSync(join(ledgerDir, f), 'utf8'));
    } catch (e) {
      continue;
    }
    const events = (ledger.events || []).filter((e) => e.importance === 2 || e.importance === 3);
    counts.push({
      target_week_start: weekStart,
      displayed_count: events.length,
      star3_count: events.filter((e) => e.importance === 3).length,
    });
  }
  return counts;
}

module.exports = { median, loadHistoricalCounts };
