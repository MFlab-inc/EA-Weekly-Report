'use strict';
// 根拠台帳（data/ledger/YYYY-MM-DD.json）をレンダラー入力（week-data-*.js相当のweekInput形）へ
// 変換するアダプタ（task #13後継の実データ接続、しょうさん指示2026-08-15）。
//
// 既知の非対応事項（docs/ledger-schema.md「既知の簡略化」参照）:
// - heroSummary/heroPills（ヒーロー要約文）はnarrative引数（呼び出し側が用意）を使う
// - comment（定型コメント）はconfig/event-comments.jsonのkind別辞書（しょうさん承認済み・
//   生成AIによる自動作文ではない）による自動付与。既刊の一部イベントは辞書の汎用文言より
//   具体的な手動コメントを使っていたため、既刊テキストとの完全一致は保証しない
// - windowGroupsの各labelItemsテキストは台帳のname_ja（フル正式名）をそのまま使う。
//   既刊の停止バー注記は視覚的なコンパクトさのため手動で短縮表記（例:「RBA政策金利＆声明・
//   四半期金融政策報告」「総裁記者会見」）を使っていたが、本アダプタはそのような省略辞書を
//   持たないため、フル名称同士を「・」で連結する（内容は同じだが表記がやや長い）
//
// 発表枠の束ね（bundle_id、SPEC §5「同時刻・同発表主体の関連イベントを1枠に」・task #34）は
// scripts/lib/build-ledger.jsのcomputeBundleIds()が算出したbundle_idに基づき、
// windowGroupsForDay()でグルーピングする（しょうさん確定ルール2026-08-15実装済み）
const { parseYmd, addDays, formatYmd, formatMd, weekdayJa } = require('../lib/dates');

// ISO国コード→国名ピル表示（日本語）。config/country-currency-map.jsonのJA表記慣行と一致させる
// （NZ表記のみ「ニュージーランド」ではなく「NZ」のまま。既刊実例・country-currency-map.json準拠）。
// 2026-08-15追記（task #54、しょうさん指摘: DE国追加時にこのdictへの追加漏れで国名ピル・
// ヒーロー文言が「DE」のまま漏れ、通貨ピルの取りこぼしと合わさって「DEDE」と二重表示された）:
// フォールバック（29行目）はISOコード未登録時に生のコードをそのまま返すため、登録漏れが
// 読者可視テキストへ直接漏れる設計になっている。scripts/lib/build-ledger.jsのCURRENCY_BY_COUNTRY
// と合わせて2つ存在する並行dictで、新規国を追加するたびに両方へ手動追加する必要がある。
// 追加漏れはscripts/lib/validate-country-currency-coverage.js（実configゲート）と
// scripts/check/policy-lint.mjsのlintLeakedCountryCodes（レンダリング後の可視テキスト検査）の
// 2段構えで検出される
const COUNTRY_JA_BY_ISO = {
  JP: '日本', US: '米国', GB: '英国', AU: '豪州', EU: 'ユーロ圏',
  NZ: 'NZ', CA: 'カナダ', CH: 'スイス', CN: '中国', DE: 'ドイツ',
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

// 同一時刻の複数イベントは「・」区切りで1つのlabelItemテキストにまとめる（既刊実例の構造踏襲。
// ただし既刊は視覚的コンパクトさのため短縮表記を使っており、本アダプタはフル名称を使う点が異なる
// ＝ファイル先頭コメント参照）
function labelTextFor(eventsAtSameTime) {
  return eventsAtSameTime.map((e) => e.name_ja).join('・');
}

// 台帳イベント→windowGroups（SPEC §5の対象はimportance=3のみ）。bundle_idが同じイベント群は
// 1つのwindowGroupにまとめる（発表枠の束ね、task #34）。「枠内最初の発表時刻を基準」
// （firstTime）「再開確認は枠内最後のイベント終了後から」（lastTime・bundleLastEventLabel）は
// html-renderer.js側の既存ロジック（haltDayCard・annotationHtmlOf）がそのまま解釈する
function windowGroupsForDay(dayEvents) {
  const timed3 = dayEvents.filter((ev) => ev.importance === 3 && ev.datetime_jst);
  const byBundle = new Map();
  for (const ev of timed3) {
    const key = ev.bundle_id || `solo:${ev.event_id}`;
    if (!byBundle.has(key)) byBundle.set(key, []);
    byBundle.get(key).push(ev);
  }
  const groups = [];
  for (const bundleEvents of byBundle.values()) {
    const sorted = [...bundleEvents].sort((a, b) => timeFromDatetimeJst(a.datetime_jst).localeCompare(timeFromDatetimeJst(b.datetime_jst)));
    const firstTime = timeFromDatetimeJst(sorted[0].datetime_jst);
    const lastTime = timeFromDatetimeJst(sorted[sorted.length - 1].datetime_jst);
    const byTime = new Map();
    for (const ev of sorted) {
      const t = timeFromDatetimeJst(ev.datetime_jst);
      if (!byTime.has(t)) byTime.set(t, []);
      byTime.get(t).push(ev);
    }
    const labelItems = [...byTime.entries()].map(([time, evs]) => ({ time, text: labelTextFor(evs) }));
    const group = {
      firstTime,
      lastTime,
      countryJa: countryJaOf(sorted[0].country),
      currency: sorted[0].currency,
      labelItems,
    };
    // 枠内で発表時刻が複数（束ねにより異なる時刻のイベントが混在）の場合のみ、
    // 「再開確認は枠内最後のイベント終了後から」の注記対象になる（既刊実例と同じ条件分岐）
    if (lastTime !== firstTime) {
      group.bundleLastEventLabel = labelTextFor(byTime.get(lastTime));
    }
    groups.push(group);
  }
  return groups.sort((a, b) => a.firstTime.localeCompare(b.firstTime));
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
  windowGroupsForDay,
  commentFor,
  timeFromDatetimeJst,
  countryJaOf,
  COUNTRY_JA_BY_ISO,
};
