'use strict';
// 英国家統計局（ONS）releases API（gb_ons）の抽出ルール。構造化JSON APIのため単純にparseする。
// 実データ構造（2026-08-14実測fixtureで確認）: { releases: [{ description: { title, release_date(UTC ISO8601), cancelled, postponed } }] }
// 注意: 本APIは release-type=type-upcoming クエリのため「発表予定日が現在より未来のリリースのみ」を返す。
// 過去日の照合（既刊ground truth等）には使えない（用途上の制約。production運用では対象週は常に未来なので問題ない）
//
// 2026-08-15追記（task #47、8/17週フルパイプライン実ネットワーク検証で発見した実バグ）:
// ONSは統計本体の発表ページとは別に、同一瞬間（release_dateが完全一致）に「{タイトル} time series」
// という付随的な生データテーブル公開ページを別リリースとして返す（例: 実測で確認した
// "Consumer price inflation, UK: July 2026"と"Consumer price inflation, UK: July 2026 time series"が
// いずれも2026-08-19T06:00:00Zで重複、GDP側も同型で確認済み）。読者（EA利用者）にとっては同一の
// 発表タイミングを指す1件のイベントであり、フィルタしないとmatchキーワードが両方にヒットして
// レポート上に同名イベントが2件重複表示される（実際に8/17週の実ネットワーク検証で発生を確認）。
// タイトル末尾が" time series"（大小文字無視）の行は付随リリースとして除外する

// json: releases_api_upcoming_gdp.json相当のJSON文字列
// 戻り値: { ok: true, rows: [{ title, utcInstant, cancelled, postponed }] } または { ok: false, reason }
function extractOnsReleases(json) {
  let body;
  try {
    body = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `JSON解析失敗: ${e.message}` };
  }
  const releases = body?.releases;
  if (!Array.isArray(releases)) {
    return { ok: false, reason: 'releases配列が存在しない。API応答構造の変化の疑い' };
  }
  const rows = releases
    .filter((r) => !r?.description?.cancelled)
    .filter((r) => !/ time series$/i.test((r?.description?.title || '').trim()))
    .map((r) => ({
      title: r.description.title,
      utcInstant: r.description.release_date,
      cancelled: Boolean(r.description.cancelled),
      postponed: Boolean(r.description.postponed),
    }));
  return { ok: true, rows };
}

module.exports = { extractOnsReleases };
