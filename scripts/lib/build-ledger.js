'use strict';
// 根拠台帳（data/ledger/YYYY-MM-DD.json）の生成（task #13、しょうさん指示2026-08-15で新設）。
// scripts/checkers/harness.mjsのrunChecks()結果＋config/manual-events.jsonの候補を、
// scripts/lib/validate-ledger.jsのスキーマへ変換する。
// 「1イベント＝1レコード、出典を必ず持つ」の一点に絞った設計（旧Manusスキーマは継承しない。
// docs/ledger-schema.md参照）。
const { parseYmd, addDays, formatYmd } = require('./dates');
const { computeHaltWindow } = require('./halt-schedule');
const naming = require('./naming');

// ISO国コード→通貨コード（レンダラー用のconfig/country-currency-map.jsonは日本語国名キーのため
// 台帳用に別途保持する。台帳のcountryはISOコードで統一するため）。
// 2026-08-15追記（task #54、しょうさん指摘: DE国追加時にこのdictへの追加漏れで通貨ピルが
// 「DE」と誤表示された）: scripts/render/ledger-to-week-input.jsのCOUNTRY_JA_BY_ISOと合わせて
// 2つ存在する並行dictで、config/official-sources.jsonへ新規登場した国を追加するたびに両方へ
// 手動追加する必要がある。追加漏れはscripts/lib/validate-country-currency-coverage.js
// （test/validate-country-currency-coverage.test.jsの実configゲート）で検出される
const CURRENCY_BY_COUNTRY = {
  JP: 'JPY', US: 'USD', GB: 'GBP', AU: 'AUD', EU: 'EUR',
  NZ: 'NZD', CA: 'CAD', CH: 'CHF', CN: 'CNY', DE: 'EUR',
};

// 表示名が未解決（辞書照合を経由しないSPEC §4.2の規則生成kind）の場合の暫定日本語ラベル。
// resolveRuleGeneratedName()（下記）が対応できないkind向けの最終フォールバック
// （name_resolution="rule_generated"として明示するため、これが最終形ではないことは台帳上も分かる）
const FALLBACK_KIND_LABEL = {
  policy_rate: '政策金利発表',
  press_conference: '記者会見',
  testimony: '議会証言',
  opinions_summary: '金融政策の議論の概要',
  minutes_summary: '議事要旨',
  quarterly_report: '四半期報告',
  official_speech: '要人発言',
  bond_auction: '国債入札',
};

// 国債入札のissueYearMonthJa（発行年月、例「2026年8月」）。発表元記載の発行月そのものではなく、
// 既刊ground truth2件（jp_jgb_10y_auction_20260804・jp_jgb_30y_auction_20260806）で
// 入札日=発行月が一致することを確認済みの近似として、候補date（=入札日）の年月から導出する
// （docs/ledger-schema.md参照）
function issueYearMonthJaFromDate(dateStr) {
  const [y, m] = dateStr.split('-');
  return `${y}年${Number(m)}月`;
}

// official_speech（要人発言）の役職ラベル。country単位で1つに決め打ちできる情報源のみ登録する
// （2026-08-15時点、情報源はus_frb_speeches[FRB理事講演RSS]のみ。全FRB理事が同一の日本語役職
// 表記「FRB理事」で通るため国単位定数が成立する）。JPは対象外（2026-08-22、task #64・
// jp_boj_speeches新設）: BOJの話者は副総裁・審議委員・理事など役職が話者ごとに異なるため、
// 国単位の固定ラベルでは成立しない。officials.jsonで話者本人が特定できた場合はその人物の
// role_ja（例:「日銀副総裁」）を直接使う設計とした（下記resolveRuleGeneratedName参照）。
// 未登録の話者（田村・高田・神山等）はofficial=null扱いとなりFALLBACK_KIND_LABEL『要人発言』へ
const OFFICIAL_SPEECH_ROLE_BY_COUNTRY = {
  US: 'FRB理事',
};

// official_speechの重要度を話者の格（officials.jsonのrole_rank）で決める（2026-08-22、task #68、
// しょうさん指摘: 一律★★★は審議委員クラスの地方講演まで昇格させ★★★の希少性を損なうため不採用。
// フラッシュPMIを★★据え置きとしたのと同じ理由）。governor（総裁・議長）/deputy_governor（副総裁）
// →★★★、board_member（審議委員・理事・地区連銀総裁等）→★★。話者が未登録・role_rank未設定の
// 場合は安全側でboard_member相当（★★）とし、追跡できるようwarningを添えて返す（下記
// resolveOfficialSpeechImportance参照。呼び出し側[buildEventsSection]がwarningsを収集しmeta.warningsへ
// 反映する）
const OFFICIAL_SPEECH_IMPORTANCE_BY_RANK = {
  governor: 3,
  deputy_governor: 3,
  board_member: 2,
};

// candidate.kind !== 'official_speech' はcandidate.importanceをそのまま素通しする（他kindには無関係）。
// official_speechはimportance_by_kindの既定値（★★）を無視し、話者のrole_rankから動的に決め直す
function resolveOfficialSpeechImportance(candidate, officials) {
  if (candidate.kind !== 'official_speech') return { importance: candidate.importance, warning: null };
  const official = naming.resolveOfficialBySurname(officials, candidate.speakerLastName);
  const rank = official && official.verified ? official.role_rank : null;
  if (rank && OFFICIAL_SPEECH_IMPORTANCE_BY_RANK[rank] != null) {
    return { importance: OFFICIAL_SPEECH_IMPORTANCE_BY_RANK[rank], warning: null };
  }
  const speaker = candidate.speakerLastName || '(話者不明)';
  return {
    importance: OFFICIAL_SPEECH_IMPORTANCE_BY_RANK.board_member,
    warning: `official_speechの話者の格を判定できず★★（安全側）とした: country=${candidate.country} speaker="${speaker}" date=${candidate.date}（officials.json未登録、またはrole_rank未設定）`,
  };
}

// minutes_summary（中銀議事要旨）のBOJ以外向け国別命名（task #41-1、しょうさん承認済み
// 国×kindマトリクス）。BOJ（naming.bojMinutesName、periodJa付き）とは異なり、各中銀の
// 議事要旨は通称としての固有名詞が既に確立しているため、対象会合の特定を伴わない固定文言とする。
// 会合日程自体は既存の中銀ソース（us_frb_policy_rate/au_rba/ecb_policy_rate/boc_policy_rate）の
// scheduleへ配線している（US/AUは会合日からの固定オフセット計算、EU/CAは各中銀が単発告知する
// 実日付をWebSearch経由で個別収録。config/official-sources.json該当ソースのnotes参照）。
// EU（ECB Accounts of the monetary policy meeting）・CA（BOC Summary of Governing Council
// Deliberations）はいずれも公式文書名が「議事録（transcript）」ではなく「要旨（summary/accounts）」
// のため、FOMC議事録ではなくRBA議事要旨と同じ命名パターンを踏襲した
const MINUTES_SUMMARY_NAME_BY_COUNTRY = {
  US: 'FOMC議事録',
  AU: 'RBA議事要旨',
  EU: 'ECB議事要旨',
  CA: 'BOC議事要旨',
};

// SPEC §4.2の規則生成命名テンプレート（scripts/lib/naming.js）による解決を試みる。
// - policy_rate/quarterly_report: candidate.country（naming.BANK_ABBR_BY_COUNTRY）のみで解決可能
// - press_conference: officials（country×role_type=central_bank_governor）で解決可能
// - opinions_summary/minutes_summary: BOJ（country=JP）限定。candidate.periodJa
//   （scripts/phase1/observation-run.mjsのresolveBojPeriodJaが算出）が無くても年月日なしの
//   基底文言を返す（FALLBACK_KIND_LABELの汎用ラベルより情報量が多いため常に優先する）。
//   SNB等JP以外のopinions_summaryはBOJ固有の文言のため対象外（FALLBACK_KIND_LABELへ）
// - bond_auction: candidate.tenorJa（mof.js/us-treasury.jsが抽出）が無ければ対象外。
//   country=JP/USのみテンプレートが定義されている（SPEC §4.2）
// - official_speech: candidate.speakerLastNameをofficials.jsonと照合（naming.resolveOfficialBySurname）。
//   一致し verified:true であれば、その人物自身のrole_ja（officials.json側）を使う（2026-08-22、
//   task #64修正: BOJは副総裁・審議委員・理事等で話者ごとに役職が異なるため、国単位の固定ラベル
//   [OFFICIAL_SPEECH_ROLE_BY_COUNTRY]では表現できない。US[FRB理事で統一]は元々この分岐に来ても
//   同じ値になるため後方互換）。不一致（未登録・未指定・未verified）はOFFICIAL_SPEECH_ROLE_BY_COUNTRY
//   の国単位フォールバックへ（無ければnull→FALLBACK_KIND_LABEL『要人発言』）。
//   2026-08-15時点officials.jsonにFRB理事個人（議長以外）は未登録（task #17）のため米国は実運用では
//   常に役職のみになる
// - testimony: manual-events.json由来の候補は常にcandidate.displayNameを持つため、
//   本関数を経由する前にcandidateToLedgerEvent側で優先採用される（対象外）
function resolveRuleGeneratedName(candidate, officials) {
  if (candidate.kind === 'policy_rate' || candidate.kind === 'quarterly_report') {
    const bankAbbr = naming.BANK_ABBR_BY_COUNTRY[candidate.country];
    if (!bankAbbr) return null;
    return candidate.kind === 'policy_rate' ? naming.policyRateName(bankAbbr) : naming.quarterlyReportName(bankAbbr);
  }
  if (candidate.kind === 'press_conference') {
    const official = naming.resolveGovernor(officials, candidate.country);
    return official ? naming.pressConferenceName(official, official.role_ja) : null;
  }
  if (candidate.kind === 'opinions_summary' && candidate.country === 'JP') {
    return naming.bojOpinionsName(candidate.periodJa);
  }
  if (candidate.kind === 'minutes_summary') {
    if (candidate.country === 'JP') return naming.bojMinutesName(candidate.periodJa);
    return MINUTES_SUMMARY_NAME_BY_COUNTRY[candidate.country] || null;
  }
  if (candidate.kind === 'bond_auction' && candidate.tenorJa) {
    const issueYearMonthJa = issueYearMonthJaFromDate(candidate.date);
    if (candidate.country === 'JP') return naming.bondAuctionNameJp(candidate.tenorJa, issueYearMonthJa);
    if (candidate.country === 'US') return naming.bondAuctionNameUs(candidate.tenorJa);
    return null;
  }
  if (candidate.kind === 'official_speech') {
    const official = naming.resolveOfficialBySurname(officials, candidate.speakerLastName);
    if (official && official.verified && official.role_ja) {
      return naming.speechName(official, official.role_ja);
    }
    const roleJa = OFFICIAL_SPEECH_ROLE_BY_COUNTRY[candidate.country];
    if (!roleJa) return null;
    return naming.speechName(official, roleJa);
  }
  return null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 分（負数・1440以上も許容、halt-schedule.jsのstartMin/endMinと同じ規約）を、
// baseDate（'YYYY-MM-DD'）起点のJST ISO日時（+09:00）へ変換する
function minutesToJstIso(baseDate, minutes) {
  const dayOffset = Math.floor(minutes / 1440);
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
  const date = formatYmd(addDays(parseYmd(baseDate), dayOffset));
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${date}T${pad2(h)}:${pad2(m)}:00+09:00`;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function makeEventId(candidate, usedIds) {
  const base = `${(candidate.country || 'xx').toLowerCase()}-${candidate.kind}-${candidate.date}`;
  let id = base;
  let n = 2;
  while (usedIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  usedIds.add(id);
  return id;
}

// 1件の候補（resolveCandidateEvent/annualEntryToCandidate/manualEntryToCandidateいずれかの出力。
// date/time/kind/country/importance/displayName/sourceId/sourceEvidence/localDate/localTime/tz
// を持つ共通形）を台帳イベントへ変換する。importance未設定・0（非掲載）は呼び出し側でフィルタ済みの前提。
// officials: config/officials.jsonのofficials配列（省略可。省略時はresolveRuleGeneratedNameが
// 常にnullを返しFALLBACK_KIND_LABELへ落ちる＝既存呼び出し元との後方互換を保つ）
function candidateToLedgerEvent(candidate, usedIds, officials) {
  const timeStatus = candidate.time ? 'published' : 'unpublished';
  const datetimeJst = candidate.time ? `${candidate.date}T${candidate.time}:00+09:00` : null;
  const nameJa = candidate.displayName
    || resolveRuleGeneratedName(candidate, officials)
    || FALLBACK_KIND_LABEL[candidate.kind]
    || `[${candidate.kind}]`;

  let haltStart = null;
  let haltEnd = null;
  if (candidate.importance === 3 && timeStatus === 'published') {
    const w = computeHaltWindow({ date: candidate.date, firstTime: candidate.time });
    haltStart = minutesToJstIso(candidate.date, w.startMin);
    haltEnd = minutesToJstIso(candidate.date, w.endMin);
  }

  return {
    event_id: makeEventId(candidate, usedIds),
    date_local: candidate.localDate || candidate.date,
    time_local: candidate.localTime || null,
    tz: candidate.tz || null,
    date_jst: candidate.date,
    datetime_jst: datetimeJst,
    time_status: timeStatus,
    country: candidate.country,
    currency: CURRENCY_BY_COUNTRY[candidate.country] || candidate.country,
    kind: candidate.kind,
    name_ja: nameJa,
    importance: candidate.importance,
    source_id: candidate.sourceId,
    source_evidence: candidate.sourceEvidence || candidate.rawTitle || candidate.note || '',
    name_resolution: candidate.displayName ? 'dictionary' : 'rule_generated',
    halt_window_start_jst: haltStart,
    halt_window_end_jst: haltEnd,
    bundle_id: null,
  };
}

function minutesBetween(isoA, isoB) {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 60000);
}

// 発表枠の束ね（bundle_id、SPEC §5「発表枠は枠内最初の発表時刻を基準に計算。再開確認は
// 枠内最後のイベント終了後から」・task #34、しょうさん確定ルール2026-08-15）:
// 「同一国×同一source_id×同一日（date_jst）×発表時刻が90分以内」を同一bundleとする。
// 90分判定は隣接イベント間の間隔（time順にソートし、直前のイベントとの差）で連鎖的に判定する
// （固定の基準時刻からの絶対窓ではなく、間隔ベースのクラスタリング。既刊2週で検証した既存の
// クラスタ[RBA13:30+13:30+14:30・CPI/PPI同時刻2件]はいずれの解釈でも同じ結果になるため実害はない）。
// 時刻未公表（datetime_jst:null）のイベントは束ねの対象外（bundle_id:null=単独のまま）。
// importanceは問わない（bundle自体はimportance非依存。windowGroups生成側
// [scripts/render/ledger-to-week-input.js]でimportance=3のみに絞る）。
// bundle_idはクラスタ内で時刻が最も早いイベントのevent_idを使う（一意・追跡可能なグループID）
function computeBundleIds(events) {
  const groups = new Map(); // `${country}|${source_id}|${date_jst}` -> events[]
  for (const e of events) {
    if (!e.datetime_jst) continue;
    const key = `${e.country}|${e.source_id}|${e.date_jst}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const bundleIdByEventId = new Map();
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.datetime_jst.localeCompare(b.datetime_jst));
    let clusterStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const gap = i < sorted.length ? minutesBetween(sorted[i - 1].datetime_jst, sorted[i].datetime_jst) : Infinity;
      if (i === sorted.length || gap > 90) {
        const cluster = sorted.slice(clusterStart, i);
        if (cluster.length > 1) {
          const bundleId = cluster[0].event_id;
          for (const ev of cluster) bundleIdByEventId.set(ev.event_id, bundleId);
        }
        clusterStart = i;
      }
    }
  }
  return events.map((e) => (bundleIdByEventId.has(e.event_id) ? { ...e, bundle_id: bundleIdByEventId.get(e.event_id) } : e));
}

// report.results（runChecks()の戻り値）から{country,kind,importance,...}候補一覧を集める。
// annualEntryToCandidateはscripts/phase1/observation-run.mjs（ESM）にあるため、呼び出し側から
// 変換済み候補配列として渡す設計にする（build-ledger.js自体はCJSに保つ。他scripts/lib/*.jsと同じ規約）
function buildSourcesSection(report, sourcesConfig, generatedAt) {
  const sources = [];
  for (const r of report.results) {
    const source = sourcesConfig.sources.find((s) => s.id === r.id);
    const url = source?.access?.targets?.[0]?.url || source?.access?.manual_verify_url || source?.fred?.api_base || null;
    let failClosedDecision = 'OK';
    if (r.skipped) failClosedDecision = 'SKIPPED';
    else if (!r.ok) failClosedDecision = report.outcome.status === 'HOLD' ? 'HOLD' : 'WARN';
    sources.push({
      source_id: r.id,
      type: source?.type || 'weekly_scrape',
      fetched_at: generatedAt,
      url: url || 'unknown',
      ok: r.skipped ? true : Boolean(r.ok),
      http_status: null,
      extractor_result_count: (r.thisWeek?.length ?? r.matchedEntries?.length ?? 0),
      robots_checked: Boolean(source?.access?.robots_check),
      fail_closed_decision: failClosedDecision,
    });
  }
  return sources;
}

// candidates: buildObservationSummary()と同じ形の候補配列（manual含む）。importance 0/nullは
// 呼び出し側で除外済みの前提（0=非掲載は台帳に載せない、というスキーマ規約のため）。
// official_speechはresolveOfficialSpeechImportanceで話者のrole_rankから重要度を決め直してから
// candidateToLedgerEventへ渡す（2026-08-22、task #68）。話者未登録等で安全側判定になった場合の
// warningsも合わせて返す（呼び出し側[buildLedger]がmeta.warningsへ合流させる）
function buildEventsSection(candidates, officials) {
  const usedIds = new Set();
  const warnings = [];
  const adjusted = candidates.map((c) => {
    const { importance, warning } = resolveOfficialSpeechImportance(c, officials);
    if (warning) warnings.push(warning);
    return importance === c.importance ? c : { ...c, importance };
  });
  const events = adjusted.map((c) => candidateToLedgerEvent(c, usedIds, officials));
  return { events: computeBundleIds(events), warnings };
}

function buildManualSourceEntry(manualEventsConfig, targetWeekStart, targetWeekEnd, generatedAt) {
  const count = (manualEventsConfig?.entries || []).filter((e) => e.date >= targetWeekStart && e.date <= targetWeekEnd).length;
  return {
    source_id: 'manual',
    type: 'manual',
    fetched_at: generatedAt,
    url: 'config/manual-events.json',
    ok: true,
    http_status: null,
    extractor_result_count: count,
    robots_checked: false,
    fail_closed_decision: 'OK',
  };
}

// meta.warnings/holdsの文字列一覧を組み立てる
function buildMetaMessages(report) {
  const warnings = [];
  const holds = [];
  if (report.outcome.status === 'WARN') warnings.push(...(report.outcome.reasons || []));
  if (report.outcome.status === 'HOLD') holds.push(...(report.outcome.reasons || []));
  warnings.push(...(report.residualWarnings || []).map((w) => `残量監視WARN: ${w.id} — ${w.warn}`));
  warnings.push(...(report.recurringMissingWarnings || []));
  return { warnings, holds };
}

// メインの組み立て関数。
// candidates: 対象週の全候補（manual含む・importance 0/null除外済み）
// officialsConfig: config/officials.jsonのパース済みオブジェクト（省略可。SPEC §4.2の規則生成命名
//   テンプレートのうちpolicy_rate/quarterly_report/press_conferenceの解決に使う。省略時はこれらも
//   FALLBACK_KIND_LABELへフォールバックする）
// recurringChecksStatus: [{name, applies_this_week, found}]（呼び出し側でimportanceRules.recurring_checks
//   とmatchesRecurringRule/report.resultsのfoundKindsから組み立てる。ESM依存関数を含むため
//   build-ledger.js自体には持たせず、呼び出し側[scripts/phase1/以下]で計算して渡す）
// generatedFromCommit: 生成時点のmainブランチコミットSHA（省略時null。scripts/build-ledger.mjsが
//   GITHUB_SHAから設定する）。weekly.ymlの冪等チェックが「対象週ファイルの存在有無」だけでなく
//   「現在のHEADと同一コミットで生成済みか」まで見られるようにするための識別子（2026-08-29是正、
//   しょうさん指摘: 手動実行が先取り生成した週をコード修正後も永久にスキップしてしまう不具合があった）
function buildLedger({
  report,
  sourcesConfig,
  manualEventsConfig,
  officialsConfig,
  candidates,
  expectedCoverageResult,
  recurringChecksStatus,
  pipelineVersion,
  generatedAt,
  generatedFromCommit,
}) {
  const { warnings, holds } = buildMetaMessages(report);
  const outcome = report.outcome.status === 'HOLD' ? 'HOLD' : 'PUBLISH_READY';

  const sources = buildSourcesSection(report, sourcesConfig, generatedAt);
  sources.push(buildManualSourceEntry(manualEventsConfig, report.targetWeek.start, report.targetWeek.end, generatedAt));

  const { events, warnings: officialSpeechWarnings } = buildEventsSection(candidates, officialsConfig?.officials);

  return {
    meta: {
      schema_version: '1.0',
      generated_at: generatedAt,
      target_week_start: report.targetWeek.start,
      target_week_end: report.targetWeek.end,
      pipeline_version: pipelineVersion,
      generated_from_commit: generatedFromCommit || null,
      outcome,
      warnings: [...warnings, ...officialSpeechWarnings],
      holds,
    },
    sources,
    events,
    coverage: {
      expected_coverage: {
        required: expectedCoverageResult.required.length,
        missing: expectedCoverageResult.missing,
      },
      recurring_checks: recurringChecksStatus || [],
    },
  };
}

module.exports = {
  buildLedger,
  candidateToLedgerEvent,
  resolveRuleGeneratedName,
  resolveOfficialSpeechImportance,
  computeBundleIds,
  makeEventId,
  minutesToJstIso,
  CURRENCY_BY_COUNTRY,
  FALLBACK_KIND_LABEL,
  MINUTES_SUMMARY_NAME_BY_COUNTRY,
  OFFICIAL_SPEECH_ROLE_BY_COUNTRY,
};
