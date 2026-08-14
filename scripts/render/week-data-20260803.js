'use strict';
// 2026-08-03週の入力データ。scripts/phase0/expected-events.json（実測ground truth）から転記。
// displayNameはconfig/event-names.json辞書またはscripts/lib/naming.js（規則生成）に準拠。
// FRB理事クック氏はconfig/officials.json未登録（task #17）のため、SPEC §4.2の
// 「verified:falseは役職のみ」規則どおり「FRB理事の発言」と役職のみで命名する
// （人名を推測で埋めない）。
// show_prev_forecast=false（恒久確定）のため、この週のground truthには予想値・前回値の
// 実データがなく、prevForecastTextは持たせていない（レンダラーも参照しない）。
module.exports = {
  reportMeta: 'ea-weekly-20260803',
  createdDateJa: '2026年8月1日（土）',
  targetWeekStart: '2026-08-03',
  targetWeekEnd: '2026-08-07',
  heroSummary: 'ISM製造業・非製造業、NZ雇用統計、豪州貿易収支、カナダ・米雇用統計を確認する週',
  heroPills: ['ISM製造業 8/3', 'NZ雇用統計 8/5', '米雇用統計 8/7'],
  days: [
    {
      date: '2026-08-03', md: '8/3', weekday: '月',
      events: [
        { id: 'cn_ratingdog_mfg_pmi_20260803', time: '10:45', importance: 2, countryJa: '中国', currency: 'CNY', displayName: 'RatingDog(旧財新)製造業PMI' },
        { id: 'us_ism_mfg_20260803', time: '23:00', importance: 3, countryJa: '米国', currency: 'USD', displayName: 'ISM製造業景況指数', comment: '関税影響の織り込み度合いを確認します。' },
      ],
      windowGroups: [
        { firstTime: '23:00', lastTime: '23:00', countryJa: '米国', currency: 'USD', labelItems: [{ time: '23:00', text: 'ISM製造業景況指数' }] },
      ],
    },
    {
      date: '2026-08-04', md: '8/4', weekday: '火',
      events: [
        { id: 'ca_goods_trade_20260804', time: '21:30', importance: 2, countryJa: 'カナダ', currency: 'CAD', displayName: '国際商品貿易' },
        { id: 'us_trade_20260804', time: '21:30', importance: 2, countryJa: '米国', currency: 'USD', displayName: '貿易収支' },
        { id: 'us_jolts_20260804', time: '23:00', importance: 2, countryJa: '米国', currency: 'USD', displayName: 'JOLTS求人・離職動向調査' },
        { id: 'jp_jgb_10y_auction_20260804', time: null, importance: 2, countryJa: '日本', currency: 'JPY', displayName: '10年利付国債（2026年8月債）の入札' },
      ],
      windowGroups: [],
    },
    {
      date: '2026-08-05', md: '8/5', weekday: '水',
      events: [
        { id: 'nz_labour_q2_20260805', time: '07:45', importance: 3, countryJa: 'NZ', currency: 'NZD', displayName: '雇用統計', comment: '四半期集計のため振れ幅が大きくなりやすい点に注意します。' },
        { id: 'jp_boj_minutes_20260805', time: '08:50', importance: 2, countryJa: '日本', currency: 'JPY', displayName: '日銀 金融政策決定会合議事要旨（6月15日・16日開催分）' },
        { id: 'cn_ratingdog_services_pmi_20260805', time: '10:45', importance: 2, countryJa: '中国', currency: 'CNY', displayName: 'RatingDog(旧財新)非製造業PMI' },
        { id: 'us_adp_20260805', time: '21:15', importance: 2, countryJa: '米国', currency: 'USD', displayName: 'ADP雇用統計' },
        { id: 'us_ism_services_20260805', time: '23:00', importance: 3, countryJa: '米国', currency: 'USD', displayName: 'ISM非製造業景況指数', comment: '雇用・価格の両サブ指数を確認します。' },
      ],
      windowGroups: [
        { firstTime: '07:45', lastTime: '07:45', countryJa: 'NZ', currency: 'NZD', labelItems: [{ time: '07:45', text: '雇用統計' }] },
        { firstTime: '23:00', lastTime: '23:00', countryJa: '米国', currency: 'USD', labelItems: [{ time: '23:00', text: 'ISM非製造業景況指数' }] },
      ],
    },
    {
      date: '2026-08-06', md: '8/6', weekday: '木',
      events: [
        { id: 'us_cook_speech_20260805', time: '05:05', importance: 2, countryJa: '米国', currency: 'USD', displayName: 'FRB理事の発言' },
        { id: 'au_trade_20260806', time: '10:30', importance: 3, countryJa: '豪州', currency: 'AUD', displayName: '貿易収支' },
        { id: 'uk_construction_pmi_20260806', time: '17:30', importance: 2, countryJa: '英国', currency: 'GBP', displayName: '建設業PMI' },
        { id: 'jp_jgb_30y_auction_20260806', time: null, importance: 2, countryJa: '日本', currency: 'JPY', displayName: '30年利付国債（2026年8月債）の入札' },
      ],
      windowGroups: [
        { firstTime: '10:30', lastTime: '10:30', countryJa: '豪州', currency: 'AUD', labelItems: [{ time: '10:30', text: '貿易収支' }] },
      ],
    },
    {
      date: '2026-08-07', md: '8/7', weekday: '金',
      events: [
        { id: 'ca_labour_20260807', time: '21:30', importance: 3, countryJa: 'カナダ', currency: 'CAD', displayName: '雇用統計' },
        { id: 'us_employment_situation_20260807', time: '21:30', importance: 3, countryJa: '米国', currency: 'USD', displayName: '雇用統計：非農業部門雇用者数・失業率・平均時給', comment: '利下げペースの見通しに直結するため反応が大きくなりやすい点に注意します。' },
        { id: 'ca_ivey_pmi_20260807', time: '23:00', importance: 2, countryJa: 'カナダ', currency: 'CAD', displayName: 'Ivey購買部協会景況指数' },
      ],
      windowGroups: [
        { firstTime: '21:30', lastTime: '21:30', countryJa: 'カナダ', currency: 'CAD', labelItems: [{ time: '21:30', text: '雇用統計' }] },
        { firstTime: '21:30', lastTime: '21:30', countryJa: '米国', currency: 'USD', labelItems: [{ time: '21:30', text: '雇用統計：非農業部門雇用者数・失業率・平均時給' }] },
      ],
    },
  ],
};
