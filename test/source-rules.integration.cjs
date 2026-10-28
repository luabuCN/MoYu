'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {BrowserWindow} = require('electron');

exports.run = async ({record}) => {
  const fixture = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true}});
  const js = code => fixture.webContents.executeJavaScript(code, true);
  try {
    await fixture.loadURL('about:blank');
    const textRules = fs.readFileSync(path.join(__dirname, '../src/reader/text-rules.js'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '');
    const rules = fs.readFileSync(path.join(__dirname, '../src/reader/sources.js'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '');
    // This fixture uses no replacement workers or JSON5-only request options.
    await js(`(() => { const JSON5 = {parse: JSON.parse}; ${textRules}\n${rules}\nwindow.rules = {normalizeSource,searchRequest,searchResults,loadToc,loadChapter}; })()`);
    const raw = {bookSourceName: '分页规则书源', bookSourceUrl: 'https://example.com/', searchUrl: "https://example.com/so/{{key}}{{page == 1 ? '' : '/' + page}}", ruleSearch: {bookList: 'class.item', name: 'h3@text', author: 'p.1@text', bookUrl: 'a@href'}, ruleToc: {chapterList: 'class.dir clear@li', chapterName: 'a@text', chapterUrl: 'a@href'}, ruleContent: {content: '.con@all', nextContentUrl: 'text.下一页@href'}};
    const source = await js(`rules.normalizeSource(${JSON.stringify({id: 'page-source', name: raw.bookSourceName, baseUrl: raw.bookSourceUrl, raw})})`);
    assert.equal(source.warning, '');
    const request = async (keyword, page) => js(`rules.searchRequest(${JSON.stringify(source)},${JSON.stringify(keyword)},${page})`);
    assert.equal((await request('三国', 1)).url, 'https://example.com/so/' + encodeURIComponent('三国'));
    assert.equal((await request('三国', 2)).url, 'https://example.com/so/' + encodeURIComponent('三国') + '/2');
    assert.equal((await request('a/b?x=1', 3)).url, 'https://example.com/so/a%2Fb%3Fx%3D1/3');
    for (const expression of ['{{page === 1 ? "" : "/" + page}}', "{{ page==1 ? '' : '/' + page }}"]) {
      const variant = structuredClone(raw); variant.searchUrl = '/so/{{key}}' + expression;
      const normalized = await js(`rules.normalizeSource(${JSON.stringify({baseUrl: raw.bookSourceUrl, raw: variant})})`);
      assert.equal(normalized.warning, '');
    }
    const unsupported = structuredClone(raw); unsupported.searchUrl = '/so/{{globalThis.__unsafe = 1}}';
    const rejected = await js(`rules.normalizeSource(${JSON.stringify({baseUrl: raw.bookSourceUrl, raw: unsupported})})`);
    assert.equal(rejected.warning, '');
    assert.equal(rejected.runtime, true);
    assert.equal(await js('globalThis.__unsafe === undefined'), true);
    record('conditional search-page paths encode keywords correctly and allow only the supported pagination expression without executing scripts');

    const search = {url: 'https://example.com/so/key', text: '<section class="item"><h3><a href="/book/">三国演义</a></h3><p>小说简介</p><p>罗贯中</p></section>'};
    const books = await js(`rules.searchResults(${JSON.stringify(source)},${JSON.stringify(search)})`);
    assert.equal(books[0].title, '三国演义'); assert.equal(books[0].author, '罗贯中');
    const tocResponse = {url: 'https://example.com/book/', text: '<div class="dir"><li><a href="/incorrect">旁支目录</a></li></div><div class="dir clear"><li><a href="2.html">第二章</a></li></div><div class="dir clear"><ul><li>第一卷</li><li><a href="1.html">第一章</a></li><li><a href="2.html">第二章</a></li></ul></div>'};
    const toc = await js(`rules.loadToc(${JSON.stringify(source)},'https://example.com/book/',async()=>(${JSON.stringify(tocResponse)}))`);
    assert.deepEqual(toc.map(row => row.title), ['第一章', '第二章']);
    assert.equal(toc[0].url, 'https://example.com/book/1.html');
    const pages = {
      'https://example.com/book/1.html': {url: 'https://example.com/book/1.html', text: '<div class="con">第一页正文</div><a href="1_2.html">下一页</a><a href="2.html">下一章</a>'},
      'https://example.com/book/1_2.html': {url: 'https://example.com/book/1_2.html', text: '<div class="con">第二页正文</div><a href="2.html">下一章</a>'},
    };
    const chapter = await js(`rules.loadChapter(${JSON.stringify(source)},${JSON.stringify(toc[0])},async ({url})=>{const pages=${JSON.stringify(pages)}; if(!pages[url])throw new Error('Unexpected chapter URL: '+url); return pages[url];})`);
    assert.equal(chapter.text, '第一页正文\n\n第二页正文');
    record('indexed tags and multiple-class selectors parse book metadata and contents in full-catalogue order; next-page text follows only this chapter and stops before the next chapter');
  } finally { fixture.destroy(); }
};
