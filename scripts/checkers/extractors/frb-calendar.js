'use strict';
// FRB（連邦準備制度理事会）の事前公表カレンダーページの抽出ルール
// （config/official-sources.json us_frb_calendar、newsevents/{year}-{month-name}.htm）。
// task #94フォローアップ（2026-09-19、しょうさん指摘: 既存us_frb_speeches[feeds/speeches.xml]は
// 講演実施後に原稿が掲載された時点で初めて追加される設計のため、講演前の事前検出ができない
// 構造的限界がある。実例: ジェファーソンFRB副議長の2026-09-22講演は本カレンダーページには
// 数日前から掲載されていたが、us_frb_speechesのRSSには講演当日まで一切現れなかった）。
// ライブ実測（2026-09-19、GitHub Actions相当の実ネットワーク経由）: このページはカレンダー
// グリッドではなく「カテゴリ別セクション（Speeches/FOMC Meetings/Beige Book/Statistical
// Releases/Other等、その月に該当イベントがあるものだけ表示）」構成の静的HTML（JS描画不要、
// <div id="article" class='cal-nojs clearfix'>）。各イベントは
// <div class="col-xs-2"><p>{時刻}</p></div><div class="col-xs-7"><p>{種別} - {話者等}</p>
// ...</div><div class="col-xs-3"><p>{日}</p></div>という3列構造の行を持つ（カテゴリの
// ヘッダー行は<div class="col-xs-2"><h6>Time:</h6></div>のようにp要素を持たないため
// 誤マッチしない）。日付欄は統計指標系の行ではカンマ区切りの複数日（例:「3, 10, 17, 24」）に
// なり得るが、Speech行は実測で常に単一の1〜2桁の日のため、"Speech - "で始まる行のみを
// 対象とする本抽出では問題にならない（日フィールドが単一の数字でない行は念のため除外する）。
// 時刻は"H:MM a.m./p.m."形式（小文字ドット付き）で統一されているが、統計指標・祝日行では
// 空欄のこともある（Speech行は実測5件全てで非空）。話者名は"Speech - {役職タイトル}
// {ファーストネーム} {ミドルイニシャル}. {ラストネーム}"という書式（実測例: "Speech - Vice
// Chair Philip N. Jefferson"、"Speech - Vice Chair for Supervision Michelle W. Bowman"、
// "Speech - Governor Michael S. Barr"）のため、role_ja方式の照合（naming.resolveOfficialBySurname、
// officials.jsonのfull_name部分一致）に使えるよう、役職タイトルとミドルイニシャルを取り除いた
// 「ファーストネーム ラストネーム」の形へ正規化してから返す（officials.jsonのfull_nameは
// ミドルイニシャルを含まない表記のため、正規化しないと部分一致に失敗する）。

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// "10:20 a.m."/"2:00 p.m." -> "10:20"/"14:00"
function parseFrbCalendarTime(raw) {
  const m = /^(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const isPm = /p\.m\./i.test(m[3]);
  if (isPm && h !== 12) h += 12;
  if (!isPm && h === 12) h = 0;
  return `${pad2(h)}:${m[2]}`;
}

// "Vice Chair Philip N. Jefferson" -> "Philip Jefferson"（役職タイトル・ミドルイニシャルを除去。
// officials.jsonのfull_nameがミドルイニシャル無し表記のため、除去しないと部分一致に失敗する）
function normalizeFrbSpeakerName(raw) {
  let s = raw.trim();
  s = s.replace(/^(Chair|Vice Chair for Supervision|Vice Chair|Governor|President)\s+/i, '');
  s = s.replace(/\s+[A-Z]\.(?=\s|$)/g, '');
  return s.trim().replace(/\s+/g, ' ');
}

const ROW_RE = /<div class="col-xs-2">\s*<p>([^<]*)<\/p>\s*<\/div>\s*<div class="col-xs-7">\s*<p>([^<]*)<\/p>([\s\S]*?)<\/div>\s*<div class="col-xs-3">\s*<p>([^<]*)<\/p>/g;

// html: newsevents/{year}-{month}.htmの生テキスト
// 戻り値: { ok: true, items: [{ date, localTime, speakerLastName, title }] } または { ok: false, reason }
// 注意: itemsが空配列（=当該月にSpeechカテゴリの行が無い）はok:trueで正常返却する。
// FRBの月別カテゴリ表示は該当イベントが無いカテゴリごと表示されない仕様（実測確認済み）のため、
// 「その月に講演予定が無い」ことは構造的失敗ではなく正当にあり得る結果である
// （FOMCブラックアウト期間・単に講演の少ない月等）。構造変化の疑いとして扱うのは、
// col-xs-2/col-xs-7/col-xs-3の3列構造の行自体が（Speech以外のカテゴリも含め）1件も
// 見つからない場合のみとする（totalRowsで判定）
function extractFrbCalendar(html) {
  const monthM = /<h4[^>]*>\s*([A-Za-z]+)\s+(\d{4})\s*<\/h4>/.exec(html);
  if (!monthM) {
    return { ok: false, reason: 'ページの月見出し（<h4>{月名} {年}</h4>）が見つからない。サイト構造変化の疑い' };
  }
  const monthNum = MONTHS[monthM[1].toLowerCase()];
  const year = monthM[2];
  if (!monthNum) {
    return { ok: false, reason: `月名「${monthM[1]}」を認識できない` };
  }
  const items = [];
  let totalRows = 0;
  let m;
  while ((m = ROW_RE.exec(html))) {
    totalRows += 1;
    const typeLine = m[2].trim();
    const speechM = /^Speech\s*-\s*(.+)$/.exec(typeLine);
    if (!speechM) continue;
    const localTime = parseFrbCalendarTime(m[1]);
    if (!localTime) continue;
    const dayRaw = m[4].trim();
    if (!/^\d{1,2}$/.test(dayRaw)) continue;
    const day = Number(dayRaw);
    items.push({
      date: `${year}-${pad2(monthNum)}-${pad2(day)}`,
      localTime,
      speakerLastName: normalizeFrbSpeakerName(speechM[1]),
      title: typeLine,
    });
  }
  if (totalRows === 0) {
    return { ok: false, reason: 'イベント行（col-xs-2/col-xs-7/col-xs-3の3列構造）が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, items };
}

module.exports = { extractFrbCalendar, parseFrbCalendarTime, normalizeFrbSpeakerName };
