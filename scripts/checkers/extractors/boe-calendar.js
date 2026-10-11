'use strict';
// BOE（Bank of England）の事前公表カレンダーページの抽出ルール
// （config/official-sources.json gb_boe_calendar、events/upcoming-events）。
// しょうさん指示（2026-09-26）: gb_boe_speeches（RSS）は実施後にしか追加されない設計のため、
// 土曜生成のこのレポートでは事前にBOE要人発言を載せられない（us_frb_speechesと同種の構造的
// 限界、既にus_frb_calendarで解決済み）。本ソースはその英国版として新設した。
//
// ライブ実測（2026-09-26、GitHub Actions実ネットワーク経由）: このページは常に「今週＋翌週」の
// ローリング2週間を表示する（<title>が"Upcoming events - w/b {月曜A} and {月曜B}"の形式で
// 表示中の2つの週の開始日を宣言する）。土曜生成時、対象週（来週の月〜金）は必ずこの2週間の
// いずれかと一致するはずという前提を置く。この前提が崩れた場合（サイト構成変更・更新遅延等）は
// 構造的失敗として扱う（ok:falseを返す。しょうさん指示の「気づける仕組み」に相当）。
//
// 実測構造: 各週は<div class="page-content">ブロック内に、日付見出し（実測ではほぼ<h3>{曜日}
// {日} {月}</h3>だが、1件だけ<p><span style="font-size:...; font-weight:700...">{曜日} {日} {月}
// </span></p>という装飾段落形式の日付見出しも存在した=CMS入力時のヒューマンエラーの疑い）に続けて
// 複数の<p>要素が並ぶ。1つの<p>に複数人の予定が<br /><br />で区切られて同居することもある
// （例: Catherine L MannとAlan Taylorが同一<p>）。個々の予定は「{フルネーム}: {説明（リンク付き）}
// （{時刻}）」という形式（時刻は"9am"/"11.25am"/"2.50pm"等、コロン無しドット区切り）。
// 日付見出しではない段落（例: 公表物の告知リンクのみで話者名が無い行）は話者行として一致しない
// ため自然に除外される。
//
// 話者フィルタについて: このページはBOE以外の登壇者（同一イベントの他パネリスト等、実測例:
// ISDAフォーラムのPhil Evans）も含む。抽出器では話者名の是非を判定せず全行を機械的に抽出し
// （gb_boe_speeches等、既存の全講演系抽出器と同じ設計方針）、officials.json未登録の話者は
// 既存の安全側フォールバック（build-ledger.js resolveOfficialSpeechImportance、★★+WARN+
// 「要人発言」表記）に委ねる。抽出時点で「BOE公式かどうか」を判定できる信頼できる構造的手がかり
// （リンク先ドメイン等）が実測上存在しなかったため（総裁ベイリー自身の外部登録リンクの例あり）。
//
// 時刻の扱い: 1つの予定の説明に複数の時刻表記が並ぶ場合（実測例: Sasha Millsの
// "Speech at 9.40am, Panel at 10am"という1件の告知に2つの時刻が併記）、どちらが代表時刻か
// 推測せず、その行は掲載しない（frb-calendar.jsが時刻を解析できない行を静かにスキップするのと
// 同じ設計）。時刻は各予定の最初の括弧内からのみ拾う（説明文の後半に出てくる無関係な時刻表記
// ―実測例: 「(11.25am) - text to be released on Thursday 1 October at 10am.」の"10am"―を
// 誤って拾わないため）。
//
// タイムゾーンの扱い（しょうさん指摘2026-10-10、2026-10-11に範囲を修正）: このページは通常
// 「11am」のように現地時刻を書くだけでタイムゾーンを明記しないが、海外会場での発言（実測
// 2026-10-12週: バンコクIMF年次総会関連のGreene/Pill/Breeden/Bailey）には「(10.30am BST)」の
// ようにBST（または将来GMTの可能性もある）を明記する運用が確認できた。一方、同じ海外会場でも
// Catherine L Mann（NABE年次総会、米国）・Victoria Cleland（デンマークらしき表記）の2件は
// タイムゾーン表記が無いまま掲載されており、この時刻がロンドン時間なのか会場現地時間なのか
// 判別できない。
//
// 当初は「タイムゾーン表記が無い行は全て時刻未確定」という単純な規則を採用したが、しょうさん
// 指摘（2026-10-11）: これはロンドン開催のBOE総裁・副総裁の講演（★★★）の多くにも当たるため
// 範囲が広すぎる（実例: 9/28 ラムスデン副総裁の「11.00am-12.00pm」はロンドンのBOE本店での
// 講演だが表記はタイムゾーン無し）。そのため以下の3段階の判定に変更した:
//
//   1. 括弧内にBST/GMTの明記がある → その時刻帯で確定（従来どおり）
//   2. 明記は無いが、説明文（項目本文）にLondon等の英国内の地名・「Bank of England」等の
//      BOE主催を示す語がある → 英国時間（Europe/London）として確定
//   3. 明記も無く、英国内と判断できる手がかりも本文に無い → 時刻未確定（停止目安の計算対象外）
//      ＋WARN。officials.json照合で話者がgovernor/deputy_governor（★★★）と分かる場合は
//      build-ledger.js側のWARN文言に「★★★・要確認」を明記する（UK_PLACE_HINTS参照）
//
// 個別イベントページ（/speech/...）を追加取得して開催地を判定する案も検討したが、実測
// （Victoria Clelandの/speech/2026/october/victoria-cleland-intergraf-currency-identity-
// conference-demarkページ、2026-10-11実測）で、ページ本文には開催地情報が無く、むしろ
// フッターのBOE自身の所在地表記（「Threadneedle Street, London」）が常に「London」を含んで
// しまうため、ページ全体をそのまま走査すると海外会場でも常に誤って「ロンドン」と判定してしまう
// （Cleland自身の講演はデンマークらしき地名だが、ページ全体を見るとLondonが混入する）。
// BOE側に開催地を明示する構造化フィールドが無い現状では、個別ページ取得は精度向上につながらず
// 誤判定リスクをむしろ高めるため、本抽出器はカレンダーページ自身の説明文のみで判定する
// （しょうさん報告・承認済み、2026-10-11）。
//
// UK_PLACE_HINTSは既知の英国内地名・BOE関連語の一覧（完全な網羅ではない。新しい地名が
// 出てきた場合は追記すること）。時刻未確定の行はlocalTime:nullかつtimeAmbiguous:true・
// ambiguousTimeRaw（元の時刻表記）を持つ形でitemsに含める（除外はしない。
// resolveCandidateEvent/build-ledger.js側でtime_status=unpublished・停止目安[halt_window]
// 対象外・WARN付きのイベントとして扱われる）。

// 英国内と判断する手がかり（2026-10-11新設）。完全な網羅ではなく既知の地名・BOE関連語のみ。
// 新しい地名（例: 新しい開催都市）が出てきたら追記すること
const UK_PLACE_HINTS = [
  'london', 'bank of england', 'threadneedle street',
  'edinburgh', 'glasgow', 'cardiff', 'belfast', 'birmingham', 'manchester',
  'liverpool', 'leeds', 'bristol', 'newcastle', 'coventry', 'nottingham',
  'sheffield', 'oxford', 'cambridge', 'cotswolds',
  'west midlands', 'east midlands', 'yorkshire',
  'united kingdom', 'great britain',
  'england', 'scotland', 'wales', 'northern ireland',
];

function hasUkPlaceHint(text) {
  const lower = text.toLowerCase();
  return UK_PLACE_HINTS.some((k) => lower.includes(k));
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const WEEKDAY_RE = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function cleanText(html) {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();
}

// "9am" / "11.25am" / "2.50pm" -> "09:00" / "11:25" / "14:50"
function parseBoeCalendarTime(raw) {
  const m = /^(\d{1,2})(?:\.(\d{2}))?\s*(am|pm)$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const isPm = /pm/i.test(m[3]);
  if (isPm && h !== 12) h += 12;
  if (!isPm && h === 12) h = 0;
  return `${pad2(h)}:${pad2(min)}`;
}

function addDaysToIsoDate(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// <title>Upcoming events - w/b {D} {Month} {YYYY} and {D} {Month} {YYYY}...</title>
// から、ページが表示中の2つの週の月曜日（ISO日付）を読み取る
function parseDeclaredWindow(html) {
  const m = /w\/b (\d{1,2}) (\w+) (\d{4}) and (\d{1,2}) (\w+) (\d{4})/.exec(html);
  if (!m) return null;
  const mk = (d, mon, y) => {
    const mm = MONTHS[mon.toLowerCase()];
    if (!mm) return null;
    return `${y}-${pad2(mm)}-${pad2(Number(d))}`;
  };
  const monday1 = mk(m[1], m[2], m[3]);
  const monday2 = mk(m[4], m[5], m[6]);
  if (!monday1 || !monday2) return null;
  return { monday1, monday2 };
}

// windowStart（1週目の月曜）から14日分のISO日付配列を作る（2週間分のローリング表示に対応）
function buildWindowDates(windowStart) {
  const dates = [];
  for (let i = 0; i < 14; i++) dates.push(addDaysToIsoDate(windowStart, i));
  return dates;
}

function findDateForHeading(windowDates, day, monthName) {
  const mm = MONTHS[monthName.toLowerCase()];
  if (!mm) return null;
  return windowDates.find((iso) => {
    const [, m, d] = iso.split('-').map(Number);
    return m === mm && d === day;
  }) || null;
}

const HEADING_EXACT_RE = new RegExp(`^${WEEKDAY_RE} (\\d{1,2}) (${MONTH_RE})$`);
// 話者行:「{フルネーム（1〜3語、各語大文字始まり）}: {説明}」。フルネームで抽出する
// （姓のみでは総裁Andrew Baileyと無関係の同姓者を区別できないため。scripts/checkers/
// extractors/boe-speeches.jsと同じ理由・同じ対策）
const SPEAKER_LINE_RE = /^((?:[A-Z][a-zA-Z'’]*\.?\s+){1,2}[A-Z][a-zA-Z'’]*)\s*:\s*(.+)$/;
const BLOCK_RE = /<(h3|p)[^>]*>([\s\S]*?)<\/\1>/g;

// html: events/upcoming-eventsの生HTML全体。ctx: { targetWeek } （harness.mjsのparseCtx）
// 戻り値: { ok: true, items: [{ date, localTime, speakerLastName, title }] } または { ok: false, reason }
function extractBoeCalendar(html, ctx) {
  const window_ = parseDeclaredWindow(html);
  if (!window_) {
    return { ok: false, reason: 'ページの<title>から表示ウィンドウ（w/b {日付} and {日付}）を読み取れない。サイト構造変化の疑い' };
  }
  if (addDaysToIsoDate(window_.monday1, 7) !== window_.monday2) {
    return {
      ok: false,
      reason: `表示ウィンドウの2つの週が7日間隔になっていない（${window_.monday1} / ${window_.monday2}）。サイト構造変化の疑い`,
    };
  }

  // 対象週（月曜始まり）がこのページの表示ウィンドウ（今週+翌週のローリング2週間）に
  // 含まれているかを確認する。土曜生成時に対象週全体が確実に載っているかの安全確認
  // （しょうさん指示、2026-09-26）。前提が崩れた場合はここで検出する
  const targetMonday = ctx?.targetWeek?.targetWeekStart;
  if (targetMonday && targetMonday !== window_.monday1 && targetMonday !== window_.monday2) {
    return {
      ok: false,
      reason: `ページの表示ウィンドウ（w/b ${window_.monday1} and ${window_.monday2}）が対象週（${targetMonday}〜）を含んでいない。事前告知カレンダーの前提（今週+翌週のローリング2週間）が崩れている可能性`,
    };
  }

  const windowDates = buildWindowDates(window_.monday1);

  const startIdx = html.indexOf('<div class="page-content"');
  const endIdx = html.indexOf('<h2>Upcoming key publications</h2>');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { ok: false, reason: 'イベント一覧の開始/終了マーカーが見つからない。サイト構造変化の疑い' };
  }
  const section = html.slice(startIdx, endIdx);

  const items = [];
  let currentDate = null;
  let blockCount = 0;
  let headingCount = 0;
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(section))) {
    blockCount += 1;
    const text = cleanText(m[2]);
    if (!text) continue;

    // 日付見出し判定: 実測上ほぼ<h3>だが、1件だけ装飾<p><span>形式の見出しも観測されたため
    // タグ種別を問わず「内容が曜日+日+月のみで完全一致するか」で判定する（HEADING_EXACT_RE）
    const headingM = HEADING_EXACT_RE.exec(text);
    if (headingM) {
      headingCount += 1;
      const date = findDateForHeading(windowDates, Number(headingM[1]), headingM[2]);
      if (!date) {
        return {
          ok: false,
          reason: `日付見出し「${text}」が表示ウィンドウ（${window_.monday1}〜${windowDates[13]}）内の日付と対応しない。サイト構造変化の疑い`,
        };
      }
      currentDate = date;
      continue;
    }

    // このプロジェクトが追跡する日付見出しの体裁と紛らわしい行（曜日+日+月で始まるが後続に
    // 別の文が続く、等）ではない通常の内容行。<br /><br />区切りで複数人の予定が同居する
    // ケース（実測例: Catherine L Mann / Alan Taylor）に対応するため分割してから処理する
    if (!currentDate) continue; // 最初の見出しより前の内容（実測上は無い想定）は対象外
    const chunks = m[2].split(/<br\s*\/?>\s*<br\s*\/?>/i);
    for (const chunkHtml of chunks) {
      const chunkText = cleanText(chunkHtml);
      const speakerM = SPEAKER_LINE_RE.exec(chunkText);
      if (!speakerM) continue; // 話者名を伴わない行（公表物の告知リンク等）は掲載対象外
      const firstParenM = /\(([^)]*)\)/.exec(chunkText);
      if (!firstParenM) continue; // 時刻の手がかりが無い行は掲載しない（推測で補わない）
      const parenContent = firstParenM[1];
      const timeMatches = [...parenContent.matchAll(/\d{1,2}(?:\.\d{2})?\s*(?:am|pm)/gi)];
      if (timeMatches.length !== 1) continue; // 時刻0件、または併記で一意に決まらない行は
        // 推測で補わずスキップする（例: 「Speech at 9.40am, Panel at 10am」は掲載しない）
      const localTime = parseBoeCalendarTime(timeMatches[0][0]);
      if (!localTime) continue;
      const hasTzMarker = /\b(?:BST|GMT)\b/i.test(parenContent);
      if (hasTzMarker || hasUkPlaceHint(chunkText)) {
        // 1) タイムゾーン明記あり、または 2) 明記は無いが説明文に英国内の地名・BOE主催を
        // 示す語がある → 英国時間として確定する（上記コメント参照、しょうさん指示2026-10-11）
        items.push({
          date: currentDate,
          localTime,
          speakerLastName: speakerM[1].trim(),
          title: chunkText,
        });
      } else {
        // 3) タイムゾーン明記が無く、英国内と判断できる手がかりも説明文に無い → 推測せず
        // 時刻未確定として扱う（上記コメント参照、しょうさん指示2026-10-11）
        items.push({
          date: currentDate,
          localTime: null,
          speakerLastName: speakerM[1].trim(),
          title: chunkText,
          timeAmbiguous: true,
          ambiguousTimeRaw: timeMatches[0][0].trim(),
        });
      }
    }
  }

  if (headingCount === 0) {
    return { ok: false, reason: '曜日見出し（{曜日} {日} {月}）が1件も見つからない。サイト構造変化の疑い' };
  }
  if (blockCount === 0) {
    return { ok: false, reason: '<h3>/<p>要素が1件も見つからない。サイト構造変化の疑い' };
  }
  // しょうさん指示（2026-09-27）: このページは通常必ず何らかの予定が掲載されている
  // （BOEは総裁以下、常時複数の講演・パネル登壇を抱えているため）。曜日見出しは見つかった
  // のに話者行が1件も抽出できない場合、話者行のHTMLパターン（{フルネーム}: {説明}({時刻})）
  // 自体がサイト側で変わった疑いが強いため、HTTP取得自体は成功していても構造的失敗として扱う
  // （officials.json未登録による掲載対象外化はbuild-ledger.js側の別処理であり、ここでの
  // 「0件」判定は抽出そのものが1件もヒットしなかった場合のみを対象とする）
  if (items.length === 0) {
    return {
      ok: false,
      reason: 'このページは通常必ず何らかの予定が掲載されているが、話者行を1件も抽出できなかった。サイト構造変化の疑い',
    };
  }

  return { ok: true, items };
}

module.exports = {
  extractBoeCalendar,
  parseDeclaredWindow,
  parseBoeCalendarTime,
  buildWindowDates,
};
