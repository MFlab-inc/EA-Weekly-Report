'use strict';
// templates/design-mock_v1.2.html（デザイン契約）を再現するレンダラー。
// 再デザイン禁止のため、CSS・構造・data-ea-*属性はモックの実例文字列をそのまま転記し、
// 動的な値（日付・時刻・件数・イベント名等）のみを差し込む。

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countryPill(countryJa) {
  return `<span style="background:#1a3a2e;color:#ecfdf5;border-radius:4px;padding:1px 7px;font-size:10.5px;font-weight:700;">${esc(countryJa)}</span>`;
}
function currencyPill(currency) {
  return `<span style="background:#eaf5ef;color:#065f46;border:1px solid #cfe3d8;border-radius:4px;padding:0 6px;font-size:10px;font-weight:700;font-family:'Roboto Mono',Consolas,Menlo,monospace;margin-left:4px;">${esc(currency)}</span>`;
}

// 停止バー下の説明行の組み立て（design-mock_v1.2.htmlの実例から抽出した規則）:
// ・1日に発表枠(window)が1つだけ: ラベル群(▲時刻＋名称、複数は全角スペース区切り)の直後に<br>を挟み、
//   次の行に「停止開始目安」範囲＋注記を置く（例: 8/10・8/11・8/12）
// ・1日に発表枠が複数: 枠ごとに「ピル＋ラベル＋全角スペース＋範囲＋注記」を1行にまとめ、
//   枠と枠の間だけ<br>で区切る（例: 8/13・8/14）
function haltDayCard(day, reportPolicy) {
  const bars = day.halt.bars
    .map((b) => `<div style="position:absolute;top:2px;bottom:2px;left:${b.leftPct}%;width:${b.widthPct}%;background:linear-gradient(90deg,#f59e0b,#fbbf24);border-radius:6px;"></div>`)
    .join('');
  const triangles = day.halt.triangles
    .map((t) => `<div style="position:absolute;top:-8px;left:${t.leftPct}%;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid #1a3a2e;transform:translateX(-50%);"></div>`)
    .join('');

  const starLabel = day.halt.star3Count > 0 ? `★★★ ${day.halt.star3Count}件` : '';

  function labelHtmlOf(group) {
    return (group?.labelItems || [])
      .map((li) => `▲<span style="font-family:'Roboto Mono',Consolas,Menlo,monospace;font-weight:700;color:#065f46;">${esc(li.time)}</span>　${esc(li.text)}`)
      .join('　');
  }
  function annotationHtmlOf(w, group) {
    // 停止窓が丸ごと前日に収まるケース（task #47実バグ修正）: 範囲自体はrangeHtmlOfで
    // 「前日 ◯曜HH:MM–HH:MM」と明示済みのため、ここでは月曜（前日=日曜）の場合のみ
    // 「週明けの取引開始時点から」という実務上の注記を追加する（重複表記を避ける）
    if (w.entirelyPreviousDay) {
      if (w.isMondayWeekendCross) {
        return `<span style="font-size:11.5px;color:#5b6f66;">（${esc(reportPolicy.halt_monday_entirely_prevday_note)}）</span>`;
      }
      if (group?.bundleLastEventLabel) {
        const note = reportPolicy.halt_window_bundle_note.replace('{LAST_EVENT}', group.bundleLastEventLabel);
        return `<span style="font-size:11.5px;color:#5b6f66;">（${esc(note)}）</span>`;
      }
      return '';
    }
    if (w.crossesPreviousDay) {
      const note = w.isMondayWeekendCross
        ? reportPolicy.halt_monday_note.replace('{TIME}', w.rawPreviousDayStart)
        : reportPolicy.halt_prevday_note.replace('{WEEKDAY}', `${w.previousDayLabel}曜`).replace('{TIME}', w.rawPreviousDayStart);
      return `<span style="font-size:11.5px;color:#5b6f66;">（${esc(note)}）</span>`;
    }
    if (group?.bundleLastEventLabel) {
      const note = reportPolicy.halt_window_bundle_note.replace('{LAST_EVENT}', group.bundleLastEventLabel);
      return `<span style="font-size:11.5px;color:#5b6f66;">（${esc(note)}）</span>`;
    }
    return '';
  }
  function rangeHtmlOf(w) {
    // 停止窓が丸ごと前日に収まるケース（task #47実バグ修正、8/17週フルパイプライン実ネットワーク
    // 検証で発見）: 当日にクランプしたdisplayStart–displayEndをそのまま使うと「00:00–23:00」等の
    // 不自然な表示（実質24時間停止に見える）になる。前日の実時刻をそのまま明示する
    if (w.entirelyPreviousDay) {
      return `<span style="color:#b45309;font-weight:700;">停止開始目安 前日 ${esc(w.previousDayLabel)}曜<span style="font-family:'Roboto Mono',Consolas,Menlo,monospace;">${w.rawPreviousDayStart}–${w.rawPreviousDayEnd}</span></span>`;
    }
    return `<span style="color:#b45309;font-weight:700;">停止開始目安 <span style="font-family:'Roboto Mono',Consolas,Menlo,monospace;">${w.displayStart}–${w.displayEnd}</span></span>`;
  }

  const windowLines = day.halt.windows.map((w, wi) => {
    const group = day.windowGroups ? day.windowGroups[wi] : null;
    const pillHtml = `${countryPill(group?.countryJa || '')}${currencyPill(group?.currency || '')}`;
    const labelHtml = labelHtmlOf(group);
    const rangeHtml = rangeHtmlOf(w);
    const annotationHtml = annotationHtmlOf(w, group);
    if (day.halt.windows.length === 1) {
      return `${pillHtml}　${labelHtml}<br>${rangeHtml}${annotationHtml}`;
    }
    return `${pillHtml}　${labelHtml}　${rangeHtml}${annotationHtml}`;
  });
  const bodyHtml = windowLines.length > 0 ? windowLines.join('<br>') : esc(reportPolicy.halt_no_star3_note);
  // 翌日の発表枠のうち停止窓が丸ごとこの日に収まるもの（task #47実バグ修正）の帯をこの日の
  // バーに描画した場合、なぜこの日にも帯があるのかを読者が理解できるよう注記を追加する
  const borrowedNotesHtml = (day.halt.borrowedNotes || [])
    .map((n) => {
      const note = reportPolicy.halt_borrowed_bar_note
        .replace('{TIME}', n.time)
        .replace('{LABEL}', n.label)
        .replace('{START}', n.start)
        .replace('{END}', n.end);
      return `<div style="font-size:11px;color:#5b6f66;margin-top:4px;">（${esc(note)}）</div>`;
    })
    .join('');

  return `    <div class="ea-halt-day" data-ea-date="${day.date}" style="background:#ffffff;border:1px solid #dbe9e2;border-radius:14px;padding:13px 14px 11px;margin-bottom:10px;">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 10px;">
        <div style="font-size:15px;font-weight:800;color:#1a3a2e;">${day.md} <span style="font-size:12px;font-weight:700;color:#5b6f66;">${day.weekday}</span></div>
        <div style="font-size:11px;color:#047857;font-weight:700;">${starLabel}</div>
      </div>
      <div style="position:relative;height:16px;background:#e8f1ec;border-radius:8px;margin:14px 0 4px;">
        ${bars}${triangles}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#8aa097;font-family:'Roboto Mono',Consolas,Menlo,monospace;margin-bottom:8px;"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      <div style="font-size:12.5px;line-height:1.8;color:#2b3d35;">${bodyHtml}</div>${borrowedNotesHtml}
    </div>
`;
}

function eventCard3(ev, reportPolicy) {
  const prevForecast = ev.showPrevForecast && ev.prevForecastText
    ? `\n        <div style="font-size:12.5px;color:#43564d;margin-top:4px;">${ev.prevForecastText}</div>`
    : '';
  const comment = ev.comment ? `\n        <div style="font-size:12px;color:#6b8177;margin-top:${ev.showPrevForecast && ev.prevForecastText ? '3' : '4'}px;">${esc(ev.comment)}</div>` : '';
  const borderStyle = ev.isLastInGroup ? '' : 'border-bottom:1px dashed #e2ede7;';
  const timeHtml = ev.time
    ? `<span style="font-family:'Roboto Mono',Consolas,Menlo,monospace;font-size:15px;font-weight:800;color:#065f46;">${esc(ev.time)}</span>`
    : `<span style="font-size:11px;font-weight:700;color:#8aa097;">${esc(reportPolicy.no_time_note)}</span>`;
  return `      <div class="ea-event-card" data-ea-event-id="${esc(ev.id)}" data-ea-event-importance="3" style="padding:11px 14px;${borderStyle}">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
          ${timeHtml}
          ${countryPill(ev.countryJa)}
          <span style="font-size:14px;font-weight:700;color:#1f2d28;overflow-wrap:anywhere;">${esc(ev.displayName)}</span>
          <span style="font-size:12px;font-weight:800;color:#047857;">★★★</span>
        </div>${prevForecast}${comment}
      </div>
`;
}

function eventCard2(ev, reportPolicy) {
  const forecastPart = ev.showPrevForecast && ev.prevForecastText ? `　<span style="font-size:12px;color:#6b8177;">${esc(ev.prevForecastText)}</span>` : '';
  const timeHtml = ev.time
    ? `<span style="font-family:'Roboto Mono',Consolas,Menlo,monospace;font-weight:700;color:#3a6e56;">${esc(ev.time)}</span>　`
    : `<span style="font-weight:700;color:#8aa097;">${esc(reportPolicy.no_time_note)}</span>　`;
  return `      <div class="ea-event-card" data-ea-event-id="${esc(ev.id)}" data-ea-event-importance="2" style="padding:9px 14px;background:#fbfdfc;${ev.isLastInGroup ? '' : 'border-bottom:1px dashed #e2ede7;'}">
        <div style="font-size:12.5px;color:#43564d;overflow-wrap:anywhere;">${timeHtml}${esc(ev.countryJa)}・${esc(ev.displayName)} <span style="color:#8aa097;font-weight:700;">★★</span>${forecastPart}</div>
      </div>
`;
}

function dateGroup(day, reportPolicy) {
  const star3 = day.events.filter((e) => e.importance === 3).length;
  const star2 = day.events.filter((e) => e.importance === 2).length;
  const countLabel = [star3 ? `★★★ ${star3}件` : '', star2 ? `★★ ${star2}件` : ''].filter(Boolean).join('・');
  const sorted = [...day.events].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  const cardsHtml = sorted
    .map((ev, i) => ({ ...ev, isLastInGroup: i === sorted.length - 1 }))
    .map((ev) => (ev.importance === 3 ? eventCard3(ev, reportPolicy) : eventCard2(ev, reportPolicy)))
    .join('');
  const [, m, d] = day.date.split('-');
  return `    <div class="ea-date-group" data-ea-date="${day.date}" data-ea-date-event-count="${day.events.length}" style="background:#ffffff;border:1px solid #dbe9e2;border-radius:14px;overflow:hidden;margin-bottom:10px;">
      <div style="background:#eaf5ef;border-left:4px solid #059669;padding:8px 14px;display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px;">
        <span style="font-size:14px;font-weight:800;color:#1a3a2e;">${Number(m)}月${Number(d)}日（${day.weekday}）</span><span style="font-size:11px;color:#047857;font-weight:700;">${countLabel}</span>
      </div>
${cardsHtml}    </div>
`;
}

function btcCard(card) {
  if (card.no === 1 || card.no === 3 || card.no === 4) {
    return `    <div style="background:#ffffff;border:1px solid #dbe9e2;border-radius:14px;padding:13px 14px;margin-bottom:8px;">
      <div style="font-size:13.5px;font-weight:800;color:#1a3a2e;">${esc(card.title)}</div>
      <div style="font-size:12.5px;color:#33473e;margin-top:5px;line-height:1.75;">${esc(card.body)}</div>
    </div>
`;
  }
  // no:2 — 3項目×3段階バッジ縦積み
  const tierBadge = (label, colorBg, colorFg, text) =>
    `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;"><span style="background:${colorBg};color:${colorFg};border-radius:5px;padding:2px 0;font-size:10.5px;font-weight:700;min-width:62px;text-align:center;flex-shrink:0;">${label}</span><span style="font-size:12px;color:#33473e;line-height:1.65;">${esc(text)}</span></div>`;
  const itemsHtml = card.items
    .map((item, idx) => {
      const links = item.check_at
        .map((c) => (c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" style="color:#047857;font-weight:700;">${esc(c.name)}</a>` : esc(c.name)))
        .join(idx === 0 ? '　＋　' : '（代替：') // 簡易結合（primary＋代替の実文言はconfig順に依存）
        ;
      const marginTop = idx === 0 ? '' : 'margin-top:9px;';
      return `      <div style="font-size:12px;color:#33473e;${marginTop}line-height:1.8;">
        <span style="font-weight:700;color:#1a3a2e;">${esc(item.label)}</span><br>
        <span style="font-size:11.5px;color:#5b6f66;">確認先：${links}</span>
        <div style="margin-top:7px;">
          ${tierBadge('稼働停止', '#fde8c8', '#92400e', item.tiers.stop)}
          ${tierBadge('Lot 50%', '#fef3c7', '#a16207', item.tiers.half)}
          ${tierBadge('通常稼働', '#d1fae5', '#047857', item.tiers.normal)}
        </div>
      </div>
`;
    })
    .join('');
  return `    <div style="background:#ffffff;border:1px solid #dbe9e2;border-radius:14px;padding:13px 14px;margin-bottom:8px;">
      <div style="font-size:13.5px;font-weight:800;color:#1a3a2e;">${esc(card.title)}</div>
${itemsHtml}    </div>
`;
}

function renderReportHtml(reportData, { reportPolicy, btcGuide }) {
  const [sy, sm, sd] = reportData.targetWeekStart.split('-').map(Number);
  const [, em, ed] = reportData.targetWeekEnd.split('-').map(Number);
  const weekdayStart = reportData.days[0].weekday;
  const weekdayEnd = reportData.days[reportData.days.length - 1].weekday;

  const pillsHtml = reportData.heroPills
    .map((p) => `<span style="background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.28);border-radius:999px;padding:3px 12px;font-size:11.5px;font-weight:600;">${esc(p)}</span>`)
    .join('\n      ');

  const haltCardsHtml = reportData.days.map((d) => haltDayCard(d, reportPolicy)).join('');
  const dateGroupsHtml = reportData.days.map((d) => dateGroup(d, reportPolicy)).join('');
  const btcCardsHtml = btcGuide.cards.map((c) => btcCard(c)).join('');
  const riskCardsHtml = reportPolicy.risk_cards
    .map((c, i) => {
      const colors = ['#f59e0b', '#b45309', '#059669'];
      return `    <div style="background:#ffffff;border:1px solid #dbe9e2;border-radius:14px;padding:13px 14px;margin-bottom:8px;">
      <div style="font-size:13.5px;font-weight:800;color:#1a3a2e;"><span style="display:inline-block;width:9px;height:9px;background:${colors[i]};border-radius:3px;margin-right:7px;"></span>${esc(c.title)}</div>
      <div style="font-size:12.5px;color:#33473e;margin-top:5px;line-height:1.75;">${esc(c.body)}</div>
    </div>
`;
    })
    .join('');

  const section2Subtitle = reportPolicy.show_prev_forecast
    ? `日付別・時刻順。前回値・市場予想は${esc(reportPolicy.values_source_label)}`
    : `日付別・時刻順。${esc(reportPolicy.values_off_text)}`;

  return `<div data-ea-report-meta="${esc(reportData.reportMeta)}" data-ea-layout-version="${esc(reportPolicy.layout_version)}" data-ea-policy-mode="live" data-ea-target-start="${reportData.targetWeekStart}" data-ea-section-count="4" data-ea-reader-time-term="${esc(reportPolicy.reader_time_term)}" data-ea-halt-guidance="pre4to12h" style="max-width:680px;margin:0 auto;background:#f3f8f6;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP','Yu Gothic UI',Meiryo,sans-serif;color:#1f2d28;line-height:1.65;border-radius:16px;overflow:hidden;box-shadow:0 2px 18px rgba(26,58,46,0.10);">

  <!-- ▼ サイトヘッダー -->
  <div style="background:linear-gradient(135deg,#1a3a2e 0%,#2d5a45 55%,#3a6e56 100%);padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;">
    <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto;">
      <div style="width:36px;height:36px;background:linear-gradient(135deg,#6ee7b7,#34d399);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#1a3a2e;flex-shrink:0;box-shadow:0 2px 8px rgba(52,211,153,0.35);">EA</div>
      <div style="min-width:0;">
        <div style="font-size:13.5px;font-weight:700;color:#ffffff;letter-spacing:0.02em;line-height:1.35;overflow-wrap:anywhere;">EAユーザー向け週次レポート</div>
        <div style="font-size:8.5px;color:#a7f3d0;letter-spacing:0.12em;margin-top:2px;line-height:1.5;overflow-wrap:anywhere;">WEEKLY ECONOMIC CALENDAR<br>EA STOP GUIDE</div>
      </div>
    </div>
    <div style="text-align:right;flex:0 1 auto;">
      <div style="font-size:9px;color:#a7f3d0;letter-spacing:0.14em;font-weight:600;">WEEKLY REPORT</div>
      <div style="font-size:11px;color:#ecfdf5;margin-top:2px;">作成日：${esc(reportData.createdDateJa)}</div>
    </div>
  </div>

  <!-- ▼ ヒーロー -->
  <div style="background:linear-gradient(135deg,#047857 0%,#059669 55%,#10b981 100%);color:#ecfdf5;padding:24px 18px 26px;text-align:center;">
    <div style="font-size:10px;letter-spacing:0.22em;color:#d1fae5;font-weight:700;">対象週（日本時間）</div>
    <div style="font-size:21px;font-weight:800;color:#ffffff;margin-top:6px;letter-spacing:0.01em;line-height:1.4;">${sm}月${sd}日（${weekdayStart}）〜 ${em}月${ed}日（${weekdayEnd}）</div>
    <div style="font-size:12.5px;color:#ecfdf5;margin-top:8px;line-height:1.7;">${esc(reportData.heroSummary)}</div>
    <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:12px;">
      ${pillsHtml}
    </div>
    <div style="font-size:11px;color:#d1fae5;margin-top:12px;letter-spacing:0.04em;">最重要（★★★）${reportData.star3Total}件 ／ 発表枠 ${reportData.releaseWindowCount} ／ 対象 ${reportData.dayCount}日</div>
  </div>

  <!-- ▼ セクション1: EA停止スケジュール -->
  <div style="padding:4px 14px 6px;">
    <div class="ea-section-band" style="width:fit-content;margin:26px auto 6px;background:#1a3a2e;color:#ecfdf5;font-size:13px;letter-spacing:0.12em;font-weight:700;padding:7px 20px;border-radius:999px;text-align:center;">${esc(reportPolicy.section_headings[0])}</div>
    <div style="text-align:center;font-size:11.5px;color:#5b6f66;margin-bottom:12px;">${esc(reportPolicy.halt_section_sub)}</div>

    <div style="background:#ffffff;border:1px solid #dbe9e2;border-radius:12px;padding:9px 12px;margin-bottom:12px;font-size:11.5px;color:#43564d;line-height:1.7;">
      バーは各日の<span style="font-family:'Roboto Mono',Consolas,Menlo,monospace;font-weight:700;">0時〜24時</span>を表します。<span style="display:inline-block;width:26px;height:9px;background:linear-gradient(90deg,#f59e0b,#fbbf24);border-radius:4px;vertical-align:-1px;"></span> ＝停止開始の目安時間帯、<span style="color:#1a3a2e;font-weight:800;">▲</span>＝発表予定時刻。複数枠がある日は帯を連結表示しています。
    </div>

${haltCardsHtml}
    <div style="background:#eaf5ef;border-radius:12px;padding:10px 14px;font-size:11.5px;color:#33473e;line-height:1.75;">
      ${esc(reportPolicy.resume_and_disclaimer_card)}
    </div>
  </div>

  <!-- ▼ セクション2: 対象週の注目イベント -->
  <div style="padding:0 14px 6px;">
    <div class="ea-section-band" style="width:fit-content;margin:28px auto 6px;background:#1a3a2e;color:#ecfdf5;font-size:13px;letter-spacing:0.12em;font-weight:700;padding:7px 20px;border-radius:999px;text-align:center;">${esc(reportPolicy.section_headings[1])}</div>
    <div style="text-align:center;font-size:11.5px;color:#5b6f66;margin-bottom:12px;">${section2Subtitle}</div>

${dateGroupsHtml}    <div style="text-align:center;font-size:11px;color:#8aa097;margin:4px 0 2px;">★★★＝最重要（中央銀行・主要物価/雇用統計等）　★★＝重要</div>
  </div>

  <!-- ▼ セクション3: EAリスク管理ポイント -->
  <div style="padding:0 14px 6px;">
    <div class="ea-section-band" style="width:fit-content;margin:28px auto 6px;background:#1a3a2e;color:#ecfdf5;font-size:13px;letter-spacing:0.12em;font-weight:700;padding:7px 20px;border-radius:999px;text-align:center;">${esc(reportPolicy.section_headings[2])}</div>
    <div style="text-align:center;font-size:11.5px;color:#5b6f66;margin-bottom:12px;">イベント前後の執行管理に限定した確認事項</div>

${riskCardsHtml}  </div>

  <!-- ▼ セクション4: 土日のBTC/USDガイド -->
  <div style="padding:0 14px 10px;">
    <div class="ea-section-band" style="width:fit-content;margin:28px auto 6px;background:#1a3a2e;color:#ecfdf5;font-size:13px;letter-spacing:0.12em;font-weight:700;padding:7px 20px;border-radius:999px;text-align:center;">${esc(reportPolicy.section_headings[3])}</div>
    <div style="text-align:center;font-size:11.5px;color:#5b6f66;margin-bottom:12px;">週末も24時間取引が続くBTC/USDの停止・Lot抑制・再開判断</div>

${btcCardsHtml}  </div>

  <!-- ▼ フッター -->
  <div style="background:#1a3a2e;color:#cfe8db;padding:20px 16px 22px;text-align:center;">
    <div style="font-size:12px;font-weight:800;color:#ecfdf5;letter-spacing:0.04em;">EAユーザー向け週次レポート</div>
    <div style="font-size:10.5px;color:#a9c9bb;margin-top:5px;">作成日：${esc(reportData.createdDateJa)}｜対象期間：${sm}月${sd}日（${weekdayStart}）〜 ${em}月${ed}日（${weekdayEnd}）</div>
    <div style="font-size:10.5px;color:#a9c9bb;margin-top:12px;line-height:1.8;text-align:left;max-width:560px;margin-left:auto;margin-right:auto;">
      ${esc(reportPolicy.footer_disclaimer)}<br><br>
      ${esc(reportPolicy.footer_source_statement)}
    </div>
  </div>
</div>
`;
}

module.exports = { renderReportHtml, countryPill, currencyPill };
