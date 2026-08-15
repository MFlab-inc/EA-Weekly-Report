'use strict';
// フェールクローズ判定ロジック（SPEC §3.4・§3.5）。純粋関数のみ（I/Oなし）でテスト容易にする。
// harness.mjsは実行結果（成功/失敗リスト・年次config状況・recurring_checks突合結果）を
// ここへ渡して最終判定（OK/WARN/HOLD）を得る。

// 単一ソース失敗時の「対象週に発生する見込みがあるか」を判定する（SPEC §3.4）。
// 3つのシグナルのいずれかが true なら見込みありとする。
function isExpectedThisWeek({ annualConfigHasTargetWeek = false, recurringCheckMatches = false, ffHintPresent = false } = {}) {
  return Boolean(annualConfigHasTargetWeek || recurringCheckMatches || ffHintPresent);
}

// 全ソースの成否から最終判定を下す（SPEC §3.4）。
// failures: [{ sourceId, expected: boolean }, ...]（失敗したソースのみを渡す）
// 戻り値: { status: 'OK'|'WARN'|'HOLD', reasons: string[] }
function decideRunOutcome(failures) {
  if (!failures || failures.length === 0) {
    return { status: 'OK', reasons: [] };
  }
  if (failures.length >= 2) {
    return {
      status: 'HOLD',
      reasons: [`判定不能: ${failures.length}件のソースが同時に失敗（個別障害ではなく広域障害の疑いのためフェールクローズ）: ${failures.map((f) => f.sourceId).join(', ')}`],
    };
  }
  const [f] = failures;
  if (f.expected) {
    return { status: 'HOLD', reasons: [`見込みあり: ${f.sourceId} が失敗し、対象週の発生が示唆されているためHOLD`] };
  }
  return { status: 'WARN', reasons: [`見込みなし: ${f.sourceId} が失敗したが対象週の発生シグナルなし（WARNのみ）`] };
}

// 年次スケジュールconfig型ソースの残量監視（SPEC §3.5）。
// scheduleDates: ISO日付文字列の配列（そのソースのconfig済み確定日程）
// targetWeekStart: 対象週の月曜日（Dateまたは 'YYYY-MM-DD'）
// lookaheadWeeks: 既定4週（対象週+4週先までカバーがなければWARN）
function checkResidualMonitoring(scheduleDates, targetWeekStart, lookaheadWeeks = 4) {
  const start = toDate(targetWeekStart);
  const horizon = new Date(start.getTime() + lookaheadWeeks * 7 * 86400000);
  const covered = (scheduleDates || []).some((d) => {
    const dt = toDate(d);
    return dt >= start && dt <= horizon;
  });
  if (covered) return { ok: true };
  return {
    ok: false,
    warn: `年次スケジュールconfigに対象週(${fmt(start)})から${lookaheadWeeks}週先(${fmt(horizon)})までの日程が見つからない。次年度分の手動確定が必要な可能性（docs/annual-schedule-maintenance.md参照）`,
  };
}

// 定例欠落検知（SPEC §3.4末尾）。recurring_checksのルールが対象週に該当するのに、
// 該当kindのイベントが1件も検出されなかった場合はWARN（HOLDにはしない。祝日ずれの可能性があるため）。
// recurringChecks: config/importance-rules.json の recurring_checks 配列
// matchesTargetWeek: (rule, targetWeek) => boolean — ルールが対象週に該当するかの判定（呼び出し側が用意）
// foundKindsForRule: (rule) => boolean — 対象週の収集結果にそのルール該当イベントがあるか
function checkRecurringMissing(recurringChecks, targetWeek, matchesTargetWeek, foundKindsForRule) {
  const warnings = [];
  for (const rule of recurringChecks || []) {
    if (matchesTargetWeek(rule, targetWeek) && !foundKindsForRule(rule)) {
      warnings.push(`定例欠落: 「${rule.name}」（${rule.rule}）が対象週に該当する見込みだが検出されなかった。${rule.action}`);
    }
  }
  return warnings;
}

function toDate(d) {
  if (d instanceof Date) return d;
  return new Date(`${d}T00:00:00Z`);
}
function fmt(d) {
  return d.toISOString().slice(0, 10);
}

module.exports = { isExpectedThisWeek, decideRunOutcome, checkResidualMonitoring, checkRecurringMissing };
