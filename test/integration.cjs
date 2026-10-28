'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const {BrowserWindow, session} = require('electron');
const {Store} = require('../core.cjs');

async function until(check, label, timeout=12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timeout: ${label}`);
}
function wav() {
  const samples = 8000, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF',0); buffer.writeUInt32LE(buffer.length - 8,4); buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16); buffer.writeUInt16LE(1,20); buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(8000,24); buffer.writeUInt32LE(16000,28); buffer.writeUInt16LE(2,32); buffer.writeUInt16LE(16,34);
  buffer.write('data',36); buffer.writeUInt32LE(samples * 2,40);
  return buffer;
}
exports.run = async ({win, store, uiState, perform, navigate, getWeb, browserSession, dataDirectory, hideWindow, restoreWindow, updateHoverVisibility, getTray, getEdge}) => {
  const passed = [];
  const requests = [];
  const record = label => { passed.push(label); console.log(`PASS ${label}`); };
  const server = http.createServer((req,res) => {
    const request = {url: req.url, method: req.method, headers: req.headers, body: ''};
    requests.push(request);
    if (req.method === 'POST') {
      req.on('data', chunk => { request.body += chunk; });
      req.on('end', () => {
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(`<!doctype html><title>Fixture ${req.url}</title><h1>Form received</h1>`);
      });
      return;
    }
    if (req.url === '/audio.wav') { res.writeHead(200, {'Content-Type':'audio/wav'}); res.end(wav()); return; }
    if (req.url === '/failure') { req.socket.destroy(); return; }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Set-Cookie':'moyu_fixture=persistent; Max-Age=86400; SameSite=Lax; HttpOnly'});
    res.end(`<!doctype html><title>Fixture ${req.url}</title><h1>Embedded browser fixture</h1><a href="/two" id="next">Next page</a><audio loop src="/audio.wav"></audio>`);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = path.join(__dirname,'..','test-output'); fs.mkdirSync(output,{recursive:true});
  const shellJS = code => win.webContents.executeJavaScript(code, true);
  const fixtureJS = code => getWeb().webContents.executeJavaScript(code, true);
  try {
    if (process.argv.includes('--preview-home')) {
      await until(() => shellJS('Boolean(window.moyu && document.querySelectorAll(".site-button").length === 8)'), 'preview ready');
      // Only this temporary design preview has a taskbar button for UI tools.
      win.setSize(820,720); win.setSkipTaskbar(false); win.show(); win.focus();
      console.log('Design preview ready (temporary profile, closes after 45 seconds)');
      await new Promise(resolve => setTimeout(resolve,45000));
      return;
    }
    await require('./source-network.integration.cjs').run({record});
    await require('./source-rules.integration.cjs').run({record});
    await require('./reader-verification.integration.cjs').run({record});
    await require('./reader-layout.integration.cjs').run({record});
    await perform('panel', 'reader');
    await perform('opacity', .65);
    assert.equal((await shellJS('window.moyu.reader("presentation",{transparent:true})')).ok, true);
    // getBackgroundColor returns RGB; captured pixels verify the alpha channel.
    assert.equal(win.getBackgroundColor().toLowerCase(), '#000000');
    assert.equal(win.getOpacity(), 1, 'transparent reading keeps text fully opaque');
    await shellJS('document.documentElement.dataset.readerTransparent="true"; document.querySelector("#reader-panel").style.background="transparent"');
    await shellJS('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const transparentCapture = await win.webContents.capturePage();
    if (transparentCapture.toBitmap()[3] !== 0) {
      fs.writeFileSync(path.join(output, 'transparent-failure.png'), transparentCapture.toPNG());
      console.log('Transparency diagnostics:', await shellJS('JSON.stringify({elements:document.elementsFromPoint(0,0).map(e=>({tag:e.tagName,id:e.id,background:getComputedStyle(e).background,colorScheme:getComputedStyle(e).colorScheme})),reader:document.documentElement.dataset.readerTransparent})'));
    }
    assert.equal(transparentCapture.toBitmap()[3], 0, 'native reader window preserves transparent pixels');
    getTray().emit('click');
    await shellJS('document.documentElement.dataset.readerTransparent="false"; document.querySelector("#reader-panel").style.removeProperty("background")');
    assert.equal(win.getBackgroundColor().toLowerCase(), '#f5f7f6');
    assert.ok(Math.abs(win.getOpacity() - .65) < .01, 'tray recovery restores the normal opacity');
    await shellJS('window.moyu.reader("shortcut-capture",{active:true})');
    win.webContents.sendInputEvent({type:'keyDown', keyCode:'L', modifiers:['control']});
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(uiState().panel, 'reader', 'recording shortcuts suspends native browser commands');
    await shellJS('window.moyu.reader("shortcut-capture",{active:false})');
    win.webContents.sendInputEvent({type:'keyDown', keyCode:'L', modifiers:['control']});
    await until(() => uiState().panel === 'home', 'browser commands resume after shortcut recording');
    await perform('opacity', 1);
    record('native transparent reading uses a zero-alpha window background with solid text, tray recovery restores opacity, and shortcut recording releases browser commands correctly');
    await until(() => shellJS('Boolean(window.moyu && document.querySelectorAll(".site-button").length === 8)'), 'home ready');
    record('home renders with eight working site entries');
    assert.equal(await shellJS('document.querySelector("#address-form, #address, .bottom-bar")'), null);
    assert.equal(await shellJS('document.querySelector("#edge-hide-button").hidden'), true);
    record('single top toolbar has no address row or bottom navigation; side button is off by default');

    await shellJS(`document.querySelector('#home-address').value = ${JSON.stringify(origin + '/one')}; document.querySelector('#home-form').requestSubmit();`);
    await until(() => uiState().title === 'Fixture /one' && !uiState().loading, 'embedded page');
    assert.equal(uiState().panel, 'web');
    assert.equal(getWeb().getVisible(), true);
    assert.equal(getWeb().getBounds().y,38);
    assert.equal(getWeb().getBounds().height,win.getContentSize()[1] - 38);
    assert.equal(await fixtureJS('typeof require + "/" + typeof process + "/" + typeof window.moyu'), 'undefined/undefined/undefined');
    record('address form loads real sandboxed WebContentsView with no Node or IPC bridge');

    await fixtureJS('document.querySelector("#next").click()');
    await until(() => uiState().title === 'Fixture /two' && !uiState().loading, 'second page');
    assert.equal(uiState().canBack,true);
    await shellJS('document.querySelector("#back").click()'); await until(() => uiState().url === origin + '/one' && !uiState().loading,'back');
    assert.equal(uiState().canForward,true);
    await shellJS('document.querySelector("#forward").click()'); await until(() => uiState().url === origin + '/two' && !uiState().loading,'forward');
    record('links, back and forward work inside the app');

    await perform('bookmark');
    assert.equal(uiState().bookmarks.length,1);
    await perform('panel','bookmarks');
    await until(() => shellJS('document.querySelectorAll("#bookmarks-list .saved-row").length === 1'),'bookmark renders');
    assert.equal(getWeb().getVisible(),false);
    await shellJS('document.querySelector("#bookmarks-list .saved-open").click()');
    await until(() => uiState().panel === 'web' && !uiState().loading,'open bookmark');
    record('bookmark saves, appears in the list and reopens the page');

    await perform('panel','home');
    await until(() => shellJS('document.querySelector("#continue-title").textContent === "Fixture /two"'),'continue card updates');
    await shellJS('document.querySelector("[data-category=video]").click()');
    assert.equal(await shellJS('document.querySelectorAll(".site-button").length'),2);
    await shellJS('document.querySelector("[data-category=recommend]").click()');
    assert.equal(await shellJS('document.querySelectorAll(".site-button").length'),8);
    await shellJS('document.querySelector("#home-continue").click()');
    await until(() => uiState().panel === 'web','continue card opens');
    record('new home category filters and continue-last-page card work');

    const embedded = getWeb();
    const originalContents = embedded.webContents;
    const windowsBefore = BrowserWindow.getAllWindows().length;
    await fixtureJS('document.querySelector("#next").target = "_blank"; document.querySelector("#next").href = "/blank"; document.querySelector("#next").click()');
    await until(() => uiState().title === 'Fixture /blank' && !uiState().loading, 'blank-target link');
    assert.equal(getWeb(), embedded);
    assert.equal(BrowserWindow.getAllWindows().length, windowsBefore);
    await perform('back');
    await until(() => uiState().url === origin + '/two' && !uiState().loading, 'back from blank-target link');
    await perform('forward');
    await until(() => uiState().url === origin + '/blank' && !uiState().loading, 'forward to blank-target link');
    await fixtureJS(`window.open(${JSON.stringify(origin + '/popup')}, 'named-popup', 'width=600,height=740'); void 0`);
    await until(() => uiState().title === 'Fixture /popup' && !uiState().loading, 'window.open in current view');
    assert.equal(getWeb(), embedded);
    assert.equal(BrowserWindow.getAllWindows().length, windowsBefore);
    assert.equal(requests.find(r => r.url === '/popup').headers.referer, origin + '/blank');
    assert.equal(await fixtureJS('typeof require + "/" + typeof process + "/" + typeof window.moyu'), 'undefined/undefined/undefined');
    record('blank-target links and named window.open reuse the current sandboxed view with referrer and back/forward history');

    for (const multipart of [false, true]) {
      const target = multipart ? '/form-multipart' : '/form-urlencoded';
      await fixtureJS(`(() => {
        const form = document.createElement('form');
        form.method = 'POST'; form.target = '_blank'; form.action = ${JSON.stringify(target)};
        if (${multipart}) form.enctype = 'multipart/form-data';
        form.innerHTML = '<input name="message" value="hello world">';
        document.body.append(form); form.requestSubmit();
      })()`);
      await until(() => uiState().title === 'Fixture ' + target && !uiState().loading, 'blank-target POST form');
      const submitted = requests.find(r => r.url === target);
      assert.equal(submitted.method, 'POST');
      if (multipart) {
        assert.match(submitted.headers['content-type'], /^multipart\/form-data; boundary=.+/);
        assert.match(submitted.body, /name="message"\r\n\r\nhello world/);
      } else {
        assert.match(submitted.headers['content-type'], /^application\/x-www-form-urlencoded/);
        assert.equal(submitted.body, 'message=hello+world');
      }
      assert.equal(getWeb(), embedded);
      assert.equal(BrowserWindow.getAllWindows().length, windowsBefore);
    }
    record('blank-target URL-encoded and multipart POST forms keep their submitted data in the current window');

    const safePage = uiState().url;
    for (const url of ['about:blank', 'javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,unsafe']) {
      await fixtureJS(`window.open(${JSON.stringify(url)}); void 0`);
    }
    assert.equal(uiState().url, safePage);
    assert.equal(BrowserWindow.getAllWindows().length, windowsBefore);
    await assert.rejects(navigate('javascript:alert(1)'));
    await assert.rejects(navigate('file:///C:/Windows/win.ini'));
    record('empty and unsafe popup URLs cannot open windows or replace the current page');

    const verificationSession = session.fromPartition('persist:moyu-test-verification');
    verificationSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await navigate(origin + '/verification', {webSession: verificationSession});
    await until(() => uiState().title === 'Fixture /verification' && !uiState().loading, 'embedded verification');
    assert.equal(originalContents.isDestroyed(), true);
    assert.equal(getWeb().webContents.session, verificationSession);
    assert.notEqual(getWeb().webContents.session, browserSession);
    await fixtureJS(`window.open(${JSON.stringify(origin + '/verification-next')}); void 0`);
    await until(() => uiState().title === 'Fixture /verification-next' && !uiState().loading, 'verification popup stays embedded');
    assert.equal(getWeb().webContents.session, verificationSession);
    assert.equal(BrowserWindow.getAllWindows().length, windowsBefore);
    await perform('panel', 'reader');
    assert.equal(uiState().panel, 'reader');
    await navigate(origin + '/two');
    await until(() => uiState().title === 'Fixture /two' && !uiState().loading, 'return to normal browser session');
    assert.equal(getWeb().webContents.session, browserSession);
    record('verification pages stay in the same native window, keep their isolated session, and allow returning to the reader and normal browsing');

    await perform('panel','settings');
    await shellJS('document.querySelector("#opacity").focus()');
    for (const keyCode of ['Home', ...Array(7).fill('Right')]) {
      win.webContents.sendInputEvent({type: 'keyDown', keyCode});
      win.webContents.sendInputEvent({type: 'keyUp', keyCode});
      await shellJS('new Promise(resolve => requestAnimationFrame(resolve))');
    }
    await until(() => uiState().opacity === .65,'opacity');
    assert.ok(Math.abs(win.getOpacity() - .65) < .02);
    await perform('zoom',1.2); assert.ok(Math.abs(getWeb().webContents.getZoomFactor() - 1.2) < .001);
    const topChange = once(win, 'always-on-top-changed');
    await perform('pin');
    assert.equal((await topChange)[1], true);
    await perform('mobile'); assert.match(getWeb().webContents.getUserAgent(),/Mobile/);
    await until(() => !uiState().loading,'mobile reload');
    const saved = new Store(dataDirectory).value;
    assert.equal(saved.opacity,.65); assert.equal(saved.zoom,1.2); assert.equal(saved.mobile,true);
    assert.equal(saved.bookmarks.length,1); assert.ok(saved.history.length >= 2);
    await perform('opacity',1); await perform('mobile'); await perform('pin');
    await perform('theme');
    await until(() => shellJS('document.documentElement.dataset.theme === "dark"'),'dark theme');
    await perform('theme'); await perform('panel','web');
    await until(() => !uiState().loading,'settings restored');
    record('real window opacity, zoom, pin, mobile UA, theme and settings persist');

    const originalBounds = win.getBounds();
    if (process.platform === 'win32') {
      assert.equal(win.isWindowMessageHooked(0x0231),true);
      assert.equal(win.isWindowMessageHooked(0x0232),true);
    }
    await perform('hover-hide',true);
    for (const edge of ['right','bottom','bottom-right','left','top','top-left','top-right','bottom-left']) {
      const before = win.getBounds();
      const center = {x:before.x + before.width / 2,y:before.y + before.height / 2};
      updateHoverVisibility(center);
      const next = {...before};
      if (edge.includes('right')) next.width += 20;
      if (edge.includes('bottom')) next.height += 20;
      if (edge.includes('left')) { next.x -= 20; next.width += 20; }
      if (edge.includes('top')) { next.y -= 20; next.height += 20; }
      const outsideSizingPoint = {
        x:edge.includes('left') ? next.x - 4 : edge.includes('right') ? next.x + next.width + 4 : center.x,
        y:edge.includes('top') ? next.y - 4 : edge.includes('bottom') ? next.y + next.height + 4 : center.y,
      };
      // Deliver the real Electron resize lifecycle around an actual bounds change.
      win.emit('will-resize',{preventDefault() {}},next,{edge});
      updateHoverVisibility(outsideSizingPoint);
      assert.equal(uiState().hidden,false,`${edge}: pointer outside during resize`);
      win.setBounds(next);
      updateHoverVisibility(outsideSizingPoint);
      assert.equal(win.isVisible(),true,`${edge}: enlargement stays visible`);
      win.emit('resized');
      updateHoverVisibility(outsideSizingPoint);
      assert.equal(uiState().hidden,false,`${edge}: border release stays visible`);
    }
    // Entry after resizing arms normal leave-to-tray behavior again.
    const afterResize = win.getBounds();
    updateHoverVisibility({x:afterResize.x + 100,y:afterResize.y + 100});
    const farOutside = {x:afterResize.x - 150,y:afterResize.y + 100};
    updateHoverVisibility(farOutside);
    assert.equal(uiState().hidden,false);
    await new Promise(resolve => setTimeout(resolve,uiState().hoverHideDelayMs + 50));
    updateHoverVisibility(farOutside);
    assert.equal(uiState().hidden,true);
    await perform('hover-hide',false);
    getTray().emit('click');
    win.setBounds(originalBounds);
    record('all eight resize edges stay visible during outward dragging and border release; normal mouse exit works again after entry');

    const rect = win.getBounds();
    const inside = {x:rect.x + 120, y:rect.y + 120};
    const outside = {x:rect.x - 150, y:rect.y + 120};
    const nearOutside = {x:rect.x - 5, y:rect.y + 120};
    await perform('opacity',.65);
    await perform('edge-hide',true);
    await perform('hover-hide',true);
    updateHoverVisibility(inside);
    assert.equal(uiState().hidden,false);
    assert.ok(Math.abs(win.getOpacity() - .65) < .02);
    await fixtureJS('document.querySelector("audio").play()');
    updateHoverVisibility({x:rect.x + 100,y:rect.y + 15});
    assert.equal(uiState().hidden,false);
    updateHoverVisibility(nearOutside);
    assert.equal(uiState().hidden,false);
    updateHoverVisibility(outside);
    assert.equal(uiState().hidden,false);
    await new Promise(resolve => setTimeout(resolve,uiState().hoverHideDelayMs + 50));
    updateHoverVisibility(outside);
    assert.equal(uiState().hidden,true);
    assert.equal(win.isVisible(),false);
    assert.equal(getEdge()?.isVisible() || false,false);
    assert.deepEqual(win.getBounds(),rect);
    await until(async () => await fixtureJS('document.querySelector("audio").paused'),'hover exit pauses media');
    // Returning to the former rectangle must never reopen the hidden window.
    updateHoverVisibility(inside);
    assert.equal(win.isVisible(),false);
    assert.equal(uiState().hidden,true);
    assert.equal(await fixtureJS('document.querySelector("audio").paused'),true);
    getTray().emit('click');
    await until(() => win.isVisible() && !uiState().hidden,'tray click restores');
    assert.ok(Math.abs(win.getOpacity() - .65) < .02);
    await until(async () => !(await fixtureJS('document.querySelector("audio").paused')),'tray click resumes media');
    // The pointer is still at the tray after a click: wait for entry first.
    updateHoverVisibility(outside);
    assert.equal(uiState().hidden,false);
    updateHoverVisibility(inside);
    updateHoverVisibility(outside);
    assert.equal(uiState().hidden,false);
    await new Promise(resolve => setTimeout(resolve,uiState().hoverHideDelayMs + 50));
    updateHoverVisibility(outside);
    assert.equal(uiState().hidden,true);
    await perform('hover-hide',false);
    getTray().emit('click');
    await until(() => win.isVisible(),'tray restores with auto-hide disabled');
    updateHoverVisibility(inside); updateHoverVisibility(outside);
    assert.equal(uiState().hidden,false);
    assert.equal(new Store(dataDirectory).value.hoverHide,false);
    await perform('opacity',1);
    record('mouse exit hides to tray, returning cannot reopen it, and tray click restores opacity and media without immediate rehiding');

    await perform('edge-hide',false);
    hideWindow();
    assert.equal(getEdge()?.isVisible() || false,false);
    restoreWindow();
    await perform('panel','settings');
    await shellJS('document.querySelector("#edge-hide-setting").checked = true; document.querySelector("#edge-hide-setting").dispatchEvent(new Event("change"))');
    await until(() => uiState().edgeHide,'side option enabled');
    await until(() => shellJS('!document.querySelector("#edge-hide-button").hidden'),'side button appears');
    assert.equal(new Store(dataDirectory).value.edgeHide,true);
    await perform('panel','web');
    record('side hiding is opt-in, controlled from settings and persisted');

    await fixtureJS('document.querySelector("audio").play()');
    await until(async () => !(await fixtureJS('document.querySelector("audio").paused')),'audio plays');
    hideWindow();
    assert.equal(win.isVisible(),false); assert.equal(uiState().hidden,true);
    await until(async () => await fixtureJS('document.querySelector("audio").paused'),'audio pauses');
    await until(() => getEdge()?.isVisible(),'edge handle visible');
    const edge = getEdge();
    await until(() => !edge.webContents.isLoading(),'edge ready');
    await edge.webContents.executeJavaScript('document.querySelector("button").click()',true);
    await until(() => win.isVisible() && !uiState().hidden,'edge restores');
    await until(async () => !(await fixtureJS('document.querySelector("audio").paused')),'audio resumes');
    await fixtureJS('document.querySelector("audio").pause()');
    hideWindow(); restoreWindow();
    await until(async () => await fixtureJS('document.querySelector("audio").paused'),'manually paused remains paused');
    record('edge handle restores hidden window and only previously playing media resumes');
    await perform('edge-hide',false);
    await until(() => shellJS('document.querySelector("#edge-hide-button").hidden'),'side button disappears');

    await browserSession.cookies.flushStore();
    const cookies = await browserSession.cookies.get({url:origin});
    assert.ok(cookies.some(c => c.name === 'moyu_fixture' && c.value === 'persistent' && !c.session));
    record('persistent browser cookie is stored in the isolated profile');

    await require('./media.integration.cjs').run({win, perform, navigate, getWeb, hideWindow, restoreWindow, record, wav});

    await navigate(origin + '/failure');
    await until(() => Boolean(uiState().error),'network failure');
    assert.equal(getWeb().getVisible(),false);
    await until(() => shellJS('!document.querySelector("#web-message").hidden'),'failure message visible');
    await navigate(origin + '/recovered');
    await until(() => uiState().title === 'Fixture /recovered' && !uiState().loading,'network recovery');
    assert.equal(uiState().error,''); assert.equal(getWeb().getVisible(),true);
    record('network errors are visible and the browser can recover');

    await perform('pause-on-hide', false);
    await fixtureJS('document.querySelector("audio").play(); window.onbeforeunload = event => { event.preventDefault(); event.returnValue = "stay"; }; void 0');
    const playingContents = getWeb().webContents;
    await perform('panel', 'home');
    assert.equal(await fixtureJS('document.querySelector("audio").paused'), false);
    await until(() => shellJS('!document.querySelector("#close-page").hidden && !document.querySelector("#resume-button").hidden'), 'close control on home');
    for (const theme of ['light', 'dark']) {
      if (uiState().theme !== theme) await perform('theme');
      await until(() => shellJS(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`), 'toolbar theme');
      for (const size of [[420,420],[820,720]]) {
        win.setSize(...size);
        await perform('edge-hide', true);
        for (const nextPanel of ['home', 'web', 'reader']) {
          await perform('panel', nextPanel);
          await until(() => shellJS(`document.body.dataset.panel === ${JSON.stringify(nextPanel)}`), 'toolbar panel');
          assert.equal(await shellJS(`Array.from(document.querySelectorAll('.titlebar button')).filter(b => b.offsetParent !== null).every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width >= 24 && r.height >= 24; })`), true, `${theme} ${size[0]} ${nextPanel}: toolbar controls remain reachable`);
        }
        await perform('panel', 'home');
        const screenshot = await win.webContents.capturePage();
        fs.writeFileSync(path.join(output, `close-page-${theme}-${size[0]}.png`), screenshot.toPNG());
      }
    }
    await perform('edge-hide', false);
    await perform('theme');
    const preservedHistory = structuredClone(uiState().history);
    await shellJS('document.querySelector("#close-page").click()');
    await until(() => getWeb() === null && playingContents.isDestroyed() && !uiState().hasPage, 'close playing page from home');
    assert.equal(uiState().panel, 'home');
    assert.equal(uiState().url, '');
    assert.equal(uiState().title, '');
    assert.equal(uiState().loading, false);
    assert.equal(uiState().error, '');
    assert.equal(uiState().canBack, false);
    assert.equal(uiState().canForward, false);
    assert.equal(uiState().webFullscreen, false);
    assert.deepEqual(uiState().history, preservedHistory);
    assert.equal(uiState().bookmarks.length, 1);
    assert.ok((await browserSession.cookies.get({url: origin})).some(c => c.name === 'moyu_fixture'));
    await until(() => shellJS('document.querySelector("#resume-button").hidden && document.querySelector("#close-page").hidden && document.querySelector("#reload").disabled && document.querySelector("#home-continue").title.includes("重新打开")'), 'closed page controls reset');
    assert.equal(win.isVisible(), true);
    record('close-page control fits compact and regular windows in both themes and destroys a playing page even when beforeunload tries to prevent closing; history, bookmarks and login cookies survive');

    await shellJS('document.querySelector("#home-continue").click()');
    await until(() => uiState().title === 'Fixture /recovered' && !uiState().loading, 'explicitly reopen closed page');
    assert.notEqual(getWeb().webContents, playingContents);
    assert.equal(uiState().canBack, false);
    assert.equal(await fixtureJS('document.querySelector("audio").paused'), true);
    await perform('panel', 'reader');
    await until(() => shellJS('Boolean(document.querySelector("input[aria-label=搜索书架]"))'), 'reader remains available');
    await shellJS('const input = document.querySelector("input[aria-label=搜索书架]"); input.value = "阅读状态保留"; input.dispatchEvent(new Event("input", {bubbles:true}))');
    const readerContents = getWeb().webContents;
    win.webContents.sendInputEvent({type: 'keyDown', keyCode: 'W', modifiers: ['control']});
    win.webContents.sendInputEvent({type: 'keyUp', keyCode: 'W', modifiers: ['control']});
    await until(() => !uiState().hasPage && readerContents.isDestroyed(), 'Ctrl+W from reader');
    assert.equal(uiState().panel, 'reader');
    assert.equal(await shellJS('document.querySelector("input[aria-label=搜索书架]").value'), '阅读状态保留');
    await perform('close-page');
    assert.equal(uiState().panel, 'reader');
    assert.equal(getWeb(), null);
    record('closed pages reopen only on request with fresh navigation state; Ctrl+W closes background browsing while preserving the reader and is safe to repeat');

    await navigate(origin + '/close-fullscreen');
    await until(() => uiState().title === 'Fixture /close-fullscreen' && !uiState().loading, 'page to close in fullscreen');
    await fixtureJS('document.documentElement.requestFullscreen()');
    await until(() => uiState().webFullscreen, 'page enters content fullscreen');
    const fullscreenContents = getWeb().webContents;
    fullscreenContents.sendInputEvent({type: 'keyDown', keyCode: 'W', modifiers: ['control']});
    await until(() => !uiState().hasPage && fullscreenContents.isDestroyed(), 'Ctrl+W from embedded page');
    assert.equal(uiState().panel, 'home');
    assert.equal(uiState().webFullscreen, false);
    assert.equal(win.isFullScreen(), false);
    await perform('pause-on-hide', true);
    record('Ctrl+W works in the embedded webpage and closing fullscreen content returns to home with clean fullscreen state');

    await perform('panel','history');
    await until(() => shellJS('document.querySelectorAll("#history-list .saved-row").length > 0'),'history ready');
    await shellJS('document.querySelector("#clear-history").click()');
    assert.equal(await shellJS('document.querySelector("#confirm-dialog").open'),true);
    await shellJS('document.querySelector("#cancel-clear").click()'); assert.ok(uiState().history.length > 0);
    await shellJS('document.querySelector("#clear-history").click(); document.querySelector("#confirm-clear").click()');
    await until(() => uiState().history.length === 0,'clear history');
    assert.equal(uiState().bookmarks.length,1);
    record('history clear has a cancelable confirmation and preserves bookmarks');

    for (const size of [[420,420],[560,620],[820,720]]) {
      win.setSize(...size); await perform('panel','home');
      assert.equal(await shellJS('document.documentElement.scrollWidth <= window.innerWidth'),true);
    }
    record('compact and regular window sizes avoid horizontal page overflow');
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed,profile:dataDirectory},null,2));
    console.log(`Integration complete: ${passed.length} checks`);
  } catch (error) {
    console.error('Fixture state at failure:', JSON.stringify(uiState()));
    console.error('Shell state at failure:', await shellJS('JSON.stringify({toast:document.querySelector("#toast").textContent, panel:document.body.dataset.panel, error:window.__testError})'));
    throw error;
  } finally { server.closeAllConnections(); server.close(); }
};
