#!/usr/bin/env node
// GitHub Pagesへデプロイするstaging directory（既定: pages-dist/）を組み立てるCLI（task #42）。
// output/配下のea-weekly-*.htmlをコピーし、一覧ページ（index.html、
// scripts/render/build-pages-index.js）を生成する。configやscripts等の内部ファイルは含めない
// （公開してよいのは配信済みレポートのみ）。
import { readdirSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildIndexHtml } = require('./build-pages-index.js');

const OUTPUT_DIR = process.argv[2] || 'output';
const DIST_DIR = process.argv[3] || 'pages-dist';

function main() {
  const fileNames = existsSync(OUTPUT_DIR) ? readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.html')) : [];
  mkdirSync(join(DIST_DIR, 'output'), { recursive: true });
  for (const f of fileNames) {
    copyFileSync(join(OUTPUT_DIR, f), join(DIST_DIR, 'output', f));
  }
  const indexHtml = buildIndexHtml(fileNames, { generatedAt: new Date().toISOString() });
  writeFileSync(join(DIST_DIR, 'index.html'), indexHtml);
  console.log(`pages-dist生成完了: ${fileNames.length}件のレポートを${DIST_DIR}/へ配置`);
}

main();
