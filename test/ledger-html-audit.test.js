'use strict';
// scripts/check/ledger-html-audit.mjs のユニットテスト（task #13）。
// しょうさん指示の必須テスト（意図的に壊したデータでHOLDになることの実証）のうち、
// 台帳×HTML突合に関する項目をここでカバーする:
//   - 台帳から1件抜く（HTML側に台帳未登録イベントが残る）
//   - HTMLに台帳外イベントを混ぜる
//   - 対象週と違う日付を混ぜる
const { test } = require('node:test');
const assert = require('node:assert/strict');

async function loadAudit() {
  return import('../scripts/check/ledger-html-audit.mjs');
}

function baseLedger() {
  return {
    meta: { target_week_start: '2026-08-17', target_week_end: '2026-08-21' },
    events: [
      { event_id: 'au-rba-rate-2026-08-18', date_jst: '2026-08-18', importance: 3 },
      { event_id: 'us-jolts-2026-08-19', date_jst: '2026-08-19', importance: 2 },
      { event_id: 'us-cpi-2026-08-19', date_jst: '2026-08-19', importance: 3 },
    ],
  };
}

function baseHtml() {
  return `<div data-ea-report-meta="ea-weekly-20260817" data-ea-layout-version="ea-only-v4" data-ea-target-start="2026-08-17" data-ea-section-count="4" data-ea-reader-time-term="日本時間" data-ea-halt-guidance="pre4to12h">
  <div>対象週（日本時間） 8月17日（月）〜 8月21日（金）</div>
  <div class="ea-date-group" data-ea-date="2026-08-18" data-ea-date-event-count="1">
    <div>8月18日（火）</div>
    <div class="ea-event-card" data-ea-event-id="au-rba-rate-2026-08-18" data-ea-event-importance="3">RBA政策金利＆声明発表</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-19" data-ea-date-event-count="2">
    <div>8月19日（水）</div>
    <div class="ea-event-card" data-ea-event-id="us-jolts-2026-08-19" data-ea-event-importance="2">JOLTS求人件数</div>
    <div class="ea-event-card" data-ea-event-id="us-cpi-2026-08-19" data-ea-event-importance="3">消費者物価指数（CPI）</div>
  </div>
</div>`;
}

test('auditLedgerHtml: 妥当な組み合わせはエラー無し', async () => {
  const { auditLedgerHtml } = await loadAudit();
  assert.deepEqual(auditLedgerHtml(baseHtml(), baseLedger()), []);
});

test('auditRootMeta: layout-versionが違うとエラー', async () => {
  const { auditRootMeta } = await loadAudit();
  const html = baseHtml().replace('ea-only-v4', 'ea-only-v3');
  const errors = auditRootMeta(html, baseLedger());
  assert.ok(errors.some((e) => e.includes('LAYOUT_VERSION_MISMATCH')));
});

test('必須ケース: 台帳から1件抜く（台帳に無いイベントがHTMLに残る）→ HTML_EVENT_UNKNOWNでHOLD', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const ledger = baseLedger();
  ledger.events = ledger.events.filter((e) => e.event_id !== 'us-jolts-2026-08-19');
  const errors = auditLedgerHtml(baseHtml(), ledger);
  assert.ok(errors.some((e) => e.startsWith('HTML_EVENT_UNKNOWN')), JSON.stringify(errors));
});

test('必須ケース: HTMLに台帳外イベントを混ぜる → HTML_EVENT_UNKNOWNでHOLD', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const html = baseHtml().replace(
    '</div>\n</div>',
    '  <div class="ea-event-card" data-ea-event-id="ghost-event-2026-08-19" data-ea-event-importance="3">存在しないイベント</div>\n  </div>\n</div>'
  );
  const errors = auditLedgerHtml(html, baseLedger());
  assert.ok(errors.some((e) => e.includes('ghost-event-2026-08-19')), JSON.stringify(errors));
});

test('台帳にあるイベントがHTMLから欠落 → HTML_EVENT_MISSINGでHOLD', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const html = baseHtml().replace('<div class="ea-event-card" data-ea-event-id="us-cpi-2026-08-19" data-ea-event-importance="3">消費者物価指数（CPI）</div>', '');
  const errors = auditLedgerHtml(html, baseLedger());
  assert.ok(errors.some((e) => e.startsWith('HTML_EVENT_MISSING') && e.includes('us-cpi-2026-08-19')), JSON.stringify(errors));
});

test('重要度の不一致 → EVENT_IMPORTANCE_MISMATCH', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const html = baseHtml().replace('data-ea-event-id="us-cpi-2026-08-19" data-ea-event-importance="3"', 'data-ea-event-id="us-cpi-2026-08-19" data-ea-event-importance="2"');
  const errors = auditLedgerHtml(html, baseLedger());
  assert.ok(errors.some((e) => e.startsWith('EVENT_IMPORTANCE_MISMATCH')), JSON.stringify(errors));
});

test('必須ケース: 対象週と違う日付を混ぜる → DATE_OUT_OF_TARGET_WEEK', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const html = baseHtml() + '\n<div>9月1日（火）にも重要イベントがあります</div>';
  const errors = auditLedgerHtml(html, baseLedger());
  assert.ok(errors.some((e) => e.startsWith('DATE_OUT_OF_TARGET_WEEK')), JSON.stringify(errors));
});

test('曜日の不一致 → WEEKDAY_MISMATCH', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const html = baseHtml().replace('8月18日（火）', '8月18日（水）');
  const errors = auditLedgerHtml(html, baseLedger());
  assert.ok(errors.some((e) => e.startsWith('WEEKDAY_MISMATCH')), JSON.stringify(errors));
});

test('日付グループの件数属性が実カード数と不一致 → DATE_GROUP_COUNT_MISMATCH', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const html = baseHtml().replace('data-ea-date="2026-08-19" data-ea-date-event-count="2"', 'data-ea-date="2026-08-19" data-ea-date-event-count="5"');
  const errors = auditLedgerHtml(html, baseLedger());
  assert.ok(errors.some((e) => e.startsWith('DATE_GROUP_COUNT_MISMATCH')), JSON.stringify(errors));
});

test('日付グループが台帳外の日程 → DATE_GROUP_UNEXPECTED', async () => {
  const { auditLedgerHtml } = await loadAudit();
  const html = baseHtml().replace('data-ea-date="2026-08-18"', 'data-ea-date="2026-08-20"');
  const errors = auditLedgerHtml(html, baseLedger());
  assert.ok(errors.some((e) => e.includes('2026-08-20')), JSON.stringify(errors));
});
