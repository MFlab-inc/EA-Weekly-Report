#!/usr/bin/env node
// モバイル多幅レイアウト検証（task #13、しょうさん指示2026-08-15「4. モバイル多幅レイアウト検証
// （320/360/375/390/414px・横スクロール発生ゼロ）— Playwrightが必要」）。
// 旧reference/ea-weekly-report-skill/scripts/validate_mobile_header.pyをPythonのまま移植する案から
// 変更し、Node.js版のplaywrightパッケージで実装した（この環境・GitHub Actionsランナーとも
// Playwrightブラウザのキャッシュ運用がNode向けnpm postinstallを前提に構成されているため、
// 検証パイプライン全体をNode一本に統一できる。Python環境の追加セットアップが不要になる分、
// CI構成も単純化できる。しょうさんの元の想定[Python+requirements.txt]から変更した点として明記する）。
// 検証観点はHANDOFF.md検収基準3「モバイル幅320/360/375/390/414pxで横スクロールが発生しない」。
import { chromium } from 'playwright';
import { argv, exit } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WIDTHS = [320, 360, 375, 390, 414];
// この開発コンテナはPLAYWRIGHT_BROWSERS_PATH配下に固定バージョンのChromiumを同梱しており、
// npm installしたplaywrightパッケージのバージョンとブラウザリビジョンが噛み合わないことがある
// （実測2026-08-15）。/opt/pw-browsers/chromium はバージョン非依存のシンボリックリンクのため
// 存在すればこれを使う。存在しない環境（GitHub Actions等、`npx playwright install chromium`後）では
// undefinedのままplaywright自身のデフォルト解決に任せる
const SANDBOX_CHROMIUM_PATH = '/opt/pw-browsers/chromium';
const DEFAULT_CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined);

// 1幅ぶんの検査。pageは呼び出し側が該当ビューポートで開いた状態で渡す
export async function checkWidth(page, width) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const noHorizontalScroll = scrollWidth <= clientWidth + 1; // 1pxの丸め誤差を許容
  return { width, scrollWidth, clientWidth, noHorizontalScroll };
}

// htmlPath（ローカルファイル）を対象にWIDTHS全幅を検査する。ネットワークアクセスは行わない
// （file://の読み込みのみ。しょうさん指示「Playwrightはローカル生成HTMLの検査のみ」に対応）
export async function checkMobileLayout(htmlPath, { chromiumPath = DEFAULT_CHROMIUM_PATH } = {}) {
  const url = pathToFileURL(resolve(htmlPath)).toString();
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--no-sandbox'] });
  try {
    const results = [];
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      results.push(await checkWidth(page, width));
      await page.close();
    }
    return results;
  } finally {
    await browser.close();
  }
}

export function summarizeResults(results) {
  const errors = results
    .filter((r) => !r.noHorizontalScroll)
    .map((r) => `HORIZONTAL_SCROLL: 幅${r.width}pxで横スクロールが発生しています（scrollWidth=${r.scrollWidth} > clientWidth=${r.clientWidth}）`);
  return errors;
}

async function main() {
  const htmlPath = argv[2];
  if (!htmlPath) {
    console.error('使い方: node mobile-layout-check.mjs <html> [--chromium <path>]');
    exit(2);
  }
  const chromiumIdx = argv.indexOf('--chromium');
  const chromiumPath = chromiumIdx >= 0 ? argv[chromiumIdx + 1] : DEFAULT_CHROMIUM_PATH;
  const results = await checkMobileLayout(htmlPath, { chromiumPath });
  const errors = summarizeResults(results);
  for (const r of results) console.log(`  幅${r.width}px: scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth} ${r.noHorizontalScroll ? 'OK' : 'NG'}`);
  for (const e of errors) console.log(`ERROR [HORIZONTAL_SCROLL] ${e}`);
  const status = errors.length ? '配信保留' : '配信可';
  console.log(`判定: ${status}`);
  console.log(`ERROR: ${errors.length} / WARNING: 0`);
  exit(errors.length ? 2 : 0);
}

if (import.meta.url === `file://${argv[1]}`) {
  main();
}
