'use strict';
// 抽出元の生行（{title, date/localTime または utcInstant}）から、最終的な表示用イベント
// （JST日時・日本語正規名・重要度）を組み立てる（SPEC §4.2・§4.3）。
// utcInstantが取れるソース（ABS・ONS等）はDST判定不要で直接JST変換できるため優先して使う。
// date+localTime（現地時間表記）しか取れないソース（Census等）はtz-convert.jsでDST対応変換する。
const { zonedWallTimeToJst, utcToJstParts } = require('./tz-convert');
const { findEventName } = require('./match-event-name');
const { resolveImportance } = require('./importance');
const { TIME_EXEMPT_KINDS } = require('./validate-official-sources');

// row: { title, date？, localTime？, utcInstant？, kind？ }
// ctx: { country, kind, tz, eventNames(config/event-names.json.entries), importanceRules, ruleGenerated？ }
// ctx.ruleGenerated=true（またはrow.kindが抽出側で既に確定している場合）は、SPEC §4.2の
// 規則生成命名kind（policy_rate・bond_auction・official_speech等）向けの分岐。
// これらはevent-names.json辞書に載らない設計のため、辞書照合（findEventName）を行わず
// displayNameは解決しない（naming.js統合はレンダラー側の責務。task #12以降のスコープ）。
// 辞書照合型kind（cpi・trade_balance等、従来どおり）は今までと同じ挙動を維持する
function resolveCandidateEvent(row, ctx) {
  let displayName = null;
  if (!ctx.ruleGenerated) {
    const nameEntry = findEventName(ctx.eventNames, ctx.country, ctx.kind, row.title);
    if (!nameEntry) {
      return { ok: false, reason: `event-names.json未登録（WARN・掲載除外対象）: country=${ctx.country} kind=${ctx.kind} title="${row.title}"` };
    }
    displayName = nameEntry.display_name;
  }
  let jst;
  if (row.utcInstant) {
    jst = utcToJstParts(new Date(row.utcInstant));
  } else if (row.date && row.localTime && ctx.tz) {
    const [y, mo, d] = row.date.split('-').map(Number);
    const [h, mi] = row.localTime.split(':').map(Number);
    jst = zonedWallTimeToJst(y, mo, d, h, mi, ctx.tz);
  } else if (row.date && TIME_EXEMPT_KINDS.has(ctx.kind)) {
    // bond_auction等、既刊ground truthで一貫して時刻未公表のkind（validate-official-sources.js
    // のTIME_EXEMPT_KINDSと同一基準）。TZ変換は行わずソース側の日付をそのまま採用する
    // （observation-run.mjsのannualEntryToCandidateと同じ「time:null」方針）
    jst = { date: row.date, time: null };
  } else {
    return { ok: false, reason: `時刻情報が不足（utcInstantまたはdate+localTime+tzが必要）: title="${row.title}"` };
  }
  return {
    ok: true,
    date: jst.date,
    time: jst.time,
    kind: ctx.kind,
    country: ctx.country,
    displayName,
    importance: resolveImportance(ctx.kind, ctx.country, ctx.importanceRules),
    rawTitle: row.title,
    // 台帳（data/ledger/）のsource_evidence・date_local/time_local/tz用に、変換前の現地情報も保持する
    localDate: row.date || null,
    localTime: row.localTime || null,
    tz: ctx.tz || null,
    utcInstant: row.utcInstant || null,
  };
}

// FRED等の「日付のみ」ソース向け: スクレイプしたタイトル文字列が無いため、キーワード照合ではなく
// country+kindに登録された全event-names.jsonエントリをそのまま候補として展開する（例: release_id=10の
// CPIリリースには「消費者物価指数（CPI）」「消費者物価指数【コア】」の2エントリが対応し、
// 両方とも同一日時の別カードとしてground truthに現れる。SPEC §4.1のbundling_ruleで束ねて表示する）。
// 注意: kindが同じでも別リリース（別発表元）由来のエントリが混在する場合がある
// （例: employment_indicator kindはJOLTS(BLS→FRED)とADP(ADP Research Institute、優先度B)の
// 2エントリを持つが、両者は別々の発表元・別々の発表日を持つ全く別のイベントであり、同一リリースの
// 束ねではない）。この混同をtask #9のground truth捕捉テストで検出したため、ctx.matchHintで
// どのエントリを対象とするか明示的に絞り込めるようにした（config/official-sources.jsonの
// fred.releases[].match_hintから渡す。省略時は従来どおり全エントリを返す＝真に束ねるべきkindのみで使う）
function resolveKindCandidates(dateStr, ctx) {
  let entries = (ctx.eventNames || []).filter((e) => e.country === ctx.country && e.kind === ctx.kind);
  if (ctx.matchHint) {
    const hint = ctx.matchHint.toLowerCase();
    entries = entries.filter((e) => (e.match || []).some((k) => k.toLowerCase().includes(hint)));
  }
  if (entries.length === 0) {
    return [{ ok: false, reason: `event-names.json未登録（WARN・掲載除外対象）: country=${ctx.country} kind=${ctx.kind} matchHint=${ctx.matchHint || '(none)'}` }];
  }
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (ctx.localTime || '').split(':').map(Number);
  if (!ctx.tz || Number.isNaN(h) || Number.isNaN(mi)) {
    return [{ ok: false, reason: `時刻情報が不足（tz/localTimeが必要）: date=${dateStr}` }];
  }
  const jst = zonedWallTimeToJst(y, mo, d, h, mi, ctx.tz);
  return entries.map((nameEntry) => ({
    ok: true,
    date: jst.date,
    time: jst.time,
    kind: ctx.kind,
    country: ctx.country,
    displayName: nameEntry.display_name,
    importance: resolveImportance(ctx.kind, ctx.country, ctx.importanceRules),
  }));
}

module.exports = { resolveCandidateEvent, resolveKindCandidates };
