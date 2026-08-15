'use strict';
// 根拠台帳（data/ledger/YYYY-MM-DD.json）をレンダラー入力（week-data-*.js相当のweekInput形）へ
// 変換するアダプタ（task #13後継の実データ接続、しょうさん指示2026-08-15）。
//
// 既知の非対応事項（docs/ledger-schema.md「既知の簡略化」参照）:
// - heroSummary/heroPills（ヒーロー要約文）は事実列挙とはいえ「その週の特に注目すべき2〜4件を選ぶ」
//   という編集判断を伴うため機械生成しない。呼び出し側がnarrative引数として別途指定する
// - 発表枠の束ね（bundle_id、SPEC §5「同時刻・同発表主体の関連イベントを1枠に」）は未実装
//   （しょうさん指示2026-08-15・次タスクとして別途登録）。1イベント=1windowGroupとして扱う
//   （scripts/phase1/observation-run.mjsの簡易版と同じ設計）
// - comment（定型コメント）はconfig/event-comments.jsonのkind別辞書（しょうさん承認済み・
//   生成AIによる自動作文ではない）による自動付与。既刊の一部イベントは辞書の汎用文言より
//   具体的な手動コメントを使っていたため、既刊テキストとの完全一致は保証しない
const { parseYmd, addDays, formatYmd, formatMd, weekdayJa } = require('../lib/dates');

// ISO国コード→国名ピル表示（日本語）。config/country-currency-map.jsonのJA表記慣行と一致させる
// （NZ表記のみ「ニュージーランド」ではなく「NZ」のまま。既刊実例・country-currency-map.json準拠）
const COUNTRY_JA_BY_ISO = {
  JP: '日本', US: '米国', GB: '英国', AU: '豪州', EU: 'ユーロ圏',
  NZ: 'NZ', CA: 'カナダ', CH: 'スイス', CN: '中国',
};

function countryJaOf(isoCountry) {
  return COUNTRY_JA_BY_ISO[isoCountry] || isoCountry;
}

// SPEC §6.4「★★★=...定型コメント」向けの自動コメント。importance=2はコメントなし
// （design-mock_v1.2.html §6.4「★★=1行圧縮」・既刊実例に倣う）
function commentFor(kind, importance, eventComments) {
  if (importance !== 3) return undefined;
  return eventComments?.comments?.[kind];
}

// ledger.eventsのdatetime_jst（'YYYY-MM-DDTHH:MM:SS+09:00'）から'HH:MM'を取り出す。
// time_status=unpublishedでdatetime_jstがnullの場合はnullを返す（レンダラー側の「時刻未公表」表示）
function timeFromDatetimeJst(datetimeJst) {
  return datetimeJst ? datetimeJst.slice(11, 16) : null;
}

function eventToWeekInputEvent(ev, eventComments) {
  return {
    id: ev.event_id,
    time: timeFromDatetimeJst(ev.datetime_jst),
    importance: ev.importance,
    countryJa: countryJaOf(ev.country),
    currency: ev.currency,
    displayName: ev.name_ja,
    comment: commentFor(ev.kind, ev.importance, eventComments),
  };
}

// 台帳イベント→windowGroups（1イベント=1window、束ねなし。SPEC §5の対象はimportance=3のみ）
function windowGroupsForDay(dayEvents) {
  return dayEvents
    .filter((ev) => ev.importance === 3 && ev.datetime_jst)
    .map((ev) => {
      const time = timeFromDatetimeJst(ev.datetime_jst);
      return {
        firstTime: time,
        lastTime: time,
        countryJa: countryJaOf(ev.country),
        currency: ev.currency,
        labelItems: [{ time, text: ev.name_ja }],
      };
    })
    .sort((a, b) => a.firstTime.localeCompare(b.firstTime));
}

// ledger.meta.target_week_start起点の対象週5日分（月〜金）をすべて生成する（SPEC §6.3「日別カード×5」。
// イベントが1件も無い日も空のカードとして含める）
function buildDays(ledger, eventComments) {
  const byDate = new Map();
  for (const ev of ledger.events) {
    if (!byDate.has(ev.date_jst)) byDate.set(ev.date_jst, []);
    byDate.get(ev.date_jst).push(ev);
  }
  const startDate = parseYmd(ledger.meta.target_week_start);
  const days = [];
  for (let i = 0; i < 5; i++) {
    const pseudoDate = addDays(startDate, i);
    const date = formatYmd(pseudoDate);
    const dayEvents = byDate.get(date) || [];
    days.push({
      date,
      md: formatMd(pseudoDate),
      weekday: weekdayJa(pseudoDate),
      events: dayEvents.map((ev) => eventToWeekInputEvent(ev, eventComments)),
      windowGroups: windowGroupsForDay(dayEvents),
    });
  }
  return days;
}

// ledger: data/ledger/YYYY-MM-DD.json相当のパース済みオブジェクト
// narrative: { reportMeta, createdDateJa, heroSummary, heroPills }（人手で用意する編集判断。
//   本アダプタは生成しない。ファイル先頭コメント参照）
// eventComments: config/event-comments.json相当のパース済みオブジェクト（省略可。省略時はコメント無し）
function ledgerToWeekInput(ledger, narrative, eventComments) {
  return {
    reportMeta: narrative.reportMeta,
    createdDateJa: narrative.createdDateJa,
    targetWeekStart: ledger.meta.target_week_start,
    targetWeekEnd: ledger.meta.target_week_end,
    heroSummary: narrative.heroSummary,
    heroPills: narrative.heroPills,
    days: buildDays(ledger, eventComments),
  };
}

module.exports = {
  ledgerToWeekInput,
  buildDays,
  commentFor,
  timeFromDatetimeJst,
  countryJaOf,
  COUNTRY_JA_BY_ISO,
};
