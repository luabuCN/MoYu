'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {BrowserWindow, ipcMain} = require('electron');

exports.run = async ({record}) => {
  const sources = ['验证书源', '正常书源甲', '正常书源乙'].map((name, index) => ({
    id: `source-${index}`, name, enabled: true, baseUrl: 'https://example.com/',
    raw: {name, baseUrl: 'https://example.com/', search: {url: '/search?q={{key}}', list: '.book', name: 'a@text', author: '.author@text', bookUrl: 'a@href'}, toc: {list: '.chapter a'}, content: {text: '#content@text'}},
  }));
  sources[1].raw = {bookSourceName: sources[1].name, bookSourceUrl: 'https://example.com/', searchUrl: '@js:"https://example.com/search?q="+key', ruleSearch: {bookList: '$.data', name: '$.name', bookUrl: '$.url'}, ruleToc: {chapterList: '$.chapters'}, ruleContent: {content: '@js:result'}};
  const calls = [];
  const fixture = new BrowserWindow({show: false, width: 820, height: 720, webPreferences: {preload: path.join(__dirname, 'reader-verification-preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false}});
  const js = code => fixture.webContents.executeJavaScript(code, true);
  const until = async (code, label) => {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      if (await js(code)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Timeout: ' + label);
  };
  ipcMain.handle('moyu:test-reader-verification', async (event, name, value) => {
    assert.equal(event.sender, fixture.webContents);
    if (name === 'state') return {ok: true, result: {books: [], sources, preferences: {theme: 'paper', fontSize: 20, lineHeight: 1.9, width: 720, font: 'serif'}}};
    if (name === 'sources-import') return {ok: true, result: {imported: 0, skipped: 0, verificationSkipped: true}};
    if (name === 'fetch') {
      calls.push(value.sourceId);
      if (value.sourceId === sources[0].id) return {ok: false, code: 'verification', status: 403, error: '需要人机验证，已跳过此书源'};
      if (value.sourceId === sources[1].id) {
        assert.equal(value.runtime.operation, 'search'); assert.equal(value.runtime.params.keyword, '三国');
        return {ok: true, result: {runtimeBooks: [{sourceId: sources[1].id, sourceName: sources[1].name, title: '三国演义', author: '罗贯中', url: 'https://example.com/book'}]}};
      }
      return {ok: true, result: {url: 'https://example.com/search', text: '<article class="book"><a href="/book">三国演义</a><span class="author">罗贯中</span></article>'}};
    }
    if (name === 'fetch-cancel') return {ok: true, result: true};
    throw new Error('Unexpected fixture reader action: ' + name);
  });
  try {
    await fixture.loadFile(path.join(__dirname, '..', 'renderer-dist', 'index.html'));
    await until('Boolean(document.querySelector("#reader-panel .library-tabs"))', 'reader ready');
    await js('document.querySelectorAll("#reader-panel .library-tabs button")[2].click()');
    await until('Boolean(document.querySelector("#source-url"))', 'source import ready');
    await js('(() => {const input = document.querySelector("#source-url"); input.value = "https://example.com/verified-source"; input.dispatchEvent(new Event("input", {bubbles:true})); document.querySelector(".source-import").requestSubmit()})()');
    await until('document.querySelector("#toast").textContent.includes("已跳过导入")', 'protected source link skipped');
    assert.equal(await js('Boolean(document.querySelector("#reader-panel .reader-alert"))'), false);
    record('protected source-list URLs skip import with a toast and preserve existing sources without an error banner');

    await js('document.querySelectorAll("#reader-panel .library-tabs button")[1].click()');
    await until('Boolean(document.querySelector("#novel-query"))', 'novel search ready');
    await js('(() => {const input = document.querySelector("#novel-query"); input.value = "三国"; input.dispatchEvent(new Event("input", {bubbles:true})); document.querySelector(".novel-search").requestSubmit()})()');
    await until('document.querySelectorAll(".source-run-list article[data-status=skipped]").length === 1 && document.querySelectorAll(".novel-results article").length === 2 && !document.querySelector(".reader-loading")', 'other sources finish after verification skip');
    assert.equal(await js('document.querySelector(".source-run-list article[data-status=skipped]").querySelectorAll("button").length'), 0);
    assert.equal(await js('document.querySelector(".source-run-list [role=status]").textContent.includes("3 / 3")'), true);
    assert.equal(await js('Boolean(document.querySelector("#reader-panel .reader-alert"))'), false);
    assert.equal(calls.filter(id => id === sources[0].id).length, 1);
    await js('document.querySelector(".novel-search").requestSubmit()');
    await until('document.querySelectorAll(".novel-results article").length === 2 && !document.querySelector(".reader-loading")', 'second search completes');
    assert.equal(calls.filter(id => id === sources[0].id).length, 1, 'known verification sources should not be requested again during this run');
    assert.equal(calls.filter(id => id === sources[1].id).length, 2);
    assert.equal(calls.filter(id => id === sources[2].id).length, 2);
    record('search skips verification sources, finishes remaining queued sources, hides verification actions and remembers the skip for later searches');
  } finally {
    fixture.destroy();
    ipcMain.removeHandler('moyu:test-reader-verification');
  }
};
