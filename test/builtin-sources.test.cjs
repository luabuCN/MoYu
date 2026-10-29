'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ReaderLibrary} = require('../reader.cjs');
const builtins = require('../builtin-sources.json');

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-builtin-sources-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('new libraries immediately have the three enabled sources and retain stable IDs on restart', t => {
  const root = directory(t), library = new ReaderLibrary(root);
  const {sources} = library.state();
  assert.deepEqual(sources.map(source => source.name), ['笔趣阁⛅', '番茄小说', '📖玄幻文学']);
  assert.deepEqual(sources.map(source => source.baseUrl), ['https://www.bqquge.org/', 'https://fanqienovel.com', 'https://m.xhwx8.com']);
  for (const source of sources) {
    assert.equal(source.enabled, true);
    assert.match(source.id, /^[a-f\d]{24}$/);
    assert.ok(source.raw.searchUrl && source.raw.ruleSearch.bookList && source.raw.ruleToc.chapterList && source.raw.ruleContent.content);
  }
  assert.match(sources[1].raw.jsLib, /function fqContent/);
  assert.deepEqual(new ReaderLibrary(root).state().sources, sources);
  assert.deepEqual(JSON.parse(fs.readFileSync(library.index, 'utf8')).builtinSourceSeeds, builtins.map(item => item.key));
});

test('upgrades fill missing sources without duplicating renamed sites or changing existing rules, disabled state and books', t => {
  const root = directory(t), reader = path.join(root, 'reader');
  const custom = {id: 'custom-source', name: '自选书源', baseUrl: 'https://books.example/', enabled: true, raw: {baseUrl: 'https://books.example/'}};
  const fanqie = {id: 'renamed-fanqie', name: '我的番茄配置', baseUrl: 'https://fanqienovel.com/', enabled: false,
    raw: {bookSourceUrl: 'https://fanqienovel.com/', bookSourceName: '我的番茄配置', searchUrl: '/my-search'}};
  const books = [{id: '1'.repeat(24), type: 'online', title: '保留的书', sourceId: fanqie.id, progress: {chapter: 8, fraction: .3}, marks: [{chapter: 2, fraction: .5}]}];
  fs.mkdirSync(reader);
  fs.writeFileSync(path.join(reader, 'library.json'), JSON.stringify({sources: [fanqie, custom], books, preferences: {theme: 'dark', fontSize: 25}}));
  const migrated = new ReaderLibrary(root).state();
  assert.equal(migrated.sources.length, 4);
  assert.deepEqual(migrated.sources.slice(0, 2), [fanqie, custom]);
  assert.deepEqual(migrated.books, books);
  assert.equal(migrated.preferences.theme, 'dark'); assert.equal(migrated.preferences.fontSize, 25);
  assert.deepEqual(new ReaderLibrary(root).state().sources, migrated.sources);
});

test('disabled and deleted defaults stay that way after restarting, and explicit reimport still works', t => {
  const root = directory(t), library = new ReaderLibrary(root);
  const [disabled, removed] = library.state().sources;
  library.sourceAction(disabled.id, false);
  library.sourceAction(removed.id, true);
  const restored = new ReaderLibrary(root);
  assert.equal(restored.source(disabled.id).enabled, false);
  assert.equal(restored.state().sources.length, 2);
  assert.equal(restored.state().sources.some(source => source.id === removed.id), false);
  assert.deepEqual(restored.importSources(JSON.stringify(removed.raw)), {imported: 1, skipped: 0});
  assert.equal(new ReaderLibrary(root).source(removed.id).enabled, true);
  assert.equal(new ReaderLibrary(root).state().sources.length, 3);
});
