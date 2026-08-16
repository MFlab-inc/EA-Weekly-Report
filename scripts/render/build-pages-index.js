'use strict';
// GitHub Pagesプレビュー用のindex.html生成（task #42、しょうさん指示「プレビューページ」の
// 最小実装、2026-08-17）。output/ea-weekly-YYYYMMDD.htmlの一覧から、新しい週が先頭に来る
// リンク一覧を作る。デザインは既存レンダラーのカラー（#1a3a2e等、templates/design-mock_v1.2.html
// 準拠）に軽く合わせるが、本体レポートの再現ではないため独自の簡易マークアップとする。

// fileNames: ['ea-weekly-20260803.html', 'ea-weekly-20260810.html', ...]（拡張子・接頭辞のみ想定、
// パスは含まない前提。存在確認・ファイル一覧の取得は呼び出し側=CLIの責務とする）
function parseWeekFromFileName(fileName) {
  const m = fileName.match(/^ea-weekly-(\d{4})(\d{2})(\d{2})\.html$/);
  if (!m) return null;
  return { fileName, ymd: `${m[1]}-${m[2]}-${m[3]}`, sortKey: `${m[1]}${m[2]}${m[3]}` };
}

// 新しい週が先頭（降順）。パース不能なファイル名は無視する
function sortedWeeks(fileNames) {
  return fileNames
    .map(parseWeekFromFileName)
    .filter(Boolean)
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildIndexHtml(fileNames, { generatedAt } = {}) {
  const weeks = sortedWeeks(fileNames);
  const latest = weeks[0];
  const rows = weeks
    .map(
      (w, i) =>
        `        <li><a href="./output/${esc(w.fileName)}">${esc(w.ymd)}週${i === 0 ? '<span class="latest">最新</span>' : ''}</a></li>`
    )
    .join('\n');
  const body = weeks.length
    ? `      <ul class="week-list">\n${rows}\n      </ul>`
    : '      <p class="empty">まだレポートがありません。</p>';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EA週次レポート プレビュー</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f8f6; color: #1a3a2e; margin: 0; padding: 24px 16px; }
  main { max-width: 480px; margin: 0 auto; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { font-size: 12px; color: #5b6f66; margin-bottom: 20px; }
  .week-list { list-style: none; padding: 0; margin: 0; }
  .week-list li { margin-bottom: 8px; }
  .week-list a { display: block; padding: 12px 14px; background: #ffffff; border: 1px solid #dbe9e2; border-radius: 10px; color: #1a3a2e; text-decoration: none; font-weight: 700; font-size: 14px; }
  .week-list a:hover { border-color: #1a3a2e; }
  .latest { display: inline-block; margin-left: 8px; background: #1a3a2e; color: #ecfdf5; border-radius: 4px; padding: 1px 7px; font-size: 10.5px; font-weight: 700; vertical-align: middle; }
  .empty { color: #5b6f66; font-size: 13px; }
  ${latest ? '' : ''}
</style>
</head>
<body>
<main>
  <h1>EA週次レポート プレビュー</h1>
  <div class="sub">並行運用の確認用ページ。しょうさんの手元・共有用${generatedAt ? `（生成: ${esc(generatedAt)}）` : ''}</div>
${body}
</main>
</body>
</html>
`;
}

module.exports = { parseWeekFromFileName, sortedWeeks, buildIndexHtml };
