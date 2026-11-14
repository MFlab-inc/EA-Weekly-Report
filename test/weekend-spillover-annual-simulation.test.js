'use strict';
// 週末スピルオーバーの年間シミュレーションテスト（しょうさん指示2026-11-16、item 5）。
// 11/16週のミシガン大学消費者信頼感指数インシデント（冬時間下でFRED経路だけ週末
// スピルオーバー判定を経由しておらず、金曜発表がJST変換で翌日[土]になった際に台帳にも
// HTMLにも描画されない「中途半端な日付」を生んだ件、PR #62で修正済み）と同種の問題を、
// 実際にその日付パターンへ到達する前に検知するための回帰防止テスト。
//
// config/official-sources.jsonのannounce_time_by_kindに実際に登場する全ての(tz, local_time)
// 組み合わせ（合成データではない）について、向こう1年強（53週間強。米国・EU双方のDST切替
// [3月・11月]とAU/NZの南半球DST切替[4月・10月]の両方を必ず跨ぐ）の全金曜日をシミュレーション
// し、JST変換後の日付が「金曜当日」または「翌日（土、週末スピルオーバー）」のいずれかに
// 必ず収まり、かつスピルオーバーに該当する場合はapplyWeekendSpillover()が取りこぼさず
// isWeekendSpillover:trueを付けることを確認する。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parseYmd, addDays, formatYmd } = require('../scripts/lib/dates.js');
const { zonedWallTimeToJst, applyWeekendSpillover } = require('../scripts/lib/tz-convert.js');

const officialSources = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));

// 実configのannounce_time_by_kindから(tz, local_time)の組み合わせを重複排除して集める
// （どのsource:kindがその組み合わせを使っているかも記録し、違反時に特定しやすくする）
function collectRealTzLocalTimePairs() {
  const pairs = new Map();
  for (const s of officialSources.sources) {
    for (const [kind, at] of Object.entries(s.announce_time_by_kind || {})) {
      if (!at.local_time || !at.tz) continue;
      const key = `${at.tz}|${at.local_time}`;
      if (!pairs.has(key)) pairs.set(key, { tz: at.tz, localTime: at.local_time, refs: [] });
      pairs.get(key).refs.push(`${s.id}:${kind}`);
    }
  }
  return [...pairs.values()];
}

// 基準日（2026-01-02、金曜）から7日おきにtotalDays分の金曜日を列挙する
function fridaysInRange(startFriday, totalDays) {
  const fridays = [];
  for (let i = 0; i <= totalDays; i += 7) fridays.push(formatYmd(addDays(parseYmd(startFriday), i)));
  return fridays;
}

const REAL_PAIRS = collectRealTzLocalTimePairs();
const FRIDAYS = fridaysInRange('2026-01-02', 371);

test(`週末スピルオーバー年間シミュレーション: 実configの全(tz,local_time)組み合わせ（${REAL_PAIRS.length}件）×向こう1年強の全金曜日（${FRIDAYS.length}件）で、JST変換後の日付が金曜当日または翌日（土）のいずれかに必ず収まる`, () => {
  const violations = [];
  for (const { tz, localTime, refs } of REAL_PAIRS) {
    const [h, mi] = localTime.split(':').map(Number);
    for (const friday of FRIDAYS) {
      const [y, mo, d] = friday.split('-').map(Number);
      const jst = zonedWallTimeToJst(y, mo, d, h, mi, tz);
      const nextDay = formatYmd(addDays(parseYmd(friday), 1));
      if (jst.date !== friday && jst.date !== nextDay) {
        violations.push(`${refs.join(',')} tz=${tz} local_time=${localTime} friday=${friday} -> jst.date=${jst.date}（金曜当日[${friday}]でも翌日[${nextDay}]でもない）`);
      }
    }
  }
  assert.deepEqual(violations, [], `想定外の日付ロールオーバーを検出:\n${violations.join('\n')}`);
});

test('週末スピルオーバー年間シミュレーション: 金曜発表がJST変換で翌日（土）になる組み合わせは、applyWeekendSpillover()が必ず取りこぼさずisWeekendSpillover:trueを付ける', () => {
  const missed = [];
  let spilloverCaseCount = 0;
  for (const { tz, localTime, refs } of REAL_PAIRS) {
    const [h, mi] = localTime.split(':').map(Number);
    for (const friday of FRIDAYS) {
      const [y, mo, d] = friday.split('-').map(Number);
      const jst = zonedWallTimeToJst(y, mo, d, h, mi, tz);
      if (jst.date === friday) continue; // ロールオーバーなし。スピルオーバー判定自体は対象外
      spilloverCaseCount += 1;
      const targetWeekStart = formatYmd(addDays(parseYmd(friday), -4));
      const result = applyWeekendSpillover([{ date: jst.date, time: jst.time }], targetWeekStart, friday);
      if (result.length !== 1 || !result[0].isWeekendSpillover) {
        missed.push(`${refs.join(',')} tz=${tz} local_time=${localTime} friday=${friday} -> jst=${jst.date}T${jst.time}（週末スピルオーバーとして取り込まれなかった）`);
      }
    }
  }
  assert.ok(spilloverCaseCount > 0, 'ロールオーバーするケースが1件も無い場合、このテスト自体が何も検証していないことになるため、実configに想定ケースが存在するかを見直すこと');
  assert.deepEqual(missed, [], `週末スピルオーバーとして取り込まれなかった組み合わせを検出:\n${missed.join('\n')}`);
});
