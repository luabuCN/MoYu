'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runLegado} = require('../legado.cjs');
const {checkedUrl} = require('../reader.cjs');
const source = raw => ({id: 'test', name: '测试源', raw: {bookSourceUrl: 'https://example.com/', ...raw}});

test('QuickJS executes shared libraries, dynamic templates, JSONPath filters and source variables', async () => {
  const input = source({jsLib: 'function title(s){return "书名："+s;} source.put("initialized","yes");', searchUrl: 'https://example.com/search?q={{key}}&offset={{(page-1)*10}}', ruleSearch: {bookList: '$.data[?(@.id > 0)]', name: '@js:title(JSON.parse(result).name)', author: '$.author', bookUrl: '/book/{{$.id}}'}});
  // JavaScript row result can also be a JSON object; String conversion is explicit.
  input.raw.ruleSearch.name = '$.name@js:title(result)';
  const calls = [];
  const result = await runLegado(input, 'search', {keyword: '三国&x=1', page: 2}, {call: async request => { calls.push(request); return {url: request.url, text: JSON.stringify({data: [{id: 0, name: '忽略'}, {id: 7, name: '三国', author: '作者'}]})}; }});
  assert.equal(calls[0].url, 'https://example.com/search?q=%E4%B8%89%E5%9B%BD%26x%3D1&offset=10');
  assert.deepEqual(result.value.map(b => [b.title, b.author, b.url]), [['书名：三国', '作者', 'https://example.com/book/7']]);
  assert.equal(result.state.vars.initialized, 'yes');
  const aggregate = source({searchUrl: 'https://example.com/search', ruleSearch: {bookList: '<js>result=JSON.stringify({list:JSON.parse(result).data});</js>$.list', name: '$.name', bookUrl: '/book/{{$.id}}'}});
  const expanded = await runLegado(aggregate, 'search', {}, {call: async request => ({url: request.url, text: '{"data":[{"id":1,"name":"甲"},{"id":2,"name":"乙"}]}'})});
  assert.equal(expanded.value.length, 2);
});

test('JSON details produce a dynamic table of contents and JS chapter content', async () => {
  const input = source({ruleBookInfo: {name: '$.data.name', tocUrl: '/toc?id={{$.data.id}}'}, ruleToc: {chapterList: '$.volumes[*][*]', chapterName: '$.title', chapterUrl: '/read/{{$.id}}'}, ruleContent: {content: '@js:JSON.parse(result).content.replace(/ADVERT/g, "")'}});
  const call = async request => ({url: request.url, text: request.url.endsWith('/detail') ? '{"data":{"id":5,"name":"测试小说"}}' : request.url.includes('/toc?') ? '{"volumes":[[{"id":8,"title":"第一章"}],[{"id":9,"title":"第二章"}]]}' : '{"content":"<p>正文ADVERT</p>"}'});
  const toc = await runLegado(input, 'toc', {url: 'https://example.com/detail'}, {call});
  assert.deepEqual(toc.value, [{title: '第一章', url: 'https://example.com/read/8'}, {title: '第二章', url: 'https://example.com/read/9'}]);
  const chapter = await runLegado(input, 'chapter', {entry: toc.value[0]}, {call, state: toc.state});
  assert.equal(chapter.value.text, '正文');
});

test('HTML scripts receive raw markup, follow computed chapter pages and keep book context', async () => {
  const input = source({ruleContent: {content: '#nr1@html@js:result.replace(/<p class="ad">[\\s\\S]*?<\\/p>/g, "")', nextContentUrl: '@js:src.includes("本章未完") ? baseUrl.replace(/\.html$/, "_2.html") : null'}});
  const urls = [];
  const result = await runLegado(input, 'chapter', {entry: {title: '第一章', url: 'https://example.com/1.html'}, book: {title: '测试小说'}}, {call: async request => { urls.push(request.url); return {url: request.url, text: request.url.includes('_2') ? '<div id="nr1"><p>第二页</p></div>' : '<div id="nr1"><p>第一页</p><p class="ad">广告</p></div><span>本章未完</span>'}; }});
  assert.deepEqual(urls, ['https://example.com/1.html', 'https://example.com/1_2.html']);
  assert.match(result.value.text, /第一页\n+第二页/); assert.doesNotMatch(result.value.text, /广告/);
});

test('script sources mix CSS rows, bare row attributes and XPath extraction', async () => {
  const input = source({jsLib: 'function shared(s){return s;}', ruleToc: {chapterList: '.chapters a', chapterName: 'text', chapterUrl: 'href'}});
  const result = await runLegado(input, 'toc', {url: 'https://example.com/book'}, {call: async request => ({url: request.url, text: '<div class="chapters"><a href="/one">第一章</a><a href="/two">第二章</a></div>'})});
  assert.deepEqual(result.value, [{title: '第一章', url: 'https://example.com/one'}, {title: '第二章', url: 'https://example.com/two'}]);
  const field = await runLegado(input, 'evaluate', {code: 'java.setContent("<div><p>XPath正文</p></div>");java.getString("//p/text()")'}, {call: async () => ''});
  assert.equal(field.value, 'XPath正文');
});

test('Java HTTP helpers suspend guest execution and expose response/cookie and encoding helpers', async () => {
  const input = source({}); const calls = [];
  const result = await runLegado(input, 'evaluate', {code: 'var r=java.post("https://example.com/form", "q=1", {"X-Test":"ok"}); [r.body(), r.header("x-value"), r.cookie("sid"), java.base64Decode(java.base64Encode("中文")), java.md5Encode("abc"), typeof java.androidId()]'}, {call: async request => { calls.push(request); return {url: request.url, text: 'OK', headers: {'x-value': 'header'}, cookie: 'sid=private'}; }});
  assert.deepEqual(result.value.slice(0, 4), ['OK', 'header', 'private', '中文']);
  assert.equal(result.value[4], '900150983cd24fb0d6963f7d28e17f72'); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].headers['X-Test'], 'ok');
});

test('scripts have no Node/file/process access and URL validation still rejects local targets', async () => {
  const input = source({});
  const result = await runLegado(input, 'evaluate', {code: '[typeof process, typeof require, typeof __dirname, Function("return typeof process")()]'}, {call: async () => { throw new Error('unexpected'); }});
  assert.deepEqual(result.value, ['undefined', 'undefined', 'undefined', 'undefined']);
  let fetched = false;
  await assert.rejects(runLegado(input, 'evaluate', {code: 'java.ajax("http://127.0.0.1/private")'}, {call: async request => { await checkedUrl(request.url); fetched = true; }}), /内网/);
  assert.equal(fetched, false);
  await assert.rejects(runLegado(input, 'evaluate', {code: 'java.startBrowserAwait("https://example.com")'}, {call: async () => ''}), error => error.code === 'verification');
});

test('non-terminating scripts time out and pending network operations can be canceled', async () => {
  const input = source({});
  await assert.rejects(runLegado(input, 'evaluate', {code: 'while(true){}'}, {cpuMs: 100, timeoutMs: 4000}), /interrupt|超时/i);
  const controller = new AbortController();
  const pending = runLegado(input, 'evaluate', {code: 'java.ajax("https://example.com/slow")'}, {signal: controller.signal, call: () => new Promise(() => {})});
  const rejected = assert.rejects(pending, error => error.code === 'canceled');
  controller.abort(); await rejected;
});
