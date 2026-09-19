'use strict';
// 抽出元の生行（{title, date/localTime または utcInstant}）から、最終的な表示用イベント
// （JST日時・日本語正規名・重要度）を組み立てる（SPEC §4.2・§4.3）。
// utcInstantが取れるソース（ABS・ONS等）はDST判定不要で直接JST変換できるため優先して使う。
// date+localTime（現地時間表記）しか取れないソース（Census等）はtz-convert.jsでDST対応変換する。
const { zonedWallTimeToJst, utcToJstParts, utcToZonedParts } = require('./tz-convert');
const { findEventName } = require('./match-event-name');
const { resolveImportance } = require('./importance');
const { TIME_EXEMPT_KINDS } = require('./validate-official-sources');

// AU四半期GDP（Australian National Accounts: National Income, Expenditure and Product）の
// 表示名を発表月から「第N四半期GDP」へ機械的に決定する（しょうさん指示2026-09-19、PR #28/#29
// フォローアップ確認事項3）。ABS公式メソドロジー
// （https://www.abs.gov.au/methodologies/australian-national-accounts-national-income-expenditure-and-product-methodology/jun-2026）
// に、この四半期GDPは単一発表のみで以降の発表で改定される方式と明記されており、米国の速報/改定/
// 確定や日本の1次/2次速報のような段階分けが無いリリースのため、「【速報値】」等の修飾語は付けない
// （しょうさん指示）。発表月は3/6/9/12月に固定され、発表月→対象四半期の対応も一意に決まる
// （3月→前年第4四半期、6月→第1四半期、9月→第2四半期、12月→第3四半期）ため、推測ではなく
// 確定ルールとして機械的に付与する。年号は既刊表記慣行（例:「第2四半期GDP」）に無いため付与しない
const AU_GDP_QUARTER_BY_ANNOUNCE_MONTH = { 3: 4, 6: 1, 9: 2, 12: 3 };

// announceMonth: 発表時刻のJST暦月（1-12）。ABSの標準発表時刻11:30 Sydney（AEST/AEDTいずれも）は
// JST変換しても同一暦日に収まるため、現地（Sydney）月とJST月は実質的に一致する。
// 想定外の月（発表日程が3/6/9/12月から外れた場合。例: 祝日等でのイレギュラーな月ずれ）はnullを
// 返し、呼び出し側でevent-names.jsonの既定表示名（「GDP」）へフォールバックする
// （掲載自体を止めない安全側の設計）
function auGdpQuarterDisplayName(announceMonth) {
  const quarter = AU_GDP_QUARTER_BY_ANNOUNCE_MONTH[announceMonth];
  return quarter ? `第${quarter}四半期GDP` : null;
}

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
  // 台帳のtime_local/tzは「両方nullか両方非null」が不変条件（scripts/lib/validate-ledger.js）。
  // utcInstantしか持たないソース（ABS・ONS等）はrow.date/row.localTimeを持たないため、
  // ctx.tz（発表元の設定済みタイムゾーン）が分かっていればそこから現地表記を復元する
  // （tzだけ設定されlocalTimeがnullのまま、という不整合を避ける）
  let localDate = row.date || null;
  let localTime = row.localTime || null;
  if (row.utcInstant && !localTime && ctx.tz) {
    const zoned = utcToZonedParts(new Date(row.utcInstant), ctx.tz);
    localDate = zoned.date;
    localTime = zoned.time;
  }
  // jst.date（発表時刻のJST暦日）を使う。ABSの発表時刻11:30 Sydney（AEST/AEDTいずれも）は
  // JST変換しても同一暦日に収まるため月がずれる心配が無く、ctx.tz省略時でも常に算出できる
  // localDateより堅牢（ctx.tzはau_absのconfig上は常に設定されるが、テスト等でtz省略時にも
  // 正しく動くようにするため）
  if (ctx.country === 'AU' && ctx.kind === 'gdp') {
    const auLabel = auGdpQuarterDisplayName(Number(jst.date.slice(5, 7)));
    if (auLabel) displayName = auLabel;
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
    localDate,
    localTime,
    tz: ctx.tz || null,
    utcInstant: row.utcInstant || null,
    // SPEC §4.2の規則生成命名（scripts/lib/build-ledger.jsのresolveRuleGeneratedName）向けの
    // kind別追加コンテキスト。該当しないkindのrowには含まれないためundefined→nullで正規化する
    // （bond_auction: mof.js/us-treasury.jsが抽出。official_speech: frb-speeches.jsが抽出）
    tenorJa: row.tenorJa || null,
    speakerLastName: row.speakerLastName || null,
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
  // 台帳のsource_evidence用: FRED release_idが分かっていれば明記する（ctx.releaseId、
  // harness.mjsのcheckFredSourceが呼び出し時に渡す。2026-08-15、build-ledger.jsの
  // source_evidence必須検証[空ならHOLD]に対応するため追加）
  const sourceEvidence = ctx.releaseId != null
    ? `FRED release_id=${ctx.releaseId}（release_date=${dateStr}）`
    : `release_date=${dateStr}`;
  return entries.map((nameEntry) => ({
    ok: true,
    date: jst.date,
    time: jst.time,
    kind: ctx.kind,
    country: ctx.country,
    displayName: nameEntry.display_name,
    importance: resolveImportance(ctx.kind, ctx.country, ctx.importanceRules),
    rawTitle: nameEntry.display_name,
    sourceEvidence,
    localDate: dateStr,
    localTime: ctx.localTime || null,
    tz: ctx.tz || null,
    utcInstant: null,
  }));
}

module.exports = { resolveCandidateEvent, resolveKindCandidates, auGdpQuarterDisplayName };
