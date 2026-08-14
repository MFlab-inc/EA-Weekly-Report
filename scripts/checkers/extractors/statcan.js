'use strict';
// カナダ統計局（Statistics Canada）年次発表日程PDFの抽出（task #15）。
// config/official-sources.jsonのca_statcanはannual_schedule_config型のため、本抽出は
// 週次本番パイプラインでは実行されない（config.scheduleへの一回限りの投入・将来の
// 残量監視WARN時の再投入用）。PDFのテキスト抽出はpdf-parseで行い（呼び出し側の責務）、
// このモジュールは抽出済みテキストを受け取る純粋関数として実装する。
//
// PDFのテキスト（pdf-parseの表形式抽出結果、セル間に空白を挿入しない連結出力）は
// 対象subject（例: "Labour Force Survey"）の見出し行の後に
// "{月} {日}, {年}{月} {年}"（発表日と対象期間が空白なしで連結）という行が連続する構造になる。
// 途中でページまたぎにより"Release date"/"Reference period"の見出し行が再度挟まることがある。

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

const SUBJECT_HEADERS = {
  trade_balance: 'Canadian international merchandise trade',
  employment_situation: 'Labour Force Survey',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseLongDate(s) {
  const m = /^(\w+) (\d{1,2}), (\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  return `${m[3]}-${pad2(month)}-${pad2(Number(m[2]))}`;
}

function parseMonthYear(s) {
  const m = /^(\w+) (\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  return `${m[2]}-${pad2(month)}`;
}

// 単一subjectの見出し行から、次のsubject見出しが現れるまでの
// "発表日{対象期間}"連結行を{releaseDate, referencePeriod}の配列として抽出する
function extractSubjectSchedule(text, subjectHeader) {
  const lines = text.split('\n').map((l) => l.trim());
  const startIdx = lines.findIndex((l) => l === subjectHeader);
  if (startIdx === -1) return [];
  const pairRe = /^([A-Z][a-z]+ \d{1,2}, \d{4})([A-Z][a-z]+ \d{4})$/;
  const entries = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || line === 'Release date' || line === 'Reference period') continue;
    const m = pairRe.exec(line);
    if (m) {
      const releaseDate = parseLongDate(m[1]);
      const referencePeriod = parseMonthYear(m[2]);
      if (releaseDate && referencePeriod) entries.push({ releaseDate, referencePeriod });
      continue;
    }
    break; // 次のsubject見出しに到達
  }
  return entries;
}

// text: pdf-parseで抽出したPDF全文テキスト。
// 戻り値: { trade_balance: [{releaseDate, referencePeriod}], employment_situation: [...] }
function extractStatCanSchedule(text) {
  const result = {};
  for (const [kind, header] of Object.entries(SUBJECT_HEADERS)) {
    result[kind] = extractSubjectSchedule(text, header);
  }
  return result;
}

module.exports = { extractStatCanSchedule, SUBJECT_HEADERS, parseLongDate, parseMonthYear };
