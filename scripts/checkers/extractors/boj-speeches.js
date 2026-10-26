'use strict';
// 日本銀行「公表予定」ページ（config/official-sources.json jp_boj_speeches、
// boj.or.jp/about/calendar/index.htm）の抽出ルール。
// 実データ構造（2026-08-22実測、manus-diff-recon一時ワークフロー・run 32555894283）:
// <table><thead>(公表日|時刻|日|英|資料名)</thead><tbody><tr><td>...</td>...</tr>...</tbody></table>
// 「公表日」セルは同一日内の2行目以降が空欄になる（前の非空値を繰り越して補う必要がある）。
// 「時刻」セルは各行ごとに必ず入るが、「未定」等の非HH:MM値の行（記者会見の多くがこれ）は
// 時刻情報が組み立てられないため対象外とする。
// 「資料名」セルが「【挨拶】{氏名}{役職}（{地域}）」または「【講演】...」形式の行のみを
// official_speechとして抽出する（同ページには【記者会見】や統計公表等の無関係な行が大量に混在するため）。
// 年は本ページに明記されない（毎週金曜更新・向こう1ヶ月強のみを表示するローリング表）ため、
// ctx.targetWeek.targetWeekStartの年を起点とし、月が前より小さくなった時点（年末→年始のロールオーバー）
// でのみ+1年する。
// 2026-08-30追記（task #83、しょうさん指摘: 9/2高田審議委員の挨拶が不検出）: 実fixture
// （test/fixtures/official-sources/jp_boj_speeches/calendar_index.html、2026-08-22実測）を確認したところ、
// 「公表日」セルは「25日（火）」のように月の表記自体を一切含まない（「8月」の接頭辞が無い）ことが判明した。
// 従来のロジックは月表記が省略された行を常に「前回と同じ月」（lastMonth）とみなしていたため、
// 月境界をまたぐ週（例: 8/31週で31日の次の行が2日＝9/2）で日が前回より小さくなった（31→2）ことを
// 検出できず、9月のイベントが誤って8月扱い（2026-08-02）になり、対象週フィルタで無警告のまま
// 除外されていた。月表記が省略された行では「日が前回より小さくなったら月が繰り上がった」とみなす
// フォールバックを追加した（年末→年始のロールオーバー検出と同じ考え方を月表記省略時にも適用）。

// 【挨拶】氷見野副総裁（埼玉） のような形式から、氏名（氷見野）と役職接尾辞（副総裁）を分離する。
// officials.jsonのfull_name部分一致照合（naming.resolveOfficialBySurname）にそのまま使える
const SPEAKER_ROLE_RE = /^【(?:挨拶|講演)】(.+?)(総裁|副総裁|審議委員|理事)/;

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// html: boj.or.jp/about/calendar/index.htmの生HTML（UTF-8）
// ctx: { targetWeek: { targetWeekStart, ... } }（年の起点算出に使う）
// 戻り値: { ok: true, rows: [{ date, localTime, title, speakerLastName }] } または { ok: false, reason }
// rows は「【挨拶】【講演】形式かつ時刻確定」の行のみ（対象週フィルタは呼び出し側のcandidates.filterが行う）。
// 該当週に講演予定が無いこと自体は正常系（rows: []でok:true）。テーブル自体が見つからない・
// 行が1件も無い場合のみ構造変化とみなしok:falseを返す
function extractBojSpeeches(html, ctx) {
  const tbodyM = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (!tbodyM) {
    return { ok: false, reason: '<tbody>要素が見つからない。公表予定ページの構造変化の疑い' };
  }
  const targetWeekStart = ctx?.targetWeek?.targetWeekStart;
  if (!targetWeekStart) {
    return { ok: false, reason: 'targetWeek.targetWeekStart未指定（呼び出し側の不備）' };
  }
  let year = Number(targetWeekStart.slice(0, 4));
  let lastMonth = Number(targetWeekStart.slice(5, 7));
  let lastDay = 0;
  let currentDateText = null;
  let totalRowsSeen = 0;
  const rows = [];

  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(tbodyM[1]))) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(m[1]))) cells.push(stripTags(cm[1]));
    if (cells.length < 5) continue;
    totalRowsSeen += 1;
    const [dateCell, timeCell, , , titleCell] = cells;
    if (dateCell) currentDateText = dateCell;
    if (!currentDateText) continue;

    const dm = /(?:(\d{1,2})月)?(\d{1,2})日/.exec(currentDateText);
    if (!dm) continue;
    const dayNum = Number(dm[2]);
    let monthNum;
    if (dm[1]) {
      monthNum = Number(dm[1]);
      if (monthNum < lastMonth) year += 1;
    } else {
      // 月表記省略時: 日が前回より小さくなっていれば月が繰り上がったとみなす（上記コメント参照）。
      // 同一日内の複数行（dayNum===lastDay）は繰り上げない
      monthNum = lastMonth;
      if (dayNum < lastDay) {
        monthNum += 1;
        if (monthNum > 12) { monthNum = 1; year += 1; }
      }
    }
    lastMonth = monthNum;
    lastDay = dayNum;

    const speakerM = SPEAKER_ROLE_RE.exec(titleCell);
    if (!speakerM) continue;
    const timeM = /^(\d{1,2}):(\d{2})/.exec(timeCell);
    if (!timeM) continue; // 「未定」等（記者会見に多い）は時刻確定まで対象外

    rows.push({
      date: `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`,
      localTime: `${timeM[1].padStart(2, '0')}:${timeM[2]}`,
      title: titleCell,
      speakerLastName: speakerM[1].trim(),
    });
  }

  if (totalRowsSeen === 0) {
    return { ok: false, reason: '<tr>要素（データ行）が1件も見つからない。公表予定ページの構造変化の疑い' };
  }
  // 2026-10-26追加（しょうさん指摘、GPTの指摘の検証を経て）: 総裁定例記者会見の時刻は
  // 本編テーブル（上のrows）では常に「未定」のため時刻確定まで対象外になり、一度も抽出できない
  // （press_conferenceがこれまでjp_boj系ソースの実質的な恒常欠落だった真因）。見出し外の
  // 「総裁定例記者会見（予定）」セクションにのみ具体的な日時が明記されるため、別途抽出し
  // rowsへ合流させる（extractBojPressConferenceNotice参照）。見つからない場合は静かにスキップ
  // する（WARNはharness.mjsのrecurring_checks「総裁定例記者会見」[schedule_source_id:jp_boj、
  // schedule_kind:policy_rate]が、日銀の政策決定会合開催週なのに検出できなかった場合にのみ出す
  // 設計のため、ここ自体を構造的失敗にはしない＝将来的に本当に発表予定が無い時期[会合間の通常週]
  // でも誤ってWARN/ok:falseにならない）
  const pressConference = extractBojPressConferenceNotice(html);
  if (pressConference.found) {
    rows.push({
      date: pressConference.date,
      localTime: pressConference.localTime,
      title: '総裁定例記者会見（予定）',
      kind: 'press_conference',
      speakerLastName: null,
    });
  }
  return { ok: true, rows };
}

// 日本銀行「公表予定」ページの「総裁定例記者会見（予定）」セクション（本編テーブルの外、
// ページ末尾付近）の抽出。実データ構造（2026-10-26、curl直接取得で確認・UA偽装なし）:
//   <h2 id="p03">総裁定例記者会見（予定）</h2>
//   <p>2026年10月30日（金）15:30～（ライブ配信予定）<br>
//   （会見記録は2026年11月2日（月）にホームページ掲載予定）</p>
// 本編テーブルの記者会見行（【記者会見】植田総裁（M月D日分）等）とは異なり、この見出しには
// 年を含む完全な日付が明記される（本編テーブルの年ロールオーバー処理は不要）。
// 見出し自体が見つからない、または日時が1件も抽出できない場合は{found:false}を返す
// （構造的失敗ではなく「現時点で未発表」の通常状態として扱う。呼び出し側extractBojSpeeches参照）
function extractBojPressConferenceNotice(html) {
  // 2026-10-26実測で発覚: ページ冒頭の目次（<a href="#p03">総裁定例記者会見（予定）</a>）にも
  // 同じ文言が出現し、本文の<h2>より約7300文字前にあるため、素朴なindexOf()だと目次側に
  // マッチして日時を取得できない（実測ライブページで再現・修正済み）。<h2>タグに限定して
  // マッチすることで本文見出しのみを対象にする
  const headingM = /<h2[^>]*>総裁定例記者会見（予定）<\/h2>/.exec(html);
  if (!headingM) return { found: false };
  const after = html.slice(headingM.index + headingM[0].length, headingM.index + headingM[0].length + 500);
  const m = /(\d{4})年(\d{1,2})月(\d{1,2})日（[^）]*）\s*(\d{1,2}):(\d{2})/.exec(after);
  if (!m) return { found: false };
  const [, y, mo, d, h, mi] = m;
  return {
    found: true,
    date: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`,
    localTime: `${h.padStart(2, '0')}:${mi}`,
  };
}

module.exports = { extractBojSpeeches, extractBojPressConferenceNotice };
