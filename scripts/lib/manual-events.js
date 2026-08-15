'use strict';
// config/manual-events.json（運用者による単発イベントの手動登録）の検証・候補変換（2026-08-15新設）。
// 公式ソースチェッカーに担当ソースが無いため定例欠落WARNが恒常的に出続けるイベント
// （例: RBA総裁の下院経済委員会証言 #18）や、臨時会合・突発イベント等、自動収集ではカバーできない
// ★★★候補を、公式ソース由来の候補と同じ形（date/time/kind/country/importance/displayName）へ
// 変換し、観測パイプライン（scripts/phase1/observation-run.mjs）へ通常イベントと同列で取り込む。
const { zonedWallTimeToJst } = require('./tz-convert');

function validateManualEvents(config) {
  const errors = [];
  if (!config || !Array.isArray(config.entries)) {
    return ['entries配列が存在しません'];
  }
  const seenIds = new Set();
  for (const e of config.entries) {
    const tag = `[${e.id || '(id無し)'}]`;
    if (!e.id) errors.push(`${tag} idが必須です`);
    if (e.id && seenIds.has(e.id)) errors.push(`${tag} id重複`);
    if (e.id) seenIds.add(e.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) errors.push(`${tag} dateはYYYY-MM-DD形式が必須です`);
    if (!e.country) errors.push(`${tag} countryが必須です`);
    if (!e.display_name) errors.push(`${tag} display_nameが必須です`);
    if (typeof e.importance !== 'number' || ![0, 2, 3].includes(e.importance)) {
      errors.push(`${tag} importanceは0/2/3のいずれかの数値が必須です`);
    }
    if (!e.source_note) errors.push(`${tag} source_note（出典メモ）が必須です`);
    if (!e.registered_by) errors.push(`${tag} registered_byが必須です`);
    if (!e.registered_at) errors.push(`${tag} registered_atが必須です`);
    const hasLocalTime = e.local_time != null;
    const hasTz = e.tz != null;
    if (hasLocalTime !== hasTz) {
      errors.push(`${tag} local_time/tzは両方指定するか両方省略する必要があります（省略時は時刻未定扱い）`);
    }
    if (hasLocalTime && !/^\d{2}:\d{2}$/.test(e.local_time)) errors.push(`${tag} local_timeはHH:MM形式が必須です`);
  }
  return errors;
}

// 単発イベント1件 → 候補イベント形式へ変換する。表示名・重要度は運用者が登録時に直接確定させるため、
// event-names.json辞書照合は行わない（SPEC §4.2の規則生成命名kindと同様の扱い）
function manualEntryToCandidate(entry) {
  const base = {
    date: entry.date,
    kind: entry.kind || 'manual',
    country: entry.country,
    importance: entry.importance,
    displayName: entry.display_name,
    sourceId: 'manual_events',
    note: entry.source_note,
  };
  if (entry.local_time && entry.tz) {
    const [y, mo, d] = entry.date.split('-').map(Number);
    const [h, mi] = entry.local_time.split(':').map(Number);
    const jst = zonedWallTimeToJst(y, mo, d, h, mi, entry.tz);
    return { ...base, date: jst.date, time: jst.time };
  }
  return { ...base, time: null };
}

// 対象週（targetWeekStart〜targetWeekEnd、'YYYY-MM-DD'）に該当するentriesのみ候補化する
function candidatesForTargetWeek(config, targetWeekStart, targetWeekEnd) {
  return (config?.entries || [])
    .filter((e) => e.date >= targetWeekStart && e.date <= targetWeekEnd)
    .map(manualEntryToCandidate);
}

module.exports = { validateManualEvents, manualEntryToCandidate, candidatesForTargetWeek };
