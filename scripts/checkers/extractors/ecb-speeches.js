'use strict';
// ECB（欧州中央銀行）講演の抽出ルール（config/official-sources.json ecb_speeches、rss/press.html）。
// task #72（2026-09-19）。
// ECBは講演専用のRSSフィードを公式に提供していない（/rss/speeches.html等はいずれも404、
// 実測確認済み）。実際に使えるのは記者会見・プレスリリース・インタビュー・講演が混在する統合
// フィード（https://www.ecb.europa.eu/rss/press.html、RSS 2.0）のみのため、本抽出はここから
// 講演のみを絞り込む。
// 実データ構造（2026-09-19実測、live fetch）: 標準的な<item><title>...</title><link>...</link>
// <guid>...</guid><pubDate>...</pubDate></item>（<description>等は無し）。BOEのような
// 「speech by {フルネーム}」ではなく、タイトル自体が「{話者フルネーム（複数可、カンマ区切り）}:
// {講演タイトル}」という形式（例: "Christine Lagarde: A new age of capital: growth, sovereignty
// and AI"）。講演タイトル自体にコロンを含むケースが実測で確認されているため、
// 先頭の最初のコロンのみで分割する（2個目以降のコロンでは分割しない）。
// 講演itemの絞り込みは<link>/<guid>のパスに"/press/key/"を含むかで判定する（プレスリリースは
// "/press/pr/"、インタビューは"/press/inter/"、記者会見は"/press/press_conference/"）。
// pubDateはRFC822形式・明示的UTCオフセット付き（実測+0200=CEST。冬季は+0100=CET）のため
// DST判定不要でJST直接換算できる（BOEと同じ設計）。
// 複数話者（記者会見のQ&A等でカンマ区切りの複数名が入るケースが実測で確認されているが、
// press_conferenceパスのため本抽出の対象外["/press/key/"限定]。念のため先頭の1名のみを
// 話者として採用する防御的な実装とする）。

function extractEcbSpeeches(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const linkM = /<link>([^<]*)<\/link>/.exec(block);
    const guidM = /<guid[^>]*>([^<]*)<\/guid>/.exec(block);
    const path = (linkM && linkM[1]) || (guidM && guidM[1]) || '';
    if (!/\/press\/key\//.test(path)) continue;
    const titleM = /<title>([^<]*)<\/title>/.exec(block);
    const pubDateM = /<pubDate>([^<]+)<\/pubDate>/.exec(block);
    if (!titleM || !pubDateM) continue;
    const fullTitle = titleM[1].trim();
    const colonIdx = fullTitle.indexOf(':');
    if (colonIdx === -1) continue;
    const speakerField = fullTitle.slice(0, colonIdx).trim();
    const speechTitle = fullTitle.slice(colonIdx + 1).trim();
    const firstSpeaker = speakerField.split(',')[0].trim();
    if (!firstSpeaker) continue;
    items.push({
      speakerLastName: firstSpeaker,
      title: speechTitle,
      pubDateRaw: pubDateM[1].trim(),
    });
  }
  if (items.length === 0) {
    return { ok: false, reason: 'rss/press.htmlに/press/key/（講演）を含む<item>が1件も見つからない。フィード構造変化の疑い' };
  }
  return { ok: true, items };
}

module.exports = { extractEcbSpeeches };
