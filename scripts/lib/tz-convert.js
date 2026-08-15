'use strict';
// タイムゾーン変換（公式ソースの現地時刻→JST）。SPEC §3.5・停止目安計算の前提となる基盤。
// DST（サマータイム）はNode組み込みのIANAタイムゾーンデータ（Intl）に問い合わせて解決する。
// 「N月第M日曜」等のDST切替規則を自前で保持しない（毎年変わりうる規則を手動更新する必要をなくすため。
// 米連邦法改正等でルール自体が変わった場合もIntlのデータ更新に追随できる）。

const { jstCalendarDate, formatYmd } = require('./dates');

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 指定UTC時刻における、指定タイムゾーンのUTCオフセット（分）を返す。
// 「そのタイムゾーンでの壁時計時刻 = UTC時刻 + オフセット」となる符号。
function offsetMinutesAt(utcInstant, ianaZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(utcInstant).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asIfUtc - utcInstant.getTime()) / 60000);
}

// 指定タイムゾーンでの壁時計時刻（年月日時分）に対応するUTC時刻を求める。
// DST切替の瞬間そのもの（春の欠落時刻・秋の重複時刻）は経済指標の発表時刻としては
// 実務上まず現れないため、収束計算（最大3回）で十分な精度とする。
function zonedWallTimeToUtc(y, mo, d, h, mi, ianaZone) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const offset = offsetMinutesAt(new Date(guess), ianaZone);
    const next = Date.UTC(y, mo - 1, d, h, mi) - offset * 60000;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

// UTC Date → JSTの{date:'YYYY-MM-DD', time:'HH:MM'}
function utcToJstParts(utcDate) {
  const jstMs = utcDate.getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(jstMs);
  return {
    date: formatYmd(jstCalendarDate(utcDate)),
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

// UTC Date → 指定IANAタイムゾーンの{date:'YYYY-MM-DD', time:'HH:MM'}（utcToJstPartsの汎用版）。
// utcInstantしか持たないソース（ABS・ONS等）の台帳time_local/tz（現地表記の監査用記録）を、
// 設定済みの発表元タイムゾーン（announce_time_by_kind.*.tz）から復元するために使う
function utcToZonedParts(utcInstant, ianaZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(utcInstant).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// 公式ソースの現地壁時計時刻（年月日時分＋IANAタイムゾーン名）をJSTの日付・時刻へ変換する。
// 例: zonedWallTimeToJst(2026, 3, 10, 8, 30, 'America/New_York') // DST中のET 08:30 → JST
function zonedWallTimeToJst(y, mo, d, h, mi, ianaZone) {
  const utc = zonedWallTimeToUtc(y, mo, d, h, mi, ianaZone);
  return { ...utcToJstParts(utc), utcInstant: utc };
}

// 現在時刻を「+09:00」オフセット付きISO日時（秒精度、ミリ秒なし）の文字列で返す。
// scripts/lib/validate-ledger.jsのISO_DATETIME_OFFSET_RE（ミリ秒非対応）に適合させるため、
// `new Date().toISOString()`（UTC・Z・ミリ秒付き）をmeta.generated_at等にそのまま使わないこと
// （task #38実ネットワーク検証2026-08-15で発見・修正した実バグ）。
function nowJstIso(now = new Date()) {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(jstMs);
  const y = d.getUTCFullYear();
  const mo = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const h = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const s = pad2(d.getUTCSeconds());
  return `${y}-${mo}-${day}T${h}:${mi}:${s}+09:00`;
}

module.exports = {
  offsetMinutesAt,
  zonedWallTimeToUtc,
  utcToJstParts,
  utcToZonedParts,
  zonedWallTimeToJst,
  nowJstIso,
};
