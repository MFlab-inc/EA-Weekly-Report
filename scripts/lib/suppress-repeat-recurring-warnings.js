'use strict';
// 定例欠落WARNの重複排除（SPEC §3.4末尾のcheckRecurringMissingの後処理。2026-10-03、
// しょうさん指摘item4）。「毎月1〜10日ごろ」のような日範囲ルールは、範囲が1対象週に収まらない
// 場合（例: 月初が週の後半に来る月）、実際には月1回しか起きない事象なのに複数の対象週で
// 独立に判定されてしまう。前週で当該ルールが実際に検出済み（found:true）であれば、今週の
// 「検出なし」は新たな欠落ではなく前週時点の発生の名残である可能性が高いため、WARNを抑制する。
//
// しょうさん指示（2026-10-03、提案時点から変更）: 抑制条件は「前週found:true」の場合のみに限定し、
// 「前週WARN済み（found:false）」では抑制しない。理由: 前週が発表前で正しくWARNが出ており、
// 今週が本当の発表週なのに検出に失敗した場合、「前週WARN済み」を条件にすると本物の欠落を
// 黙殺してしまう。pending_recon状態の担当ソース（ADP・中国PMI等）はこの条件では恒常的に
// found:falseのままなので、従来どおり毎週WARNが出続ける（意図した挙動）。
//
// 「毎週」ルール（米新規失業保険申請件数等）は対象外。週ごとに独立した正当な発生のため、
// 前週の状態で今週の判定を左右してはならない。
//
// 前週のledgerが見つからない・該当ルールの記録が無い場合は抑制しない（見落とし防止優先、安全側）。

function periodKeyForTargetWeek(targetWeekEnd) {
  return (targetWeekEnd || '').slice(0, 7); // 'YYYY-MM'
}

// recurringMissingWarnings: harness.mjsのcheckRecurringMissingが返す文字列配列
//   （各要素は `定例欠落: 「${rule.name}」（${rule.rule}）が...` の形式）
// recurringChecks: config/importance-rules.json の recurring_checks 配列
// targetWeekEnd: 今週の対象週最終日=金曜（'YYYY-MM-DD'）。月をまたぐ週（例:
//   2026-09-28[月]〜10-02[金]）は「1〜10日ごろ」のような日範囲ルールの実際のマッチ箇所が
//   週の後半（＝targetWeekEndの月）に寄るため、周期キーには対象週の開始日ではなく終了日の月を
//   使う（開始日を使うと、この実例[9/28週→10/5週]で誤って別周期と判定してしまい、
//   抑制すべき重複WARNが素通りする）
// previousLedger: 前週（対象週の7日前の月曜）のledger JSON（無ければnull/undefined）
function suppressRepeatRecurringWarnings(recurringMissingWarnings, recurringChecks, targetWeekEnd, previousLedger) {
  const warnings = recurringMissingWarnings || [];
  const previousStatuses = previousLedger?.coverage?.recurring_checks;
  if (!Array.isArray(previousStatuses) || previousStatuses.length === 0) return warnings;

  const previousWeekEnd = previousLedger?.meta?.target_week_end;
  if (!previousWeekEnd) return warnings;
  // 同一周期（暦月）内でなければ比較対象外（前週が先月分・今週が今月分の場合、別の発生として扱う）
  if (periodKeyForTargetWeek(previousWeekEnd) !== periodKeyForTargetWeek(targetWeekEnd)) return warnings;

  const previousStatusByName = new Map(previousStatuses.map((s) => [s.name, s]));

  return warnings.filter((warning) => {
    const rule = (recurringChecks || []).find((r) => warning.includes(`「${r.name}」`));
    if (!rule) return true; // ルールを特定できない場合は安全側（抑制しない）
    if ((rule.rule || '').includes('毎週')) return true; // 毎週ルールは対象外

    const prevStatus = previousStatusByName.get(rule.name);
    if (prevStatus && prevStatus.found === true) return false; // 前週found:true → 抑制
    return true;
  });
}

module.exports = { suppressRepeatRecurringWarnings, periodKeyForTargetWeek };
