'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findEventName } = require('../scripts/lib/match-event-name');

const fs = require('node:fs');
const path = require('node:path');
const eventNames = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'event-names.json'), 'utf8')).entries;

test('findEventName: GB/gdpはONS実タイトル「GDP first quarterly estimate, UK: ...」で解決する（2026-08-15訂正・WebSearchでons.gov.uk実在ブリテン名を確認）', () => {
  // 実際のONS releases API（gb_ons）が返すタイトル形式。旧matchキーワード（gdp m/m・prelim gdp q/q）は
  // FF想定の表記でこの実タイトルには一致しないと判明したため、event-names.jsonへ
  // 'gdp first quarterly estimate' を追加した（config/event-names.json参照）
  const entry = findEventName(eventNames, 'GB', 'gdp', 'GDP first quarterly estimate, UK: April to June 2026');
  assert.ok(entry, 'ONS実タイトルで解決できるはず');
  assert.equal(entry.display_name, 'GDP【速報値】');
});

test('findEventName: 未登録の組み合わせはnull', () => {
  assert.equal(findEventName(eventNames, 'GB', 'gdp', '存在しない架空のタイトル文字列'), null);
  assert.equal(findEventName(eventNames, 'ZZ', 'gdp', 'GDP first quarterly estimate, UK: April to June 2026'), null);
});
