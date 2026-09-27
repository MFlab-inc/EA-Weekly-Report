'use strict';
// RBA（豪州準備銀行）の事前公表予定表ページの抽出ルール
// （config/official-sources.json au_rba_calendar、coming-up/index.html）。
//
// しょうさん指摘（2026-09-27）: au_rba_speeches（RSS、常に最新1件のみ掲載）は総裁・副総裁級の
// ★★★講演を無警告で取りこぼす経路になっている（同一週内に複数講演があると先に行われた方が
// 上書きされて消える。config/official-sources.jsonのau_rba_speeches.notes参照）。coming-up/
// index.htmlはRBA自身の行事予定を常時ローリング掲載するページのため、gb_boe_calendar・
// us_frb_calendarと同じ位置づけの事前告知ソースとして追加した。
//
// ライブ実測（2026-09-27、実ネットワーク経由）: 1ページに1年以上先までの全予定が
// <article class="item event-category-speeches event-type-{speech|fireside-chat|
// panel-participation|media-conference} ...">という構造で並ぶ（月別ページ分割なし、
// buildTargets不要）。各<article>は<h4 class="heading" itemprop="headline">{見出し}</h4>と
// <time class="datetime" itemprop="datePublished" datetime="{ISO8601、明示的UTCオフセット付き}">
//   <span class="date">...</span><span class="time">{現地表記、AEST/AEDT付き}</span>
// </time>を持つ。「要人が登壇して発言する」予定はevent-type-speech以外にも
// event-type-fireside-chat（実測例: Christopher Kent副総裁補）・event-type-panel-participation
// （実測例: Brad Jones副総裁補）が使われるため、event-category-speeches全体を対象としつつ、
// 政策金利決定後の記者会見（event-type-media-conference、既存au_rba[年次確定schedule]が
// 別途担当。実測は常にブロック総裁のgov/governor付き）のみを除外する。議事録公表・出版物告知は
// そもそもevent-category-speechesではないため対象外。
//
// 見出しの書式は複数観測された（"Speech by {Name}, {Role}, at ..."／"Appearance by {Name},
// {Role} at ..."／"Fireside Chat with {Name}, {Role}, at ..."／"Panel Participation by {Name},
// {Role}, at ..."）ため、話者名は特定の前置動詞句を列挙せず「"by "または"with "の直後、
// 最初のカンマまたは" at "まで」という汎用パターンで抽出する（未知の言い回しにもある程度耐性を
// 持たせるため）。抽出できない場合はspeakerLastName:nullのまま掲載し、話者解決は既存の安全側
// フォールバック（build-ledger.js resolveOfficialSpeechImportance、★★+WARN）に委ねる
// （BOE以外の登壇者を弾かないgb_boe_speeches等と同じ設計。このページはRBA自身の行事予定であり
// 外部登壇者が基本的に混ざらないため、gb_boe_calendarのような未登録話者フィルタは適用しない）。
//
// AEST/AEDTの判定について: datetime属性自体が明示的なUTCオフセット（+10:00/+11:00）を持つため、
// DST判定はページ側で既に解決済みの値をutcInstantとしてそのまま使えば足りる（他のBOC/RBA/ECB/SNB
// 講演RSS抽出器と同じ「絶対時刻はDST判定不要」の設計）。ただし「正しく判定して」というしょうさん
// 指摘に応えるため、次の2つの一貫性チェックを追加した:
//  (a) 同じ<time>要素内のオフセット（+10:00/+11:00）とテキスト表記の略称（AEST/AEDT）が
//      矛盾していないか
//  (b) そのオフセットが、scripts/lib/tz-convert.js（Node組み込みIANAタイムゾーンデータ）で
//      計算したAustralia/Sydneyの実際のオフセットと一致するか
// いずれかが不一致の場合、サイト側の表示不備または想定外のDST規則変化の疑いとして構造的失敗を返す
// （フェールクローズ。氷見野副総裁のケース等と同じく、推測で押し通さず気づける仕組みにする）。
//
// 時刻の扱い: datetime属性を読み取れない、またはオフセットを解析できない行（想定外の構造変化）は、
// 時刻を推測で補わずその行を掲載しない（gb_boe_calendar・frb-calendar.jsの「時刻が一意に決まらない
// 行は掲載しない」設計と同じ）。
const { offsetMinutesAt } = require('../../lib/tz-convert');

const SYDNEY_TZ = 'Australia/Sydney';
const ARTICLE_RE = /<article\b([^>]*)>([\s\S]*?)<\/article>/g;
const SPEECHES_CATEGORY_RE = /class="[^"]*\bevent-category-speeches\b[^"]*"/;
const MEDIA_CONFERENCE_CLASS_RE = /class="[^"]*\bevent-type-media-conference\b[^"]*"/;
const HEADLINE_RE = /<h4[^>]*itemprop="headline"[^>]*>([\s\S]*?)<\/h4>/;
const TIME_TAG_RE = /<time\b[^>]*\bdatetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/;
const TIME_TEXT_RE = /<span class="time">([\s\S]*?)<\/span>/;
// "by "または"with "の直後、最初のカンマまたは" at "の手前までを話者名として拾う
// （1〜4語、各語大文字始まり。"Marnie Baker AM"のような勲章等の接尾辞も許容してそのまま渡す）
const SPEAKER_NAME_RE = /\b(?:by|with)\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3})\s*(?:,|\s+at\b)/;

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&#146;|&rsquo;|&#8217;/g, "'")
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function cleanText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// "+11:00"/"+1100"/"Z" -> 660 / 660 / 0（分）
function parseOffsetMinutes(raw) {
  if (raw === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

// datetime属性（例: "2026-11-05T17:35+11:00"／"2026-11-03T14:30:00+11:00"）から
// UTC Instant（Date）とオフセット分を取り出す
function parseDatetimeAttr(raw) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const offsetMin = parseOffsetMinutes(m[2]);
  if (offsetMin === null) return null;
  const offsetStr = m[2] === 'Z' ? 'Z' : (m[2].includes(':') ? m[2] : `${m[2].slice(0, 3)}:${m[2].slice(3)}`);
  const utcInstant = new Date(`${m[1]}:00${offsetStr}`);
  if (Number.isNaN(utcInstant.getTime())) return null;
  return { utcInstant, offsetMin };
}

// テキスト表記の略称（"5.35 pm AEDT"）からAEST/AEDTを読み取り、期待されるオフセット分を返す
// （AEST=+10:00=600分、AEDT=+11:00=660分）。どちらでもなければnull（アノテーション無し等）
function expectedOffsetFromAbbrText(timeText) {
  if (/\bAEDT\b/.test(timeText)) return 660;
  if (/\bAEST\b/.test(timeText)) return 600;
  return null;
}

function extractSpeakerName(headlineText) {
  const m = SPEAKER_NAME_RE.exec(headlineText);
  return m ? m[1].trim() : null;
}

// html: coming-up/index.htmlの生HTML全体
// 戻り値: { ok: true, items: [{ title, utcInstant, speakerLastName }] } または { ok: false, reason }
function extractRbaCalendar(html) {
  const items = [];
  let speechArticleCount = 0;
  let m;
  ARTICLE_RE.lastIndex = 0;
  while ((m = ARTICLE_RE.exec(html))) {
    const [, attrs, body] = m;
    const openTag = `<article${attrs}>`;
    if (!SPEECHES_CATEGORY_RE.test(openTag)) continue; // event-category-speeches以外（決定発表・出版物等）は対象外
    if (MEDIA_CONFERENCE_CLASS_RE.test(openTag)) continue; // 政策決定後の記者会見は既存au_rba（年次確定schedule）が別途担当
    speechArticleCount += 1;

    const headlineM = HEADLINE_RE.exec(body);
    if (!headlineM) continue; // 見出しが取れない行は掲載しない（推測で補わない）
    const title = cleanText(headlineM[1]);

    const timeTagM = TIME_TAG_RE.exec(body);
    if (!timeTagM) continue; // 時刻情報が無い行は掲載しない
    const parsed = parseDatetimeAttr(timeTagM[1]);
    if (!parsed) continue; // datetime属性を解析できない行は掲載しない（推測で補わない）

    const timeTextM = TIME_TEXT_RE.exec(timeTagM[2]);
    const timeText = timeTextM ? cleanText(timeTextM[1]) : '';
    const abbrExpected = expectedOffsetFromAbbrText(timeText);
    if (abbrExpected !== null && abbrExpected !== parsed.offsetMin) {
      return {
        ok: false,
        reason: `「${title}」の時刻表記のオフセットが矛盾している（datetime属性=${parsed.offsetMin}分 / テキスト表記「${timeText}」由来の期待値=${abbrExpected}分）。サイト側の表示不備の疑い`,
      };
    }
    const realOffset = offsetMinutesAt(parsed.utcInstant, SYDNEY_TZ);
    if (realOffset !== parsed.offsetMin) {
      return {
        ok: false,
        reason: `「${title}」（${timeTagM[1]}）のオフセットが、Australia/Sydneyの実際のDST規則（${realOffset}分）と一致しない（サイト側=${parsed.offsetMin}分）。想定外のDST規則変化またはサイト側の表示不備の疑い`,
      };
    }

    items.push({
      title,
      utcInstant: parsed.utcInstant.toISOString(),
      speakerLastName: extractSpeakerName(title),
    });
  }

  if (speechArticleCount === 0) {
    return { ok: false, reason: 'event-category-speechesの<article>要素が1件も見つからない。サイト構造変化の疑い' };
  }
  if (items.length === 0) {
    return {
      ok: false,
      reason: 'event-category-speechesの<article>要素は見つかったが、見出し・時刻を1件も抽出できなかった。サイト構造変化の疑い',
    };
  }

  return { ok: true, items };
}

module.exports = {
  extractRbaCalendar,
  parseDatetimeAttr,
  parseOffsetMinutes,
  expectedOffsetFromAbbrText,
  extractSpeakerName,
};
