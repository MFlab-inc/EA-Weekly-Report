import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isDisallowed, createRobotsChecker } from '../scripts/lib/robots.js';

test('parseRobots: 単一User-agentグループのDisallow/Allowを抽出する', () => {
  const text = `User-agent: *\nDisallow: /private\nAllow: /private/public\n`;
  const groups = parseRobots(text);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].agents, ['*']);
  assert.deepEqual(groups[0].disallow, ['/private']);
  assert.deepEqual(groups[0].allow, ['/private/public']);
});

test('parseRobots: 連続するUser-agent行は同一グループにまとめる', () => {
  const text = `User-agent: Googlebot\nUser-agent: *\nDisallow: /admin\n`;
  const groups = parseRobots(text);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].agents, ['Googlebot', '*']);
});

test('parseRobots: コメント・空行を無視する', () => {
  const text = `# comment\n\nUser-agent: *\n# another comment\nDisallow: /x\n`;
  const groups = parseRobots(text);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].disallow, ['/x']);
});

test('isDisallowed: Disallow配下のパスはtrue', () => {
  const groups = [{ agents: ['*'], disallow: ['/schedule/'], allow: [] }];
  assert.equal(isDisallowed(groups, '/schedule/news_release/cpi.htm').disallowed, true);
});

test('isDisallowed: Disallow対象外のパスはfalse', () => {
  const groups = [{ agents: ['*'], disallow: ['/schedule/'], allow: [] }];
  assert.equal(isDisallowed(groups, '/other/page.htm').disallowed, false);
});

test('isDisallowed: より長いAllowがDisallowを上書きする', () => {
  const groups = [{ agents: ['*'], disallow: ['/schedule/'], allow: ['/schedule/news_release/'] }];
  assert.equal(isDisallowed(groups, '/schedule/news_release/cpi.htm').disallowed, false);
});

test('isDisallowed: groupsが空なら常にfalse', () => {
  assert.equal(isDisallowed([], '/anything').disallowed, false);
});

test('createRobotsChecker: HTTP 404は制限なし扱い（許可）', async () => {
  const checker = createRobotsChecker({
    fetchImpl: async () => ({ ok: false, status: 404 }),
    userAgent: 'test-agent',
    waitMs: 0,
  });
  const verdict = await checker.isAllowed('https://example.com/foo');
  assert.equal(verdict.allowed, true);
});

test('createRobotsChecker: robots.txt取得失敗(403等)は慎重側に倒しブロック扱い', async () => {
  const checker = createRobotsChecker({
    fetchImpl: async () => ({ ok: false, status: 403 }),
    userAgent: 'test-agent',
    waitMs: 0,
  });
  const verdict = await checker.isAllowed('https://example.com/foo');
  assert.equal(verdict.allowed, false);
});

test('createRobotsChecker: Disallow対象パスはブロック扱い', async () => {
  const checker = createRobotsChecker({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /foo\n' }),
    userAgent: 'test-agent',
    waitMs: 0,
  });
  const verdict = await checker.isAllowed('https://example.com/foo/bar');
  assert.equal(verdict.allowed, false);
});

test('createRobotsChecker: 許可パスはtrue、同一ホストは再フェッチしない（キャッシュ）', async () => {
  let calls = 0;
  const checker = createRobotsChecker({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /private\n' };
    },
    userAgent: 'test-agent',
    waitMs: 0,
  });
  await checker.isAllowed('https://example.com/a');
  await checker.isAllowed('https://example.com/b');
  assert.equal(calls, 1);
});
