'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {BrowserWindow, ipcMain} = require('electron');
const JSZip = require('jszip');

exports.run = async ({record}) => {
  const text = Array.from({length: 65}, (_, i) => `第${i + 1}段，微风吹过山谷，远处的灯火渐渐亮起。他沿着石阶往前走，听见树叶沙沙作响。故事还在继续，每一页都有新的风景。`).join('\n');
  const entries = ['第一章 山谷', '第二章 灯火', '第三章 归途'].map(title => ({title}));
  const books = ['txt', 'online', 'epub'].map((type, i) => ({id: type, type, title: ['翻页测试', '在线测试', 'EPUB 测试'][i], author: '测试作者', addedAt: 3 - i, chapterCount: 3, marks: [], progress: {chapter: 0, fraction: 0, percent: 0}}));
  const preferences = {theme: 'green', fontSize: 20, lineHeight: 1.9, width: 720, font: 'serif', readingMode: 'scroll'};
  const chapterRequests = [], failedChapters = new Set();
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">layout-test</dc:identifier><dc:title>EPUB 测试</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${entries.map((e, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${entries.map((e, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${entries.map((e, i) => `<li><a href="c${i}.xhtml">${e.title}</a></li>`).join('')}</ol></nav></body></html>`);
  entries.forEach((e, i) => zip.file(`OEBPS/c${i}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${e.title}</title></head><body><h1>${e.title}</h1>${text.split('\n').map((p, index) => index ? `<p>${p}</p>` : `<p><span id="colored-text" style="color:rgb(190,40,40)!important;background-color:rgb(255,255,200)!important">${p}</span></p>`).join('')}</body></html>`));
  const bytes = [...await zip.generateAsync({type: 'uint8array'})];
  const fixture = new BrowserWindow({show: false, transparent: true, backgroundColor: '#f5f7f6', width: 820, height: 720, webPreferences: {preload: path.join(__dirname, 'reader-layout-preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true}});
  fixture.webContents.setFrameRate(60);
  const rendererMessages = [];
  fixture.webContents.on('console-message', event => { rendererMessages.push(event.message); if (rendererMessages.length > 12) rendererMessages.shift(); });
  const js = code => fixture.webContents.executeJavaScript(code, true).catch(error => { console.error('Reader script failed:', code); throw error; });
  const until = async (code, label) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (await js(code)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Timeout: ' + label + ' ' + await js('document.querySelector(".reading-alert")?.textContent || ""'));
  };
  // Resizing the bottom bar can schedule another layout through ResizeObserver.
  const settle = () => js('Promise.race([new Promise(resolve => {let frames=5;function frame(){if(--frames)requestAnimationFrame(frame);else resolve()}requestAnimationFrame(frame)}), new Promise((_, reject) => setTimeout(() => reject(new Error("Reader frames stalled")), 3000))])');
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const openBook = async title => {
    await js(`Array.from(document.querySelectorAll('.book-cover')).find(b => b.textContent.includes(${JSON.stringify(title)})).click()`);
    await until('Boolean(document.querySelector(".reading-footer")) && !document.querySelector(".reading-busy")', 'book opens');
    await settle();
  };
  const pageClick = async direction => {
    const point = await js(`(() => {const r=document.querySelector('.text-reading-scroll').getBoundingClientRect();return {x:Math.round(r.left+r.width*${direction > 0 ? '.8' : '.2'}),y:Math.round(r.top+r.height*.5)}})()`);
    fixture.webContents.sendInputEvent({type: 'mouseDown', button: 'left', ...point, clickCount: 1});
    fixture.webContents.sendInputEvent({type: 'mouseUp', button: 'left', ...point, clickCount: 1});
    await settle();
  };
  const pageNumber = () => js('Number(document.querySelector(".reading-page-number").textContent.trim().split("/")[0])');
  const screenshot = async name => fs.writeFileSync(path.join(__dirname, '../test-output', name), (await fixture.webContents.capturePage()).toPNG());
  const footerFits = () => js('(() => {const f=document.querySelector(".reading-footer").getBoundingClientRect();return f.height===40&&Array.from(document.querySelectorAll(".reading-footer button,.reading-footer .reading-page-number")).every(e=>{const r=e.getBoundingClientRect();return r.left>=f.left&&r.right<=f.right&&r.top>=f.top&&r.bottom<=f.bottom&&Math.abs((r.top+r.bottom-f.top-f.bottom)/2)<1})})()');
  ipcMain.handle('moyu:test-reader-layout', async (event, name, value) => {
    assert.equal(event.sender, fixture.webContents);
    let result;
    if (name === 'state') result = {books, sources: [], preferences};
    else if (name === 'open') result = {book: books.find(b => b.id === value.id), toc: value.id === 'epub' ? [] : entries, bytes};
    else if (name === 'chapter') {
      chapterRequests.push(`${value.id}:${value.index}`);
      if (failedChapters.has(`${value.id}:${value.index}`)) return {ok: false, error: '测试章节暂时无法连接'};
      result = {title: entries[value.index].title, text};
    }
    else if (name === 'progress' || name === 'metadata') {
      const b = books.find(b => b.id === value.id);
      if (name === 'progress') b.progress = value.progress;
      else Object.assign(b, value.data);
      result = b;
    } else if (name === 'mark') {
      const b = books.find(b => b.id === value.id);
      if (b.marks.some(mark => mark.key === value.position.key)) b.marks = b.marks.filter(mark => mark.key !== value.position.key);
      else b.marks.push({...value.position, createdAt: Date.now()});
      result = b;
    } else if (name === 'preferences') result = Object.assign(preferences, value);
    else if (name === 'shortcut-capture') result = true;
    else if (name === 'presentation') {
      const color = value.transparent ? '#00000000' : '#f5f7f6';
      fixture.setBackgroundColor(color);
      result = {transparent: value.transparent};
    }
    else throw new Error('Unexpected layout action: ' + name);
    return {ok: true, result};
  });
  try {
    await fixture.loadFile(path.join(__dirname, '../renderer-dist/index.html'));
    await until('document.querySelectorAll(".book-cover").length===3', 'shelf ready');
    await openBook('翻页测试');
    assert.equal(await js('Boolean(document.querySelector(".reading-header"))'), false);
    assert.equal(await js('Math.abs(document.querySelector(".reading-stage").getBoundingClientRect().top-document.querySelector("#reader-panel").getBoundingClientRect().top)<1'), true, 'body starts at the top of the reader');
    assert.equal(await js('["返回书架","添加或取消书签","阅读设置"].every(label=>document.querySelector(".reading-footer").contains(document.querySelector(`[aria-label="${label}"]`)))'), true);
    assert.equal(await footerFits(), true, 'all bottom controls fit a regular window');
    assert.equal(await js('document.querySelector("[aria-label=添加或取消书签] use").getAttribute("href") !== document.querySelector("[aria-label=查看书签] use").getAttribute("href")'), true, 'adding a bookmark and opening the bookmark list use different icons');
    await click('[aria-label=添加或取消书签]');
    await until('document.querySelector("[aria-label=添加或取消书签]").getAttribute("aria-pressed")==="true"', 'bottom bookmark adds a mark');
    assert.equal(await js('document.querySelector("[aria-label=添加或取消书签] use").getAttribute("href")'), '#i-bookmark-check');
    assert.equal(await js('document.querySelector("#toast").getBoundingClientRect().bottom<document.querySelector(".reading-footer").getBoundingClientRect().top'), true, 'feedback stays above the bottom controls');
    await click('[aria-label=查看书签]');
    await until('Boolean(document.querySelector(".reader-drawer .mark-date"))', 'bottom bookmark list opens');
    assert.equal(await js('document.querySelector(".reader-overlay").getBoundingClientRect().bottom<=document.querySelector(".reading-footer").getBoundingClientRect().top+1'), true, 'drawer leaves the footer accessible');
    await click('.reader-drawer [aria-label=关闭面板]');
    await screenshot('reader-bottom-regular.png');
    assert.equal(await js('Boolean(document.querySelector(".chapter-end"))'), false);
    assert.equal(await js('Boolean(document.querySelector(".reading-footer input,.reading-progress"))'), false);
    assert.equal(await js('document.querySelector("[aria-label=上一章]").disabled'), true);
    await click('[aria-label=下一章]');
    await until('document.querySelector(".reading-book-info small").textContent.includes("第二章") && !document.querySelector(".reading-busy")', 'next chapter');
    await click('[aria-label=上一章]');
    await until('document.querySelector(".reading-book-info small").textContent.includes("第一章") && !document.querySelector(".reading-busy")', 'previous chapter');
    await click('.reader-mode'); await settle();
    await until('Number(document.querySelector(".reading-page-number").textContent.split("/")[1].replace("页", ""))>2', 'multiple columns');
    assert.equal(await js('document.querySelector(".reading-footer").contains(document.querySelector(".reading-page-number"))'), true, 'page count belongs to the bottom toolbar');
    assert.equal(await js('Boolean(document.querySelector(".reading-stage .reading-page-number"))'), false);
    assert.equal(await pageNumber(), 1);
    await pageClick(1); assert.equal(await pageNumber(), 2);
    await pageClick(-1); assert.equal(await pageNumber(), 1);
    assert.equal(await js('document.querySelector(".text-reading-scroll").scrollTop'), 0);
    record('reader removes chapter-end block, bottom arrows change chapters, and clicking body halves turns horizontal pages');

    await js('(() => {const e=document.querySelector(".text-reading>p:not(.chapter-kicker)"),r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r)})()');
    await pageClick(1); assert.equal(await pageNumber(), 1, 'selected text must not turn a page');
    await js('getSelection().removeAllRanges()');
    await pageClick(1); await pageClick(1);
    await js('document.querySelector(".text-reading-scroll").focus(); document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
    await settle(); assert.equal(await pageNumber(), 4, 'keyboard page navigation stays within the chapter');
    const beforeSwitch = await pageNumber();
    await click('.reader-mode'); await settle();
    assert.equal(await js('document.querySelector(".text-reading-scroll").scrollTop > 0'), true);
    const beforeClick = await js('document.querySelector(".text-reading-scroll").scrollTop');
    await pageClick(1); assert.equal(await js('document.querySelector(".text-reading-scroll").scrollTop'), beforeClick, 'scroll mode body clicks do not turn pages');
    await click('.reader-mode'); await settle();
    assert.equal(await pageNumber(), beforeSwitch, 'mode switch keeps the current passage');
    fixture.setSize(420, 640); await settle();
    await screenshot('reader-paged-compact.png');
    assert.equal(await footerFits(), true, 'compact footer fits on one row');
    await js('(() => {const e=document.querySelector(".text-reading-scroll");e.scrollLeft=e.scrollWidth;e.dispatchEvent(new Event("scroll"))})()'); await settle();
    await pageClick(1);
    await until('document.querySelector(".text-reading h1").textContent.includes("第二章") && !document.querySelector(".reading-busy")', 'page beyond last goes to next chapter');
    await pageClick(-1);
    await until('document.querySelector(".text-reading h1").textContent.includes("第一章") && !document.querySelector(".reading-busy")', 'previous chapter last page');
    assert.equal(await js('Number(document.querySelector(".reading-page-number").textContent.split("/")[0]) === Number(document.querySelector(".reading-page-number").textContent.split("/")[1].replace("页", ""))'), true);
    await click('[aria-label=下一章]'); await until('!document.querySelector(".reading-busy")', 'chapter jump settles');
    await click('[aria-label=下一章]'); await until('document.querySelector(".text-reading h1").textContent.includes("第三章") && !document.querySelector(".reading-busy")', 'last chapter');
    assert.equal(await js('document.querySelector("[aria-label=下一章]").disabled'), true);
    record('pagination preserves reading position, ignores text selection, fits a compact window and crosses chapter boundaries correctly');

    fixture.setSize(820, 720); await settle();
    await click('[aria-label=阅读设置]');
    await click('.paper-options [data-paper=dark]');
    await js('(() => {const e=document.querySelector("[role=slider][aria-label=字号]");e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"PageUp",bubbles:true}))})()');
    await until('document.querySelector("[role=slider][aria-label=字号]").getAttribute("aria-valuenow")==="30"', 'custom font slider responds to keyboard');
    await click('.reader-drawer [aria-label=关闭面板]');
    await settle(); await screenshot('reader-paged-dark.png');
    assert.equal(await js('document.querySelector(".text-reading-scroll").scrollHeight<=document.querySelector(".text-reading-scroll").clientHeight+1'), true, 'large fonts stay in horizontal columns');
    await click('[aria-label=返回书架]');
    books[1].title = '在线测试：一段很长的书名用于检查底部窄窗口的布局';
    await openBook('在线测试');
    assert.equal(await js('document.querySelector(".reading-footer").contains(document.querySelector("[aria-label=切换书源]"))'), true);
    fixture.setSize(420, 640); await settle();
    assert.equal(await footerFits(), true, 'source switching and book information fit on the same row in a compact window');
    assert.equal(await js('document.querySelector("#toast").getBoundingClientRect().bottom<document.querySelector(".reading-footer").getBoundingClientRect().top'), true, 'compact feedback stays above the toolbar');
    await screenshot('reader-bottom-online-compact.png');
    fixture.setSize(740, 720); fixture.webContents.setZoomFactor(1.25); await settle();
    assert.equal(await footerFits(), true, 'all controls stay on one row with application zoom enabled');
    await screenshot('reader-bottom-zoomed.png');
    fixture.webContents.setZoomFactor(1);
    fixture.setSize(820, 720); await settle();
    assert.equal(await js('Boolean(document.querySelector(".is-paged"))'), true);
    await pageClick(1); assert.equal(await pageNumber(), 2);
    await click('[aria-label=返回书架]');
    await openBook('在线测试'); assert.equal(await pageNumber(), 2, 'reopening restores the saved page');
    await click('[aria-label=返回书架]');
    record('font and theme changes reflow horizontal pages, mode persists across books, and all reader controls stay in the responsive footer');

    await openBook('翻页测试');
    await click('[aria-label=阅读设置]');
    await js('Array.from(document.querySelectorAll(".reading-settings-tabs button")).find(b=>b.textContent==="快捷键").click()');
    await click('[data-shortcut=nextPage]');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",code:"ArrowLeft",bubbles:true}))');
    assert.equal(await js('document.querySelector(".shortcut-message").textContent.includes("上一页")'), true, 'duplicate shortcuts are rejected');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"n",code:"KeyN",bubbles:true}))');
    assert.equal(await js('document.querySelector("[data-shortcut=nextPage] kbd").textContent'), 'N');
    await settle();
    await screenshot('reader-shortcut-settings.png');
    await click('.reader-drawer [aria-label=关闭面板]'); await settle();
    const savedPage = await pageNumber();
    await js('document.querySelector(".text-reading-scroll").focus();document.dispatchEvent(new KeyboardEvent("keydown",{key:"n",code:"KeyN",bubbles:true}))');
    await settle(); assert.equal(await pageNumber(), savedPage + 1, 'custom page key works');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:",",code:"Comma",ctrlKey:true,bubbles:true}))');
    await until('Boolean(document.querySelector(".reader-drawer"))', 'settings shortcut opens drawer');
    await js('Array.from(document.querySelectorAll(".reading-settings-tabs button")).find(b=>b.textContent==="快捷键").click()');
    await js('Array.from(document.querySelectorAll(".reading-shortcuts button")).find(b=>b.textContent.includes("恢复默认")).click()');
    await js('Array.from(document.querySelectorAll(".reading-settings-tabs button")).find(b=>b.textContent==="阅读外观").click()');
    await click('.paper-options [data-paper=transparent]'); await settle();
    await until('document.documentElement.dataset.readerTransparent==="true" && !document.querySelector(".reader-drawer")', 'transparent mode closes settings');
    assert.equal(await js('getComputedStyle(document.querySelector(".titlebar")).display'), 'none');
    assert.equal(await js('getComputedStyle(document.querySelector(".reading-footer")).display'), 'none');
    assert.equal(await js('getComputedStyle(document.querySelector(".text-reading")).color'), 'rgb(0, 0, 0)');
    assert.equal(await js('getComputedStyle(document.body).backgroundColor'), 'rgba(0, 0, 0, 0)');
    const transparentBitmap = (await fixture.webContents.capturePage()).toBitmap();
    assert.equal(transparentBitmap[3], 0, 'empty page pixels have zero alpha');
    assert.equal(transparentBitmap.some((value, index) => index % 4 === 3 && value > 0), true, 'transparent reading retains visible text pixels');
    await screenshot('reader-transparent.png');
    fixture.setBackgroundColor('#ffffff'); await settle();
    await screenshot('reader-transparent-on-white.png');
    fixture.setBackgroundColor('#00000000');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await settle();
    assert.equal(await js('document.documentElement.dataset.readerTransparent'), 'false');
    assert.equal(await js('getComputedStyle(document.querySelector(".titlebar")).display !== "none"'), true);
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"T",code:"KeyT",ctrlKey:true,shiftKey:true,bubbles:true}))'); await settle();
    assert.equal(await js('document.documentElement.dataset.readerTransparent'), 'true');
    fixture.webContents.send('moyu:reader-recover'); await settle();
    assert.equal(await js('document.documentElement.dataset.readerTransparent'), 'false', 'tray recovery restores the ordinary reader');
    if (await js('Boolean(document.querySelector(".is-paged"))')) { await click('.reader-mode'); await settle(); }
    await js('document.querySelector(".text-reading-scroll").scrollTop=0;document.querySelector(".text-reading-scroll").focus();document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",code:"ArrowDown",bubbles:true}))'); await settle();
    assert.equal(await js('document.querySelector(".text-reading-scroll").scrollTop>0'), true, 'scroll shortcuts move the chapter');
    await click('[aria-label=返回书架]');
    record('custom shortcuts reject conflicts, page and scroll keys work, and transparent reading hides both toolbars with black text and zero-alpha pixels; Escape and tray recovery restore the reader');

    const scrollChapter = async (index, offset) => {
      await js(`(() => {const h=document.querySelector('.text-reading-scroll'),a=h.querySelector('[data-chapter-index="${index}"]');h.scrollTop+=a.getBoundingClientRect().top-h.getBoundingClientRect().top+(${offset});h.dispatchEvent(new Event('scroll'))})()`);
      await settle();
    };
    const currentChapter = () => js('document.querySelector(".reading-book-info small").textContent');
    const selectFirst = async () => {
      await click('[aria-label=打开目录]');
      await click('.toc-list button');
      await until('!document.querySelector(".reading-busy") && !document.querySelector(".reader-drawer")', 'first chapter selected');
      await settle();
    };
    for (const [id, title] of [['txt', '翻页测试'], ['online', '在线测试']]) {
      await openBook(title); await selectFirst();
      await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"T",code:"KeyT",ctrlKey:true,shiftKey:true,bubbles:true}))'); await settle();
      await scrollChapter(0, 'a.offsetHeight-h.clientHeight*1.2');
      await until('Boolean(document.querySelector("[data-chapter-index=\\\"1\\\"]"))', 'next chapter joins the scroll document');
      await scrollChapter(0, 'a.offsetHeight-h.clientHeight*.4');
      assert.match(await currentChapter(), /第一章/, 'appending a chapter does not replace the current passage');
      const boundary = await js('(() => {const h=document.querySelector(".text-reading-scroll").getBoundingClientRect(),a=document.querySelector("[data-chapter-index=\\\"1\\\"]").getBoundingClientRect();return a.top>h.top&&a.top<h.bottom})()');
      assert.equal(boundary, true, 'the end of one chapter and the next heading share the viewport');
      fixture.setBackgroundColor('#ffffff'); await settle();
      await screenshot(`reader-continuous-${id}-transparent.png`);
      fixture.setBackgroundColor('#00000000');
      const point = await js('(() => {const r=document.querySelector(".text-reading-scroll").getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()');
      fixture.webContents.sendInputEvent({type: 'mouseWheel', ...point, deltaY: -700, deltaX: 0, canScroll: true});
      await until('document.querySelector(".reading-book-info small").textContent.includes("第二章")', 'wheel crosses into next chapter in transparency');
      await scrollChapter(1, 'a.offsetHeight-h.clientHeight*1.2');
      await until('Boolean(document.querySelector("[data-chapter-index=\\\"2\\\"]"))', 'third chapter is appended');
      await scrollChapter(2, 'h.clientHeight*4');
      await until('!document.querySelector("[data-chapter-index=\\\"0\\\"]") && !document.querySelector("[data-chapter-index=\\\"1\\\"]")', 'distant chapters are released');
      assert.match(await currentChapter(), /第三章/);
      // Reloading the previous chapter must leave the current chapter at the same screen coordinate.
      await scrollChapter(2, '100');
      await until('Boolean(document.querySelector("[data-chapter-index=\\\"1\\\"]"))', 'scrolling back prepends previous chapter');
      const anchored = await js('document.querySelector("[data-chapter-index=\\\"2\\\"]").getBoundingClientRect().top-document.querySelector(".text-reading-scroll").getBoundingClientRect().top');
      assert.ok(Math.abs(anchored + 100) < 2, 'prepending preserves the visible passage');
      fixture.webContents.sendInputEvent({type: 'mouseWheel', ...point, deltaY: 700, deltaX: 0, canScroll: true});
      await until('document.querySelector(".reading-book-info small").textContent.includes("第二章")', 'wheel scrolls back into previous chapter');
      await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await settle();
      await scrollChapter(1, 'a.offsetHeight-h.clientHeight*.4');
      const beforeRestore = await js('document.querySelector("[data-chapter-index=\\\"1\\\"]").getBoundingClientRect().top-document.querySelector(".text-reading-scroll").getBoundingClientRect().top');
      await click('[aria-label=添加或取消书签]');
      await click('[aria-label=返回书架]');
      assert.equal(books.find(b => b.id === id).progress.chapter, 1);
      assert.ok(books.find(b => b.id === id).progress.scrollFraction > .8, 'near-boundary position has an accurate scroll fraction');
      await openBook(title);
      const restored = await js('document.querySelector("[data-chapter-index=\\\"1\\\"]").getBoundingClientRect().top-document.querySelector(".text-reading-scroll").getBoundingClientRect().top');
      assert.ok(Math.abs(restored - beforeRestore) < 2, `reopening restores even the last screen before the next chapter: ${beforeRestore} -> ${restored}; ${JSON.stringify(books.find(b => b.id === id).progress)}`);
      await selectFirst();
      await click('[aria-label=查看书签]');
      await js('Array.from(document.querySelectorAll(".reader-drawer .toc-list button")).find(b=>b.textContent.includes("第二章")).click()');
      await until('!document.querySelector(".reader-drawer") && !document.querySelector(".reading-busy")', 'bookmark restores continuation position'); await settle();
      assert.match(await currentChapter(), /第二章/);
      const bookmarkTop = await js('document.querySelector("[data-chapter-index=\\\"1\\\"]").getBoundingClientRect().top-document.querySelector(".text-reading-scroll").getBoundingClientRect().top');
      assert.ok(Math.abs(bookmarkTop - beforeRestore) < 2, 'bookmarks preserve near-boundary reading positions');
      await selectFirst();
      if (id === 'online') {
        failedChapters.add('online:1');
        await scrollChapter(0, 'a.offsetHeight-h.clientHeight*1.2');
        await until('Boolean(document.querySelector(".reading-continuation button"))', 'online continuation offers retry');
        assert.match(await currentChapter(), /第一章/);
        const attempts = chapterRequests.filter(key => key === 'online:1').length;
        await scrollChapter(0, 'a.offsetHeight-h.clientHeight');
        await settle();
        assert.equal(chapterRequests.filter(key => key === 'online:1').length, attempts, 'scrolling does not repeatedly request a failed chapter');
        failedChapters.delete('online:1');
        await click('.reading-continuation button');
        await until('Boolean(document.querySelector("[data-chapter-index=\\\"1\\\"]")) && !document.querySelector(".reading-continuation button")', 'retry joins the next chapter without losing current text');
      }
      await click('[aria-label=返回书架]');
    }
    record('TXT and online novels scroll continuously in transparency, preserve position on prepend, reopen and bookmarks, release distant chapters and recover from chapter load errors');

    await openBook('EPUB 测试');
    if (await js('document.querySelector(".reader-mode").getAttribute("aria-pressed")==="false"')) { await click('.reader-mode'); await settle(); }
    await until('Boolean(document.querySelector(".epub-host iframe")?.contentDocument?.querySelector("h1"))', 'EPUB renders');
    const epubClick = async direction => {
      await js(`(() => {const f=document.querySelector('.epub-host iframe'),d=f.contentDocument,r=f.getBoundingClientRect(),h=document.querySelector('.epub-host').getBoundingClientRect(),x=h.left+h.width*${direction > 0 ? '.8' : '.2'}-r.left,y=100,t=d.elementFromPoint(x,y)||d.body;t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y}));t.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y,button:0}))})()`);
      await settle();
    };
    await epubClick(1);
    await until(`document.querySelector('.epub-container').scrollLeft > 0`, 'EPUB page advances');
    const nextPage = await js('document.querySelector(".epub-container").scrollLeft');
    await epubClick(-1);
    await until(`document.querySelector('.epub-container').scrollLeft < ${nextPage}`, 'EPUB left side goes back');
    await click('[aria-label=下一章]');
    await until('document.querySelector(".reading-book-info small").textContent.includes("第二章") && !document.querySelector(".reading-busy")', 'EPUB next chapter');
    await click('[aria-label=上一章]');
    await until('document.querySelector(".reading-book-info small").textContent.includes("第一章") && !document.querySelector(".reading-busy")', 'EPUB previous chapter');
    await click('.reader-mode'); await settle();
    await until('document.querySelector(".epub-container").scrollHeight > document.querySelector(".epub-container").clientHeight', 'EPUB vertical scroll');
    await screenshot('reader-epub-scroll.png');
    const scrollBefore = await js('document.querySelector(".epub-container").scrollTop');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",code:"ArrowDown",bubbles:true}))'); await settle();
    assert.equal(await js('document.querySelector(".epub-container").scrollTop') > scrollBefore, true, 'EPUB scroll shortcuts use the scroll container');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"T",code:"KeyT",ctrlKey:true,shiftKey:true,bubbles:true}))'); await settle();
    assert.equal(await js('getComputedStyle(document.querySelector(".epub-host iframe").contentDocument.body).color'), 'rgb(0, 0, 0)');
    assert.equal(await js('getComputedStyle(document.querySelector(".epub-host iframe").contentDocument.querySelector("#colored-text")).color'), 'rgb(0, 0, 0)', 'transparent mode overrides author-defined important text colors');
    assert.equal(await js('getComputedStyle(document.querySelector(".epub-host iframe").contentDocument.documentElement).backgroundColor'), 'rgba(0, 0, 0, 0)');
    await js('(() => {const h=document.querySelector(".epub-container"),f=document.querySelector(".epub-host iframe");h.scrollTop+=f.getBoundingClientRect().bottom-h.getBoundingClientRect().bottom-250})()');
    await until('Array.from(document.querySelectorAll(".epub-host iframe")).some(f=>f.contentDocument?.querySelector("h1")?.textContent.includes("第二章"))', 'EPUB preloads the next chapter near the end');
    await js('(() => {const h=document.querySelector(".epub-container"),f=Array.from(h.querySelectorAll("iframe")).find(f=>f.contentDocument?.querySelector("h1")?.textContent.includes("第二章"));h.scrollTop+=f.getBoundingClientRect().top-h.getBoundingClientRect().top-h.clientHeight*.4})()');
    await settle();
    fixture.setBackgroundColor('#ffffff'); await settle();
    await screenshot('reader-continuous-epub-transparent.png');
    fixture.setBackgroundColor('#00000000');
    const epubPoint = await js('(() => {const r=document.querySelector(".epub-host").getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()');
    fixture.webContents.sendInputEvent({type: 'mouseWheel', ...epubPoint, deltaY: -700, deltaX: 0, canScroll: true});
    await until('document.querySelector(".reading-book-info small").textContent.includes("第二章")', 'EPUB wheel crosses chapter boundary in transparency');
    assert.equal(await js('Array.from(document.querySelectorAll(".epub-host iframe")).filter(f=>f.contentDocument?.body).every(f=>getComputedStyle(f.contentDocument.body).color==="rgb(0, 0, 0)")'), true, 'new EPUB chapters inherit transparent black text');
    fixture.webContents.sendInputEvent({type: 'mouseWheel', ...epubPoint, deltaY: 1000, deltaX: 0, canScroll: true});
    await until('document.querySelector(".reading-book-info small").textContent.includes("第一章")', 'EPUB wheel returns to previous chapter');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await settle();
    assert.equal(await js('getComputedStyle(document.querySelector(".epub-host iframe").contentDocument.querySelector("#colored-text")).color'), 'rgb(190, 40, 40)', 'leaving transparency restores original EPUB inline colors');
    assert.equal(await js('Boolean(document.querySelector(".reading-alert"))'), false);
    record('EPUB supports body-click page turns, chapter navigation and continuous scrolling in both directions with transparent styling on newly loaded chapters');
  } catch (error) {
    console.error('Reader console:', JSON.stringify(rendererMessages));
    await screenshot('reader-layout-failure.png');
    console.error(await js('JSON.stringify({selection:getSelection().toString(),page:document.querySelector(".reading-page-number")?.textContent,focused:document.activeElement?.outerHTML.slice(0,180),host:document.querySelector(".text-reading-scroll")?.getBoundingClientRect().toJSON(),overlays:document.querySelectorAll(".reader-overlay").length,epub:document.querySelector(".epub-host")?.innerHTML.slice(0,2000),continuation:document.querySelector(".reading-continuation")?.textContent})'));
    throw error;
  } finally {
    fixture.destroy(); ipcMain.removeHandler('moyu:test-reader-layout');
  }
};
