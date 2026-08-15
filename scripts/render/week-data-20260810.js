'use strict';
// 2026-08-10週の入力データ。templates/design-mock_v1.2.htmlの実例値をそのまま転記した
// （このモジュール自体がそのままデザイン契約の回帰テスト用データになる。test/renderer.test.js専用）。
//
// 【役割変更（2026-08-15、しょうさん指示によるcollect→build-ledger→render実データ接続後）】
// 本ファイルはもはや「本番レンダラーの入力」ではない（scripts/render/week-data-20260803.jsの
// ファイル先頭コメント参照）。加えて2026-08-15の実データ経路regressionテスト
// （test/regen-sample-weeks.test.js）で判明した点として、本ファイルはdesign-mock_v1.2.html
// （デザイン契約のサンプル値）をそのまま転記したものであり、scripts/phase0/expected-events.json
// （実測ground truth・29イベント）とは完全には一致しない（例: 中古住宅販売件数[us-ehs]・
// 製造業生産高[gb-manuf]・ミシガン大学消費者信頼感指数[us-umich]はデザイン契約のサンプル値であり、
// 既刊の実配信物には含まれない）。よってoutput/ea-weekly-20260810.html（本ファイルから生成・
// コミット済み）を「既刊の完全な再現」の基準として扱わないこと。既刊の実データ突合は
// test/regen-sample-weeks.test.jsが別途行っている
// show_prev_forecast=false（恒久確定）のため、prevForecastTextは保持するが
// レンダラー側では出力しない（config/report-policy.jsonのshow_prev_forecast参照）。
module.exports = {
  reportMeta: 'ea-weekly-20260810',
  createdDateJa: '2026年8月8日（土）',
  targetWeekStart: '2026-08-10',
  targetWeekEnd: '2026-08-14',
  heroSummary: 'RBA政策判断、米CPI・PPI、英国GDP、米小売売上高を確認する週',
  heroPills: ['RBA政策金利 8/11', '米CPI 8/12', '米小売売上高 8/14'],
  days: [
    {
      date: '2026-08-10', md: '8/10', weekday: '月',
      events: [
        { id: 'jp-boj-summary-2026-08-10', time: '08:50', importance: 3, countryJa: '日本', currency: 'JPY', displayName: '日銀 金融政策決定会合における主な意見（7月30・31日開催分）', comment: '日銀の政策判断や委員の議論を確認します。' },
      ],
      windowGroups: [
        { firstTime: '08:50', lastTime: '08:50', countryJa: '日本', currency: 'JPY', labelItems: [{ time: '08:50', text: '日銀 金融政策決定会合における主な意見' }] },
      ],
    },
    {
      date: '2026-08-11', md: '8/11', weekday: '火',
      events: [
        { id: 'au-rba-rate-2026-08-11', time: '13:30', importance: 3, countryJa: '豪州', currency: 'AUD', displayName: 'RBA政策金利＆声明発表', prevForecastText: '前回 4.35% 据え置き　予想 4.35% 据え置き', comment: '声明の文言変化に注目します。' },
        { id: 'au-rba-somp-2026-08-11', time: '13:30', importance: 3, countryJa: '豪州', currency: 'AUD', displayName: 'RBA四半期金融政策報告', comment: 'インフレ・成長見通しの修正内容を確認します。' },
        { id: 'au-rba-presser-2026-08-11', time: '14:30', importance: 3, countryJa: '豪州', currency: 'AUD', displayName: 'ブロックRBA総裁の記者会見', comment: '今後の利下げ・利上げ方針について発言内容を確認します。' },
        { id: 'us-ehs-2026-08-11', time: '23:00', importance: 2, countryJa: '米国', currency: 'USD', displayName: '中古住宅販売件数', prevForecastText: '前回409万件・予想406万件' },
      ],
      windowGroups: [
        { firstTime: '13:30', lastTime: '14:30', countryJa: '豪州', currency: 'AUD', labelItems: [{ time: '13:30', text: 'RBA政策金利＆声明・四半期金融政策報告' }, { time: '14:30', text: '総裁記者会見' }], bundleLastEventLabel: '記者会見' },
      ],
    },
    {
      date: '2026-08-12', md: '8/12', weekday: '水',
      events: [
        { id: 'us-cpi-2026-08-12', time: '21:30', importance: 3, countryJa: '米国', currency: 'USD', displayName: '消費者物価指数（CPI）', prevForecastText: '前回 -0.4% / +3.5%　予想 +0.1% / +3.4%（前月比 / 前年比）', comment: '金融政策見通しへの影響を確認します。' },
        { id: 'us-cpi-core-2026-08-12', time: '21:30', importance: 3, countryJa: '米国', currency: 'USD', displayName: '消費者物価指数【コア】', prevForecastText: '前回 ±0.0% / +2.6%　予想 +0.2% / +2.5%（前月比 / 前年比）' },
      ],
      windowGroups: [
        { firstTime: '21:30', lastTime: '21:30', countryJa: '米国', currency: 'USD', labelItems: [{ time: '21:30', text: '消費者物価指数（CPI）・同【コア】' }] },
      ],
    },
    {
      date: '2026-08-13', md: '8/13', weekday: '木',
      events: [
        { id: 'gb-gdp-q2-2026-08-13', time: '15:00', importance: 3, countryJa: '英国', currency: 'GBP', displayName: '第2四半期GDP【速報値】', prevForecastText: '前回 +0.6% / +0.9%　予想 +0.4% / +1.1%（前期比 / 前年比）' },
        { id: 'gb-manuf-2026-08-13', time: '15:00', importance: 2, countryJa: '英国', currency: 'GBP', displayName: '製造業生産高（6月）', prevForecastText: '前回+0.1% / +2.3%・予想-0.4% / 未掲載' },
        { id: 'us-ppi-2026-08-13', time: '21:30', importance: 3, countryJa: '米国', currency: 'USD', displayName: '生産者物価指数（PPI）', prevForecastText: '前回 -0.3% / +5.5%　予想 +0.2% / +4.9%（前月比 / 前年比）' },
        { id: 'us-ppi-core-2026-08-13', time: '21:30', importance: 3, countryJa: '米国', currency: 'USD', displayName: '生産者物価指数【コア】', prevForecastText: '前回 +0.2% / +4.7%　予想 +0.3% / +4.2%（前月比 / 前年比）' },
      ],
      windowGroups: [
        { firstTime: '15:00', lastTime: '15:00', countryJa: '英国', currency: 'GBP', labelItems: [{ time: '15:00', text: '第2四半期GDP【速報値】' }] },
        { firstTime: '21:30', lastTime: '21:30', countryJa: '米国', currency: 'USD', labelItems: [{ time: '21:30', text: '生産者物価指数（PPI）・同【コア】' }] },
      ],
    },
    {
      date: '2026-08-14', md: '8/14', weekday: '金',
      events: [
        { id: 'au-rba-testimony-2026-08-14', time: '08:30', importance: 3, countryJa: '豪州', currency: 'AUD', displayName: 'ブロックRBA総裁：下院経済委員会への出席', comment: '議会での発言内容と質疑応答を確認します。' },
        { id: 'us-retail-2026-08-14', time: '21:30', importance: 3, countryJa: '米国', currency: 'USD', displayName: '小売売上高＆【除自動車】', prevForecastText: '前回 総合+0.2% / 除自動車-0.2%　予想 総合+0.2% / 除自動車+0.2%', comment: '消費動向を確認します。' },
        { id: 'us-umich-2026-08-14', time: '23:00', importance: 2, countryJa: '米国', currency: 'USD', displayName: 'ミシガン大学消費者信頼感指数【速報値】', prevForecastText: '前回55.2・予想54.1' },
      ],
      windowGroups: [
        { firstTime: '08:30', lastTime: '08:30', countryJa: '豪州', currency: 'AUD', labelItems: [{ time: '08:30', text: 'ブロックRBA総裁 下院経済委員会' }] },
        { firstTime: '21:30', lastTime: '21:30', countryJa: '米国', currency: 'USD', labelItems: [{ time: '21:30', text: '小売売上高＆【除自動車】' }] },
      ],
    },
  ],
};
