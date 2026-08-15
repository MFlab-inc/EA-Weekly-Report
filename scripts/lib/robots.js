'use strict';
// robots.txt courtesy protocol — 共通ロジック（SPEC §3.6・scripts/phase1/source-recon.mjsから抽出）。
// パース・許可判定は純粋関数（テスト容易）。実I/O（fetch＋ホスト単位キャッシュ）は
// createRobotsChecker() が担う。呼び出し側（harness.mjs・source-recon.mjs）で共有する。

// '*' UA向けのUser-agentグループごとにDisallow/Allowプレフィックスを集約する。
// 連続するUser-agent行は同一グループにまとめる（標準的なrobots.txt解釈）。
function parseRobots(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const groups = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    const k = key.toLowerCase();
    if (k === 'user-agent') {
      if (!current || current.disallow.length || current.allow.length) {
        current = { agents: [val], disallow: [], allow: [] };
        groups.push(current);
      } else {
        current.agents.push(val);
      }
    } else if (k === 'disallow' && current) {
      if (val) current.disallow.push(val);
    } else if (k === 'allow' && current) {
      if (val) current.allow.push(val);
    }
  }
  return groups;
}

// 最長一致のAllow/Disallowプレフィックス規則で判定する（標準的なrobots.txt優先順位）。
function isDisallowed(groups, pathname) {
  const applicable = groups.filter((g) => g.agents.some((a) => a === '*'));
  const disallow = applicable.flatMap((g) => g.disallow);
  const allow = applicable.flatMap((g) => g.allow);
  const hit = (prefix) => pathname.startsWith(prefix);
  const disallowedBy = disallow.filter(hit).sort((a, b) => b.length - a.length)[0];
  const allowedBy = allow.filter(hit).sort((a, b) => b.length - a.length)[0];
  if (!disallowedBy) return { disallowed: false };
  if (allowedBy && allowedBy.length >= disallowedBy.length) return { disallowed: false };
  return { disallowed: true, rule: disallowedBy };
}

// ホスト単位でrobots.txtを取得・キャッシュするチェッカーを生成する。
// fetchImpl: (url, opts) => Promise<Response>互換（テスト時に差し替え可能にするため注入）。
// HTTP 404は「robots.txtが存在しない＝制限なし」の標準解釈として許可扱いにする。
// それ以外の取得失敗（403・ネットワークエラー等）は慎重側に倒し、対象パスをブロック扱いにする
// （＝ isAllowed() は false を返す。UA偽装によるブロック回避は行わない、という本プロジェクトの方針）。
function createRobotsChecker({ fetchImpl, userAgent, waitMs = 1500, sleepImpl } = {}) {
  const doFetch = fetchImpl || fetch;
  const cache = new Map();
  const sleep = sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function getRobotsForHost(origin) {
    if (cache.has(origin)) return cache.get(origin);
    const robotsUrl = `${origin}/robots.txt`;
    let result;
    try {
      const res = await doFetch(robotsUrl, { headers: { 'User-Agent': userAgent }, redirect: 'follow' });
      if (res.ok) {
        const text = await res.text();
        result = { ok: true, status: res.status, groups: parseRobots(text), raw: text };
      } else if (res.status === 404) {
        result = { ok: true, status: 404, groups: [], raw: null, note: 'no robots.txt file = unrestricted by convention' };
      } else {
        result = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
    } catch (e) {
      result = { ok: false, error: String((e && e.message) || e) };
    }
    if (waitMs) await sleep(waitMs);
    cache.set(origin, result);
    return result;
  }

  async function isAllowed(url) {
    const u = new URL(url);
    const robots = await getRobotsForHost(u.origin);
    if (!robots.ok) {
      return { allowed: false, reason: `robots.txt取得失敗（${robots.error}）のため慎重側に倒しSKIP` };
    }
    const verdict = isDisallowed(robots.groups, u.pathname);
    if (verdict.disallowed) {
      return { allowed: false, reason: `robots disallow: ${verdict.rule}` };
    }
    return { allowed: true };
  }

  return { getRobotsForHost, isAllowed, cache };
}

module.exports = { parseRobots, isDisallowed, createRobotsChecker };
