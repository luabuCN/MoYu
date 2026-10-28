'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {normalizeInput, webUrl, safeBounds, Store} = require('../core.cjs');
const {ReaderLibrary} = require('../reader.cjs');
const {defaultShortcuts, normalizeShortcuts, shortcutAccelerator} = require('../reader-shortcuts.cjs');

test('reader shortcuts validate conflicts and reserved commands, and transparent preferences survive reload', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-reader-keys-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const library = new ReaderLibrary(directory);
  const keys = {...defaultShortcuts, nextPage: 'N', toggleTransparent: 'Ctrl+Alt+T'};
  library.preferences({shortcuts: keys, theme: 'transparent', previousTheme: 'green', scrollSpeed: 8, scrollKeys: false});
  const restored = new ReaderLibrary(directory).state().preferences;
  assert.deepEqual(restored.shortcuts, keys);
  assert.equal(restored.theme, 'transparent'); assert.equal(restored.previousTheme, 'green');
  assert.equal(restored.scrollSpeed, 8); assert.equal(restored.scrollKeys, false);
  assert.equal(shortcutAccelerator(keys.toggleTransparent), 'Control+Alt+T');
  assert.equal(shortcutAccelerator('Ctrl+Comma'), 'Control+,');
  assert.throws(() => normalizeShortcuts({...keys, previousPage: 'N'}), /重复/);
  assert.throws(() => library.preferences({shortcuts: {...keys, nextPage: 'Ctrl+W'}}), /保留/);
  assert.throws(() => normalizeShortcuts({...keys, toggleTransparent: 'T'}), /组合键/);
  assert.deepEqual(library.state().preferences.shortcuts, keys, 'rejected updates keep existing preferences');
  const damaged = library.state(); damaged.preferences.shortcuts.nextPage = 'process.exit()';
  fs.writeFileSync(library.index, JSON.stringify(damaged));
  assert.deepEqual(new ReaderLibrary(directory).state().preferences.shortcuts, defaultShortcuts);
});

test('reader modes survive reload and older libraries keep their original settings', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-reader-mode-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const library = new ReaderLibrary(directory);
  assert.equal(library.state().preferences.readingMode, 'scroll');
  library.preferences({readingMode: 'paged', theme: 'green', fontSize: 26});
  const restored = new ReaderLibrary(directory);
  assert.equal(restored.state().preferences.readingMode, 'paged');
  assert.equal(restored.preferences({readingMode: 'invalid'}).readingMode, 'paged');
  const old = restored.state(); delete old.preferences.readingMode;
  fs.writeFileSync(restored.index, JSON.stringify(old));
  const migrated = new ReaderLibrary(directory).state().preferences;
  assert.equal(migrated.readingMode, 'scroll');
  assert.equal(migrated.theme, 'green'); assert.equal(migrated.fontSize, 26);
});

test('addresses, local ports, Chinese domains, and searches resolve correctly', () => {
  assert.equal(normalizeInput(' douyin.com '), 'https://douyin.com/');
  assert.equal(normalizeInput('https://weread.qq.com/web/shelf'), 'https://weread.qq.com/web/shelf');
  assert.equal(normalizeInput('localhost:8080/one?q=hi'), 'http://localhost:8080/one?q=hi');
  assert.equal(normalizeInput('example.com:8080/one'), 'https://example.com:8080/one');
  assert.equal(normalizeInput('127.0.0.1:1234/'), 'http://127.0.0.1:1234/');
  assert.equal(normalizeInput('[::1]:1234/'), 'http://[::1]:1234/');
  assert.equal(new URL(normalizeInput('例子.中国')).protocol, 'https:');
  assert.equal(new URL(normalizeInput('虚拟仿真实验')).searchParams.get('q'), '虚拟仿真实验');
});

test('active, local-file, and credential-bearing URLs cannot be loaded', () => {
  for (const input of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,hi', 'https://user:pass@example.com/', '', 'https://', 'https://example.com/\nfoo']) {
    assert.throws(() => normalizeInput(input), undefined, input);
  }
  assert.equal(webUrl('file:///test'), null);
});

test('restored bounds stay inside the current monitor, including negative monitor coordinates', () => {
  assert.deepEqual(safeBounds({x:9000,y:-9000,width:2000,height:2000}, {x:-1280,y:0,width:1280,height:720}), {x:-1280,y:0,width:1280,height:720});
  const bounds = safeBounds({x:-9000,y:9000,width:100,height:100}, {x:0,y:0,width:1920,height:1080});
  assert.deepEqual(bounds, {x:0,y:660,width:420,height:420});
});

test('history is bounded, bookmarks toggle, and preferences survive disk reload', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-core-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const store = new Store(directory);
  store.value.opacity = .65;
  store.value.mobile = true;
  store.value.hoverHide = true;
  store.value.edgeHide = true;
  for (let i=0; i<205; i++) store.visit(`https://example.com/${i}`, `Title ${i}`);
  assert.equal(store.value.history.length, 200);
  store.visit('https://example.com/204', 'Updated title');
  assert.equal(store.value.history.length, 200);
  assert.equal(store.value.history[0].title, 'Updated title');
  assert.equal(store.toggleBookmark('https://example.com/204', 'Test'), true);
  assert.equal(new Store(directory).value.opacity, .65);
  assert.equal(new Store(directory).value.mobile, true);
  assert.equal(new Store(directory).value.hoverHide, true);
  assert.equal(new Store(directory).value.edgeHide, true);
  assert.equal(new Store(directory).value.bookmarks.length, 1);
  assert.equal(store.toggleBookmark('https://example.com/204', 'Test'), false);
  assert.equal(new Store(directory).value.bookmarks.length, 0);
});

test('damaged configuration is preserved, invalid settings are constrained', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-core-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  fs.writeFileSync(path.join(directory,'settings.json'), '{broken');
  assert.equal(new Store(directory).value.opacity, 1);
  assert.ok(fs.readdirSync(directory).some(name => name.startsWith('settings.json.invalid-')));
  fs.writeFileSync(path.join(directory,'settings.json'), JSON.stringify({opacity:.01,zoom:50,bounds:{x:'bad'},bookmarks:[{url:'javascript:alert(1)'}],theme:'bad'}));
  const store = new Store(directory);
  assert.equal(store.value.opacity, .3);
  assert.equal(store.value.zoom, 2);
  assert.equal(store.value.bounds, null);
  assert.equal(store.value.theme, 'light');
  assert.deepEqual(store.value.bookmarks, []);
  assert.equal(store.value.hoverHide, false);
  assert.equal(store.value.edgeHide, false);
});
