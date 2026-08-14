#!/usr/bin/env node
// 対象週データからWordPress貼り付け用HTML断片を生成するCLI。
// node scripts/render/generate.mjs <week-data-module> <output-path>
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { buildReportData } = require('./build-report-data.js');
const { renderReportHtml } = require('./html-renderer.js');

const weekDataPath = process.argv[2];
const outputPath = process.argv[3];
if (!weekDataPath || !outputPath) {
  console.error('usage: node scripts/render/generate.mjs <week-data-module> <output-path>');
  process.exit(1);
}

const weekInput = require(resolve(weekDataPath));
const reportPolicy = require('../../config/report-policy.json');
const btcGuide = require('../../config/btc-weekend-guide.json');

const reportData = buildReportData(weekInput);
const html = renderReportHtml(reportData, { reportPolicy, btcGuide });

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html);
console.log(`generated: ${outputPath} (${html.length} bytes)`);
