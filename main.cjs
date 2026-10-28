'use strict';

const {app, BrowserWindow, WebContentsView, ipcMain, globalShortcut, Menu, Tray, nativeImage, screen, session, dialog, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const JSON5 = require('json5');
const {pathToFileURL} = require('node:url');
const {Store, normalizeInput, webUrl, safeBounds} = require('./core.cjs');
const {ReaderLibrary, requestPage, chromiumFetch, readerUserAgent, sourceImportUrl, checkedUrl, MAX_BOOK} = require('./reader.cjs');
const {runLegado} = require('./legado.cjs');
const {createOutsideClickMonitor} = require('./outside-click.cjs');
const {MediaController} = require('./media-control.cjs');
const {shortcutAccelerator} = require('./reader-shortcuts.cjs');
const {resolveDataDirectory} = require('./app-paths.cjs');

const smokeTest = process.argv.includes('--smoke-test');
const dataDirectory = smokeTest ? fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-test-'))
  : resolveDataDirectory({isPackaged: app.isPackaged, distribution: require('./package.json').moyuDistribution,
    sourceRoot: __dirname, executablePath: process.execPath, appData: app.getPath('appData')});
app.setName('沫鱼');
app.setPath('userData', path.join(dataDirectory, 'profile'));
app.setAppUserModelId('local.moyu.browser');
const store = new Store(dataDirectory);
const readerLibrary = new ReaderLibrary(dataDirectory);
const readerSessions = new Map(), readerRequests = new Map();
const shellFile = path.join(__dirname, 'renderer-dist', 'index.html');
const devServerUrl = !app.isPackaged && process.env.MOYU_DEV_SERVER_URL === 'http://127.0.0.1:5173/'
  ? process.env.MOYU_DEV_SERVER_URL : null;
const shellUrl = devServerUrl || pathToFileURL(shellFile).href;
const webScrollbarCss = fs.readFileSync(path.join(__dirname, 'web-scrollbars.css'), 'utf8');
const partition = 'persist:moyu-web';
let win, web, tray, edgeHandle;
let panel = 'home';
let quitting = false;
let readerTransparent = false, readerCapturing = false, readerRecoveryAccelerator = '';

function setReaderPresentation(transparent) {
  const next = Boolean(transparent && panel === 'reader');
  if (next === readerTransparent) return {transparent: next};
  if (next && !smokeTest) {
    const accelerator = shortcutAccelerator(readerLibrary.value.preferences.shortcuts.toggleTransparent);
    if (!globalShortcut.register(accelerator, () => { recoverReaderPresentation(); restoreWindow(); })) {
      throw new Error('透明切换快捷键已被其他程序占用，请在阅读设置中更换后重试');
    }
    readerRecoveryAccelerator = accelerator;
  }
  if (!next && readerRecoveryAccelerator) { globalShortcut.unregister(readerRecoveryAccelerator); readerRecoveryAccelerator = ''; }
  readerTransparent = next;
  const color = next ? '#00000000' : '#f5f7f6';
  win.setBackgroundColor(color);
  win.setOpacity(next ? 1 : store.value.opacity);
  return {transparent: next};
}
function recoverReaderPresentation() {
  if (!readerTransparent) return;
  setReaderPresentation(false);
  if (!win.webContents.isDestroyed()) win.webContents.send('moyu:reader-recover');
}
let hidden = false;
let normalBounds;
let current = {url: '', title: '', loading: false, error: '', canBack: false, canForward: false};
let mediaController;
let shortcutAvailable = true;
let notice = '';
let browserSession;
let hoverArmed = false;
let hoverExitStartedAt = null;
let restoredAt = 0;
let outsideClickStatus = 'stopped';
const hoverHideDelayMs = 2000;
const hoverHideDistance = 100;
let pointerTimer;
let hoverSuspended = 0;
let cachedApplicationIcon;
const manipulatingWindows = new Set();
const htmlFullscreenContents = new Set();
const outsideClicks = createOutsideClickMonitor(handleOutsideMouseDown, (status, detail) => {
  outsideClickStatus = status;
  if (status === 'failed') log(`outside-click-failed ${detail}`);
  publish();
});

function preventDesktopFullscreen(target) {
  target.setFullScreenable(false);
  target.on('enter-full-screen', () => {
    // HTML fullscreen belongs to the content viewport, never the desktop.
    target.setFullScreen(false);
  });
}

function syncContentFullscreen(contents, active) {
  if (active) htmlFullscreenContents.add(contents);
  else htmlFullscreenContents.delete(contents);
  if (quitting) return;
  layout();
  publish();
}

async function exitContentFullscreen(contents) {
  if (!contents || contents.isDestroyed()) return;
  try {
    await contents.executeJavaScript(`(async () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      }
    })()`, true);
    syncContentFullscreen(contents, false);
  } catch {}
}

async function toggleContentFullscreen(contents) {
  if (!contents || contents.isDestroyed()) return;
  try {
    await contents.executeJavaScript(`(async () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else {
        const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        if (request) await request.call(document.documentElement);
      }
    })()`, true);
  } catch {}
}

function protectWindowManipulation(target) {
  const begin = () => { manipulatingWindows.add(target); resetHoverTracking(); };
  const end = () => {
    if (manipulatingWindows.delete(target)) {
      // A sizing cursor can finish just outside the border. Re-arm on entry,
      // rather than immediately treating that release as a mouse exit.
      resetHoverTracking();
    }
  };
  if (process.platform === 'win32') {
    target.hookWindowMessage(0x0231, begin); // WM_ENTERSIZEMOVE
    target.hookWindowMessage(0x0232, end);   // WM_EXITSIZEMOVE
  }
  target.on('will-resize', begin);
  target.on('will-move', begin);
  target.on('resized', end);
  target.once('closed', end);
}

function log(message) {
  fs.appendFileSync(path.join(dataDirectory, 'app.log'), `${new Date().toISOString()} ${message}\n`);
}
function uiState() {
  const prefs = store.value;
  return {...current, panel, hidden, hasPage: Boolean(current.url), lastUrl: prefs.lastUrl,
    opacity: prefs.opacity, zoom: prefs.zoom, pinned: prefs.pinned, mobile: prefs.mobile,
    theme: prefs.theme, pauseOnHide: prefs.pauseOnHide,
    hoverHide: prefs.hoverHide, edgeHide: prefs.edgeHide,
    hoverHideDelayMs, hoverHideDistance, outsideClickStatus,
    bookmarks: prefs.bookmarks,
    history: prefs.history, shortcutAvailable, notice,
    bookmarked: prefs.bookmarks.some(item => item.url === current.url),
    maximized: Boolean(win?.isMaximized()),
    webFullscreen: Boolean(web && htmlFullscreenContents.has(web.webContents)), version: app.getVersion()};
}
function publish() {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('moyu:state', uiState());
}
function layout() {
  if (readerTransparent && panel !== 'reader') recoverReaderPresentation();
  if (panel !== 'reader') readerCapturing = false;
  if (!win || win.isDestroyed() || !web?.webContents || web.webContents.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  web.setBounds({x: 0, y: 38, width: Math.max(1, width), height: Math.max(1, height - 38)});
  web.setVisible(panel === 'web' && !hidden && !current.error);
}
function pointInWindow(point, target) {
  if (!target || target.isDestroyed() || !target.isVisible() || target.isMinimized()) return false;
  const rect = target.getBounds();
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}
function resetHoverTracking() { hoverArmed = false; hoverExitStartedAt = null; }
function applicationWindows() {
  return [win].filter(target => target && !target.isDestroyed() && target.isVisible() && !target.isMinimized());
}
function distanceFromWindow(point, target) {
  const rect = target.getBounds();
  return Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width),
    Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height));
}
function syncOutsideClickMonitor() {
  if (!smokeTest && !quitting && store.value.hoverHide && win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && !hidden) outsideClicks.start();
  else outsideClicks.stop();
}
function handleOutsideMouseDown(event) {
  if (!win || win.isDestroyed() || !store.value.hoverHide || hidden || win.isMinimized() || !win.isVisible()) return;
  if (!hoverArmed || hoverSuspended || manipulatingWindows.size || event.time < restoredAt || Date.now() - event.time > 1000) return;
  const windows = applicationWindows();
  // Native menus, owned dialogs and window borders may extend outside their bounds.
  // The helper reports the root owner, so their clicks still belong to this app.
  if (windows.some(target => {
    const handle = target.getNativeWindowHandle();
    const id = handle.length >= 8 ? handle.readBigUInt64LE().toString(16) : handle.readUInt32LE().toString(16);
    return id === event.window;
  })) return;
  const point = screen.screenToDipPoint({x: event.x, y: event.y});
  if (!windows.some(target => pointInWindow(point, target))) hideWindow({trayOnly: true});
}
function updateHoverVisibility(point = screen.getCursorScreenPoint()) {
  if (!win || win.isDestroyed() || hidden || win.isMinimized() || !win.isVisible()) { hoverExitStartedAt = null; return; }
  if (!store.value.hoverHide) { resetHoverTracking(); return; }
  if (manipulatingWindows.size || hoverSuspended) { hoverExitStartedAt = null; return; }
  const windows = applicationWindows();
  const inside = windows.some(target => pointInWindow(point, target));
  // A tray click opens the window while the pointer is still over the tray.
  // Arm only after it enters the app, so the restored window stays usable.
  if (inside) { hoverArmed = true; hoverExitStartedAt = null; return; }
  if (!hoverArmed || Math.min(...windows.map(target => distanceFromWindow(point, target))) <= hoverHideDistance) {
    hoverExitStartedAt = null; return;
  }
  const now = performance.now();
  if (hoverExitStartedAt === null) hoverExitStartedAt = now;
  else if (now - hoverExitStartedAt >= hoverHideDelayMs) hideWindow({trayOnly: true});
}
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: '显示窗口', click: restoreWindow},
    {label: store.value.edgeHide ? '隐藏到侧边' : '隐藏到托盘', click: hideWindow},
    {label: '鼠标移出收进托盘', type: 'checkbox', checked: store.value.hoverHide,
      click: item => void perform('hover-hide', item.checked)},
    {type: 'separator'}, {label: '退出沫鱼', click: () => { quitting = true; app.quit(); }},
  ]));
}
function shouldPauseMedia() {
  return store.value.pauseOnHide && (hidden || panel !== 'web' || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized());
}
function syncMedia() { return mediaController?.sync(); }
function showPanel(next) {
  if (!['home', 'web', 'bookmarks', 'history', 'settings', 'reader'].includes(next)) throw new Error('页面不存在');
  if (next === 'web' && !current.url) {
    if (store.value.lastUrl) return navigate(store.value.lastUrl);
    next = 'home';
  }
  panel = next;
  layout();
  publish();
  void syncMedia();
}
function syncNavigation() {
  if (!web?.webContents || web.webContents.isDestroyed()) return;
  current.canBack = web.webContents.navigationHistory.canGoBack();
  current.canForward = web.webContents.navigationHistory.canGoForward();
  publish();
}
function focusAddress() {
  if (hidden) restoreWindow();
  win.webContents.focus();
  win.webContents.send('moyu:focus-address');
}
function handleKeys(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (contents === win.webContents && panel === 'reader' && readerCapturing) return;
    const fullscreenTarget = contents === win.webContents
      ? (panel === 'web' ? web?.webContents : null) : contents;
    if (key === 'f11') {
      event.preventDefault();
      if (!input.isAutoRepeat) void toggleContentFullscreen(fullscreenTarget);
      return;
    }
    if (key === 'escape' && fullscreenTarget && htmlFullscreenContents.has(fullscreenTarget)) {
      event.preventDefault();
      void exitContentFullscreen(fullscreenTarget);
      return;
    }
    if (contents !== win.webContents && contents !== web?.webContents) return;
    if ((input.control || input.meta) && key === 'w') {
      event.preventDefault();
      if (!input.isAutoRepeat) void perform('close-page');
      return;
    }
    if ((input.control || input.meta) && key === 'l') { event.preventDefault(); focusAddress(); }
    if ((input.control || input.meta) && key === 'd' && panel !== 'reader') {
      event.preventDefault(); void perform('bookmark').catch(() => {});
    }
    if ((input.control || input.meta) && key === 'h') { event.preventDefault(); showPanel('history'); }
    if (key === 'f5' || ((input.control || input.meta) && key === 'r')) {
      event.preventDefault(); if (panel === 'web' && web) web.webContents.reload();
    }
    if (panel === 'web' && input.alt && key === 'arrowleft' && current.canBack) { event.preventDefault(); web.webContents.navigationHistory.goBack(); }
    if (panel === 'web' && input.alt && key === 'arrowright' && current.canForward) { event.preventDefault(); web.webContents.navigationHistory.goForward(); }
  });
}
function protect(contents) {
  // Every remote content process is sandboxed and has no preload/Node access.
  contents.on('enter-html-full-screen', () => syncContentFullscreen(contents, true));
  contents.on('leave-html-full-screen', () => syncContentFullscreen(contents, false));
  contents.on('did-navigate', () => syncContentFullscreen(contents, false));
  contents.on('render-process-gone', () => syncContentFullscreen(contents, false));
  contents.once('destroyed', () => syncContentFullscreen(contents, false));
  contents.on('dom-ready', () => {
    if (!contents.isDestroyed() && webUrl(contents.getURL())) {
      // User-origin CSS keeps website-specific rules from restoring wide arrows.
      contents.insertCSS(webScrollbarCss, {cssOrigin: 'user'}).catch(() => {});
    }
  });
  contents.on('will-navigate', (event, url) => { if (!webUrl(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!webUrl(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(details => {
    // Reuse the embedded page so target=_blank and window.open never create
    // a native window. Keep the originating session, referrer and form data.
    if (webUrl(details.url)) {
      const options = {webSession: contents.session, httpReferrer: details.referrer};
      if (details.postBody) {
        options.postData = details.postBody.data;
        const {contentType, boundary} = details.postBody;
        options.extraHeaders = `Content-Type: ${contentType}${boundary ? `; boundary=${boundary}` : ''}`;
      }
      void navigate(details.url, options);
    }
    return {action: 'deny'};
  });
}
function makeWebView(webSession) {
  web = new WebContentsView({webPreferences: {
    session: webSession, contextIsolation: true, nodeIntegration: false, sandbox: true,
    webviewTag: false, spellcheck: false, autoplayPolicy: 'document-user-activation-required',
    disableHtmlFullscreenWindowResize: true,
  }});
  web.setBackgroundColor('#ffffff');
  win.contentView.addChildView(web);
  const wc = web.webContents;
  mediaController = new MediaController(wc, shouldPauseMedia);
  // A detached or closed page must not update a newly opened page's state.
  const onCurrentPage = (event, listener) => wc.on(event, (...args) => {
    if (web?.webContents === wc) listener(...args);
  });
  protect(wc);
  handleKeys(wc);
  applyUserAgent();
  onCurrentPage('did-start-loading', () => { current.loading = true; publish(); });
  onCurrentPage('did-stop-loading', () => { current.loading = false; syncNavigation(); });
  onCurrentPage('did-navigate', (_event, url) => {
    current.url = url;
    current.error = '';
    store.visit(url, wc.getTitle());
    layout(); syncNavigation();
  });
  onCurrentPage('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) { current.url = url; store.visit(url, wc.getTitle()); syncNavigation(); }
  });
  onCurrentPage('page-title-updated', (_event, title) => {
    current.title = title;
    if (webUrl(current.url) && !current.error) store.visit(current.url, title);
    publish();
  });
  onCurrentPage('did-finish-load', () => {
    current.title = wc.getTitle();
    wc.setZoomFactor(store.value.zoom);
    if (webUrl(current.url) && !current.error) store.visit(current.url, current.title);
    void syncMedia();
    publish();
  });
  onCurrentPage('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (!mainFrame || code === -3) return;
    current.loading = false;
    current.error = `页面未能打开（${code}）。请检查网络，或重试。`;
    layout(); publish();
    log(`page-load-failed code=${code}`);
  });
  onCurrentPage('render-process-gone', (_event, details) => {
    current.loading = false;
    current.error = '网页进程已停止，点击重新加载恢复。';
    layout(); publish(); log(`renderer-gone ${details.reason}`);
  });
  onCurrentPage('context-menu', (_event, params) => {
    const template = [];
    if (params.isEditable) template.push({role: 'undo', label: '撤销'}, {role: 'cut', label: '剪切'}, {role: 'copy', label: '复制'}, {role: 'paste', label: '粘贴'}, {type: 'separator'});
    else if (params.selectionText) template.push({role: 'copy', label: '复制'}, {type: 'separator'});
    if (webUrl(params.linkURL)) template.push({label: '在当前窗口打开链接', click: () => void navigate(params.linkURL, {webSession: wc.session})});
    template.push({label: '后退', enabled: current.canBack, click: () => wc.navigationHistory.goBack()},
      {label: '前进', enabled: current.canForward, click: () => wc.navigationHistory.goForward()},
      {label: '重新加载', click: () => wc.reload()},
      {label: '收藏当前网页', click: () => void perform('bookmark')},
      {label: '关闭网页', accelerator: 'CommandOrControl+W', click: () => void perform('close-page')},
      {type: 'separator'}, {label: '回到首页', click: () => showPanel('home')});
    hoverSuspended++;
    updateHoverVisibility();
    Menu.buildFromTemplate(template).popup({window: win, callback: () => { hoverSuspended--; updateHoverVisibility(); }});
  });
  layout();
}
function applyUserAgent() {
  if (web.webContents.session !== browserSession) return;
  const desktop = browserSession.getUserAgent().replace(/\sElectron\/[^\s]+/g, '').replace(/\s(?:moyu-browser|shpeerlazy-browser)\/[^\s]+/gi, '');
  // A selectable mobile UA helps narrow windows; sites retain their own behavior.
  const chrome = /Chrome\/([\d.]+)/.exec(desktop)?.[1] || '140.0.0.0';
  const mobile = `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Mobile Safari/537.36`;
  web.webContents.setUserAgent(store.value.mobile ? mobile : desktop);
}
function destroyWebView() {
  const previous = web;
  // Detach before destruction: Electron clears the view's webContents during close.
  web = null;
  mediaController?.dispose();
  mediaController = null;
  if (!previous) return;
  const contents = previous.webContents;
  previous.setVisible(false);
  win.contentView.removeChildView(previous);
  htmlFullscreenContents.delete(contents);
  if (contents && !contents.isDestroyed()) contents.close();
}
function closePage() {
  current = {url: '', title: '', loading: false, error: '', canBack: false, canForward: false};
  if (panel === 'web') panel = 'home';
  destroyWebView();
  layout();
  publish();
}
async function navigate(value, {webSession = browserSession, ...loadOptions} = {}) {
  const url = normalizeInput(value);
  if (web && web.webContents.session !== webSession) destroyWebView();
  if (!web) makeWebView(webSession);
  current = {...current, url, title: '', error: '', loading: true};
  panel = 'web';
  void syncMedia();
  layout(); publish();
  // Do not wait for the network in the IPC call: loading feedback stays responsive.
  web.webContents.loadURL(url, loadOptions).catch(() => {});
  return url;
}
function applicationIcon() {
  if (!cachedApplicationIcon) {
    cachedApplicationIcon = nativeImage.createEmpty();
    for (const size of [16,20,24,32,40,48]) {
      cachedApplicationIcon.addRepresentation({
        scaleFactor: size / 16,
        buffer: fs.readFileSync(path.join(__dirname,'assets','brand',`app-${size}.png`)),
      });
    }
  }
  return cachedApplicationIcon;
}
function ensureEdgeHandle() {
  if (edgeHandle && !edgeHandle.isDestroyed()) return;
  edgeHandle = new BrowserWindow({
    width: 18, height: 108, frame: false, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, show: false, backgroundColor: '#556a85',
    webPreferences: {nodeIntegration: false, sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'edge-preload.cjs')},
  });
  edgeHandle.setMenu(null);
  edgeHandle.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  edgeHandle.loadFile(path.join(__dirname, 'ui', 'edge.html'));
  edgeHandle.on('closed', () => { edgeHandle = null; });
}
function hideWindow({trayOnly = false} = {}) {
  if (hidden) return;
  normalBounds = win.getNormalBounds();
  hidden = true;
  void syncMedia();
  resetHoverTracking();
  syncOutsideClickMonitor();
  win.hide(); layout();
  if (edgeHandle && !edgeHandle.isDestroyed()) edgeHandle.hide();
  if (store.value.edgeHide && !trayOnly) {
    ensureEdgeHandle();
    const area = screen.getDisplayMatching(normalBounds).workArea;
    edgeHandle.setPosition(area.x + area.width - 18, Math.round(Math.max(area.y + 12, Math.min(normalBounds.y + 60, area.y + area.height - 120))));
    edgeHandle.showInactive();
  }
  publish();
}
function restoreWindow() {
  if (!win || win.isDestroyed()) return;
  recoverReaderPresentation();
  hidden = false;
  restoredAt = Date.now();
  resetHoverTracking();
  if (edgeHandle && !edgeHandle.isDestroyed()) edgeHandle.hide();
  if (normalBounds && !win.isMaximized()) win.setBounds(safeBounds(normalBounds, screen.getDisplayMatching(normalBounds).workArea));
  win.show();
  win.setSkipTaskbar(true);
  if (win.isMinimized()) win.restore();
  win.focus();
  layout(); updateHoverVisibility(); syncOutsideClickMonitor(); void syncMedia(); publish();
}
function saveBounds() {
  if (!win || win.isDestroyed() || hidden || win.isMinimized()) return;
  store.value.bounds = win.getNormalBounds();
  store.save();
}
async function perform(name, value) {
  switch (name) {
    case 'navigate': return navigate(value);
    case 'close-page': closePage(); break;
    case 'panel': showPanel(value); break;
    case 'back': if (web && current.canBack) web.webContents.navigationHistory.goBack(); break;
    case 'forward': if (web && current.canForward) web.webContents.navigationHistory.goForward(); break;
    case 'reload': if (web) { current.error = ''; panel = 'web'; layout(); web.webContents.reload(); } break;
    case 'stop': if (web) web.webContents.stop(); break;
    case 'bookmark': store.toggleBookmark(current.url, current.title); break;
    case 'remove-bookmark':
      store.value.bookmarks = store.value.bookmarks.filter(item => item.url !== value); store.save(); break;
    case 'clear-history': store.value.history = []; store.save(); break;
    case 'pin': store.value.pinned = !store.value.pinned; win.setAlwaysOnTop(store.value.pinned, 'floating'); store.save(); break;
    case 'opacity':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('透明度无效');
      store.value.opacity = Math.max(.3, Math.min(1, value)); win.setOpacity(readerTransparent ? 1 : store.value.opacity); store.save(); break;
    case 'zoom':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('缩放比例无效');
      store.value.zoom = Math.max(.5, Math.min(2, value));
      if (web) web.webContents.setZoomFactor(store.value.zoom); store.save(); break;
    case 'mobile':
      store.value.mobile = !store.value.mobile; store.save();
      if (web) { applyUserAgent(); web.webContents.reload(); } break;
    case 'theme': store.value.theme = store.value.theme === 'light' ? 'dark' : 'light'; store.save(); break;
    case 'pause-on-hide': store.value.pauseOnHide = Boolean(value); store.save(); void syncMedia(); break;
    case 'hover-hide':
      store.value.hoverHide = Boolean(value); store.save();
      resetHoverTracking(); updateHoverVisibility(); syncOutsideClickMonitor(); updateTrayMenu(); break;
    case 'edge-hide':
      store.value.edgeHide = Boolean(value); store.save();
      if (!store.value.edgeHide && edgeHandle && !edgeHandle.isDestroyed()) edgeHandle.hide();
      updateTrayMenu(); break;
    case 'hide': hideWindow(); break;
    case 'minimize': win.minimize(); break;
    case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case 'exit-fullscreen': await exitContentFullscreen(web?.webContents); break;
    case 'open-external': if (webUrl(current.url)) await shell.openExternal(current.url); break;
    case 'quit': quitting = true; app.quit(); break;
    default: throw new Error('不支持的操作');
  }
  publish();
  return uiState();
}
function authorized(event) {
  return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === shellUrl;
}
function setupIPC() {
  ipcMain.handle('moyu:state', event => { if (!authorized(event)) throw new Error('拒绝访问'); return uiState(); });
  ipcMain.handle('moyu:action', async (event, name, value) => {
    if (!authorized(event)) throw new Error('拒绝访问');
    try { return {ok: true, result: await perform(name, value)}; }
    catch (error) { return {ok: false, error: error.message, code: error.code, status: error.status, url: error.url}; }
  });
  ipcMain.handle('moyu:reader', async (event, name, value = {}) => {
    if (!authorized(event)) throw new Error('拒绝访问');
    try { return {ok: true, result: await readerAction(name, value)}; }
    catch (error) { return {ok: false, error: error.message, code: error.code, status: error.status, url: error.url}; }
  });
  ipcMain.on('moyu:restore', event => {
    if (edgeHandle && event.sender === edgeHandle.webContents && event.senderFrame === edgeHandle.webContents.mainFrame) restoreWindow();
  });
}

async function readerDialog(options) {
  hoverSuspended++; resetHoverTracking();
  try { return await dialog.showOpenDialog(win, options); }
  finally { hoverSuspended--; resetHoverTracking(); }
}

function sourceSession(source) {
  if (!readerSessions.has(source.id)) {
    const ses = session.fromPartition(`persist:moyu-source-${source.id}`);
    let agent = readerUserAgent(ses.getUserAgent());
    try {
      const raw = source.raw?.header || source.raw?.headers || {};
      const headers = typeof raw === 'string' ? JSON5.parse(raw) : raw;
      const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'user-agent')?.[1];
      if (typeof value === 'string' && value.length <= 2000 && !/[\r\n]|@js:|<js>/i.test(value)) agent = value;
    } catch {}
    ses.setUserAgent(agent, 'zh-CN,zh,en');
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', event => event.preventDefault());
    // Requests and the embedded verification page share this isolated session.
    ses.webRequest.onBeforeRequest({urls: ['<all_urls>']}, (details, callback) => {
      if (/^(data:|blob:|about:)/i.test(details.url)) { callback({}); return; }
      checkedUrl(details.url).then(() => callback({})).catch(() => callback({cancel: true}));
    });
    readerSessions.set(source.id, ses);
  }
  return readerSessions.get(source.id);
}

async function openSourceWebsite(source, value) {
  const target = await checkedUrl(value || source.baseUrl);
  // User opens only the source's own site, never arbitrary error-response links.
  if (target.origin !== new URL(source.baseUrl).origin) throw new Error('请从书源首页进入网站');
  await navigate(target.href, {webSession: sourceSession(source)});
  web.webContents.focus();
  return true;
}

async function readerAction(name, value) {
  switch (name) {
    case 'state': return readerLibrary.state();
    case 'import': {
      const selection = await readerDialog({title: '导入本地电子书', properties: ['openFile', 'multiSelections'], filters: [{name: '电子书', extensions: ['txt', 'epub']}]});
      const imported = [], errors = [];
      for (const filename of selection.filePaths || []) {
        try {
          if (fs.statSync(filename).size > MAX_BOOK) throw new Error('单本书不能超过 50 MB');
          imported.push(readerLibrary.importFile(filename, fs.readFileSync(filename)));
        } catch (error) { errors.push(`${path.basename(filename)}：${error.message}`); }
      }
      return {imported, errors};
    }
    case 'open': return readerLibrary.open(value.id);
    case 'chapter': return readerLibrary.chapter(value.id, value.index);
    case 'progress': return readerLibrary.progress(value.id, value.progress || {});
    case 'metadata': return readerLibrary.metadata(value.id, value.data || {});
    case 'preferences': return readerLibrary.preferences(value);
    case 'presentation': return setReaderPresentation(value.transparent);
    case 'shortcut-capture': readerCapturing = Boolean(value.active && panel === 'reader'); return true;
    case 'remove': return readerLibrary.remove(value.id);
    case 'mark': return readerLibrary.mark(value.id, value.position || {});
    case 'search': return readerLibrary.search(value.id, value.query);
    case 'sources-import': {
      let text;
      if (value.url) {
        const url = sourceImportUrl(value.url);
        const ses = sourceSession({id: 'imports'});
        try { text = (await requestPage(url, {}, {fetch: (target, options) => chromiumFetch(ses, target, options), userAgent: ses.getUserAgent(), baseUrl: url})).text; }
        catch (error) {
          if (error.code === 'verification') return {imported: 0, skipped: 0, verificationSkipped: true};
          throw error;
        }
      }
      else {
        const selection = await readerDialog({title: '导入书源配置', properties: ['openFile'], filters: [{name: '书源 JSON / eReader', extensions: ['json', 'json5', 'ts', 'js']}]});
        if (selection.canceled) return {imported: 0, skipped: 0, canceled: true};
        const filename = selection.filePaths[0];
        if (fs.statSync(filename).size > 5 * 1024 * 1024) throw new Error('书源文件不能超过 5 MB');
        text = fs.readFileSync(filename, 'utf8');
      }
      return readerLibrary.importSources(text);
    }
    case 'source-toggle': return readerLibrary.sourceAction(value.id, false);
    case 'source-remove': return readerLibrary.sourceAction(value.id, true);
    case 'source-open': return openSourceWebsite(readerLibrary.source(value.id), value.url);
    case 'fetch-cancel': {
      for (const [controller, group] of readerRequests) if (group === value.group) controller.abort();
      return true;
    }
    case 'fetch': {
      const source = readerLibrary.source(value.sourceId);
      if (!source.enabled) throw new Error('请先启用这个书源');
      const ses = sourceSession(source), controller = new AbortController();
      readerRequests.set(controller, value.group || '');
      try {
        const transport = {fetch: (url, options) => chromiumFetch(ses, url, options), userAgent: ses.getUserAgent(), baseUrl: source.baseUrl, signal: controller.signal};
        if (value.runtime) {
          if (!['search', 'toc', 'chapter'].includes(value.runtime.operation)) throw new Error('不支持的书源运行操作');
          const output = await runLegado(source, value.runtime.operation, value.runtime.params || {}, {state: source.runtimeState || {}, signal: controller.signal, call: async action => {
            const target = await checkedUrl(action.url);
            if (action.kind === 'http') {
              const response = await requestPage(target.href, action, {...transport, metadata: true, sourceHeaders: true, timeoutMs: 45000});
              response.cookie = (await ses.cookies.get({url: response.url})).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
              return response;
            }
            if (action.kind === 'cookie-get') return (await ses.cookies.get({url: target.href})).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
            if (action.kind === 'cookie-remove') { for (const cookie of await ses.cookies.get({url: target.href})) await ses.cookies.remove(target.href, cookie.name); return true; }
            if (action.kind === 'cookie-set') {
              const pairs = String(action.cookie || '').split(';').slice(0, 100);
              for (const pair of pairs) { const split = pair.indexOf('='); if (split < 1) continue; const name = pair.slice(0, split).trim(); if (/^(?:path|domain|expires|max-age|samesite)$/i.test(name)) continue; await ses.cookies.set({url: target.href, name, value: pair.slice(split + 1).trim()}); }
              return true;
            }
            throw new Error('不支持的书源网络操作');
          }});
          source.runtimeState = output.state; readerLibrary.save();
          return value.runtime.operation === 'search' ? {runtimeBooks: output.value} : output.value;
        }
        return await requestPage(value.url, value, transport);
      } finally { controller.abort(); readerRequests.delete(controller); }
    }
    case 'online-add': return readerLibrary.addOnline(value);
    case 'online-switch': return readerLibrary.switchOnline(value);
    case 'toc-save': return readerLibrary.saveToc(value.id, value.entries);
    case 'chapter-save': return readerLibrary.cacheChapter(value.id, value.index, value.data);
    default: throw new Error('不支持的阅读器操作');
  }
}
function setupSession() {
  browserSession = session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((contents, permission, callback) => {
    const origin = webUrl(contents.getURL());
    const trusted = web && contents === web.webContents;
    if (!trusted || !origin || !['media', 'geolocation', 'notifications', 'clipboard-read', 'fullscreen'].includes(permission)) return callback(false);
    if (permission === 'fullscreen') return callback(true);
    const labels = {media: '使用摄像头或麦克风', geolocation: '获取位置信息', notifications: '发送通知', 'clipboard-read': '读取剪贴板'};
    hoverSuspended++; updateHoverVisibility();
    dialog.showMessageBox(win, {type: 'question', title: '网站权限', message: `${new URL(origin).hostname} 请求${labels[permission]}`, buttons: ['拒绝', '允许本次'], defaultId: 0, cancelId: 0})
      .then(result => callback(result.response === 1), () => callback(false))
      .finally(() => { hoverSuspended--; updateHoverVisibility(); });
  });
  browserSession.setPermissionCheckHandler((_contents, permission) => permission === 'fullscreen');
  browserSession.on('will-download', (_event, item) => {
    // Chromium's native Save As dialog lets the user select each destination.
    item.setSaveDialogOptions({title: '保存下载文件'});
    item.once('done', (_e, state) => { notice = state === 'completed' ? '文件已下载' : '下载未完成'; publish(); });
  });
}
async function createWindow() {
  const area = store.value.bounds ? screen.getDisplayMatching(store.value.bounds).workArea : screen.getPrimaryDisplay().workArea;
  const bounds = safeBounds(store.value.bounds, area);
  win = new BrowserWindow({...bounds, minWidth: 420, minHeight: 420,
    frame: false, show: false, transparent: true, backgroundColor: '#f5f7f6', autoHideMenuBar: true, skipTaskbar: true, fullscreenable: false,
    title: '沫鱼', icon: applicationIcon(), alwaysOnTop: store.value.pinned,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: false, disableHtmlFullscreenWindowResize: true},
  });
  win.setMenu(null);
  win.setSkipTaskbar(true);
  protectWindowManipulation(win);
  preventDesktopFullscreen(win);
  if (smokeTest) win.webContents.on('console-message', event => console.log('SHELL', event.message));
  win.setOpacity(store.value.opacity);
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', (event, url) => { if (url !== shellUrl) event.preventDefault(); });
  handleKeys(win.webContents);
  win.webContents.on('render-process-gone', () => { readerCapturing = false; recoverReaderPresentation(); });
  win.webContents.on('did-start-loading', () => { readerCapturing = false; recoverReaderPresentation(); });
  win.on('resize', () => { layout(); publish(); });
  let boundsTimer;
  for (const event of ['resize', 'move']) win.on(event, () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 400); });
  win.on('minimize', () => {
    resetHoverTracking(); syncOutsideClickMonitor();
    void syncMedia();
  });
  win.on('restore', () => {
    restoredAt = Date.now(); resetHoverTracking(); syncOutsideClickMonitor();
    void syncMedia();
  });
  win.on('hide', () => { void syncMedia(); });
  win.on('show', () => { void syncMedia(); });
  win.on('close', event => {
    if (!quitting) { event.preventDefault(); hideWindow(); return; }
    clearTimeout(boundsTimer); clearInterval(pointerTimer); saveBounds();
    destroyWebView();
    if (edgeHandle && !edgeHandle.isDestroyed()) edgeHandle.destroy();
  });
  setupIPC();
  setupSession();
  if (devServerUrl) await win.loadURL(devServerUrl);
  else await win.loadFile(shellFile);
  win.show();
  // Windows may apply the launcher's SW_HIDE to the first ShowWindow call.
  // A second show on the next event-loop turn makes scripted launches visible.
  await new Promise(resolve => setImmediate(resolve));
  win.show();
  restoredAt = Date.now(); updateHoverVisibility(); syncOutsideClickMonitor();
  tray = new Tray(applicationIcon());
  tray.setToolTip('沫鱼 · 点击恢复窗口');
  updateTrayMenu();
  tray.on('click', restoreWindow);
  if (!smokeTest) {
    // Screen coordinates cover the shell and embedded Chromium view.
    // Polling at one display frame avoids false mouseleave events between them.
    pointerTimer = setInterval(() => { if (store.value.hoverHide) updateHoverVisibility(); }, 16);
    shortcutAvailable = globalShortcut.register('CommandOrControl+Shift+Space', () => hidden || !win.isVisible() || win.isMinimized() ? restoreWindow() : hideWindow());
    if (!shortcutAvailable) notice = '老板键被其他程序占用，可使用系统托盘恢复窗口';
  }
  publish();
  log(`started electron=${process.versions.electron}`);
  if (smokeTest) {
    try {
      await require('./test/integration.cjs').run({app, win, store, uiState, perform, navigate, getWeb: () => web, browserSession, dataDirectory, hideWindow, restoreWindow, updateHoverVisibility, getTray: () => tray, getEdge: () => edgeHandle});
      quitting = true; tray.destroy(); app.exit(0);
    } catch (error) {
      console.error(error); quitting = true; tray.destroy(); app.exit(1);
    }
  }
}

if (!smokeTest && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', restoreWindow);
  app.whenReady().then(createWindow).catch(error => { log(`startup-failed ${error.stack}`); dialog.showErrorBox('启动失败', error.message); app.exit(1); });
}
app.on('before-quit', () => { quitting = true; resetHoverTracking(); outsideClicks.stop(); for (const controller of readerRequests.keys()) controller.abort(); });
app.on('will-quit', () => { clearInterval(pointerTimer); outsideClicks.stop(); globalShortcut.unregisterAll(); if (tray) tray.destroy(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('activate', restoreWindow);
