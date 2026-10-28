'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');

async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timeout: ${label}`);
}

exports.run = async ({win, perform, navigate, getWeb, hideWindow, restoreWindow, record, wav}) => {
  let origin, crossOrigin;
  const serve = (req, res) => {
    if (req.url === '/tone.wav') { res.writeHead(200, {'Content-Type': 'audio/wav'}); res.end(wav()); return; }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`<!doctype html><title>Media ${req.url}</title>
      <audio id="playing" loop src="/tone.wav"></audio><audio id="manual" loop src="/tone.wav"></audio>
      ${req.url === '/main' ? `<div id="shadow-host"></div><script>document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<audio id="shadow" loop src="/tone.wav"></audio>';</script><iframe src="${crossOrigin}/cross"></iframe>` : ''}
      ${req.url === '/cross' ? `<iframe src="${origin}/nested"></iframe>` : ''}`);
  };
  const server = http.createServer(serve), crossServer = http.createServer(serve);
  server.listen(0, '127.0.0.1'); crossServer.listen(0, '127.0.0.2');
  await Promise.all([once(server, 'listening'), once(crossServer, 'listening')]);
  origin = `http://127.0.0.1:${server.address().port}`;
  crossOrigin = `http://127.0.0.2:${crossServer.address().port}`;
  try {
    await perform('pause-on-hide', true);
    await navigate(origin + '/main');
    const contents = getWeb().webContents;
    const frames = () => contents.mainFrame.framesInSubtree.filter(frame => !frame.isDestroyed() && !frame.detached && /^https?:/.test(frame.url));
    const frameJS = (frame, script) => frame.executeJavaScript(script, true);
    const allPlaying = async () => (await Promise.all(frames().map(frame => frameJS(frame, `(() => {
      const media = [document.querySelector('#playing'), document.querySelector('#shadow-host')?.shadowRoot.querySelector('audio')].filter(Boolean);
      return media.length > 0 && media.every(m => !m.paused) && document.querySelector('#manual').paused;
    })()`)))).every(Boolean);
    const allPaused = async () => (await Promise.all(frames().map(frame => frameJS(frame, `(() => {
      const media = [...document.querySelectorAll('audio'), ...(document.querySelector('#shadow-host')?.shadowRoot.querySelectorAll('audio') || [])];
      return media.length > 0 && media.every(m => m.paused);
    })()`)))).every(Boolean);
    const startAll = () => Promise.all(frames().map(frame => frameJS(frame, `Promise.all([document.querySelector('#playing'), document.querySelector('#shadow-host')?.shadowRoot.querySelector('audio')].filter(Boolean).map(m => m.play().catch(() => {}))).then(() => undefined)`)));
    const waitReady = () => until(async () => frames().length === 3 && (await Promise.all(frames().map(frame => frameJS(frame, 'Boolean(document.querySelector("#playing"))')))).every(Boolean), 'main, cross-origin and nested players ready');
    await waitReady();
    assert.equal(await contents.executeJavaScript(`(() => { try { document.querySelector('iframe').contentWindow.document; return false; } catch (e) { return e.name === 'SecurityError'; } })()`), true);
    await startAll();
    await until(allPlaying, 'all frame and shadow players playing');
    await contents.executeJavaScript(`(async () => {
      window.testAudioContext = new AudioContext();
      const oscillator = testAudioContext.createOscillator(), gain = testAudioContext.createGain();
      gain.gain.value = 0.001; oscillator.connect(gain); gain.connect(testAudioContext.destination); oscillator.start();
      await testAudioContext.resume();
    })()`, true);
    hideWindow();
    assert.equal(contents.isAudioMuted(), true, 'native muting happens synchronously before page scripts pause');
    await until(allPaused, 'hidden players in every frame and shadow root pause');
    assert.equal(await contents.executeJavaScript('testAudioContext.state'), 'running');
    const crossFrame = frames().find(frame => frame.url.startsWith(crossOrigin));
    await frameJS(crossFrame, 'document.querySelector("#playing").play().catch(() => {}); void 0');
    await until(allPaused, 'website cannot restart media while hidden');
    assert.equal(contents.isAudioMuted(), true);
    restoreWindow();
    await until(async () => !contents.isAudioMuted() && await allPlaying(), 'restore resumes only previously playing frame and shadow media');
    await contents.executeJavaScript('testAudioContext.close().then(() => undefined)');
    record('hidden windows immediately mute every audio source including Web Audio, pause cross-origin/nested/shadow players, block background restarts and preserve manually paused media');

    hideWindow();
    contents.reload();
    await until(() => !contents.isLoading(), 'hidden reload finishes');
    await waitReady();
    assert.equal(contents.isAudioMuted(), true);
    await startAll();
    await until(allPaused, 'reloaded hidden players pause');
    await contents.executeJavaScript(`(() => {
      const media = document.createElement('audio'); media.id = 'late'; media.src = '/tone.wav'; media.loop = true;
      document.body.append(media); media.play().catch(() => {});
    })()`, true);
    await until(() => contents.executeJavaScript('document.querySelector("#late").paused'), 'dynamically inserted hidden media pauses');
    restoreWindow();
    await until(async () => !contents.isAudioMuted() && await allPlaying(), 'hidden reload restores normally');
    await until(() => contents.executeJavaScript('!document.querySelector("#late").paused'), 'dynamic media restores');
    record('native mute survives hidden reloads; newly loaded and dynamically inserted players also pause and restore');

    await perform('minimize');
    await until(() => win.isMinimized() && contents.isAudioMuted(), 'minimize mutes browser');
    await until(allPaused, 'minimize pauses all frames');
    restoreWindow();
    await until(async () => !win.isMinimized() && !contents.isAudioMuted() && await allPlaying(), 'minimize restore');
    await perform('panel', 'reader');
    assert.equal(contents.isAudioMuted(), true);
    await until(allPaused, 'reader pauses background browser');
    hideWindow(); restoreWindow();
    assert.equal(contents.isAudioMuted(), true, 'restoring the reader must not unmute its background browser');
    await perform('pause-on-hide', false);
    await until(async () => !contents.isAudioMuted() && await allPlaying(), 'disabling setting permits background playback');
    hideWindow();
    assert.equal(contents.isAudioMuted(), false);
    assert.equal(await allPlaying(), true);
    restoreWindow();
    await perform('pause-on-hide', true);
    assert.equal(contents.isAudioMuted(), true, 'enabling setting while away takes effect immediately');
    await until(allPaused, 'reenabled setting pauses media');
    await perform('panel', 'web');
    await until(async () => !contents.isAudioMuted() && await allPlaying(), 'return from reader');
    record('minimize, reader switching, tray restoration and changing the pause setting all keep browser audio consistent with visible content');

    contents.setAudioMuted(true);
    hideWindow();
    await until(allPaused, 'previously muted browser pauses');
    restoreWindow();
    await until(allPlaying, 'previously muted browser resumes');
    assert.equal(contents.isAudioMuted(), true, 'original mute state is preserved');
    contents.setAudioMuted(false);
    for (let i = 0; i < 4; i++) { hideWindow(); restoreWindow(); }
    await until(async () => !contents.isAudioMuted() && await allPlaying(), 'rapid hide and restore settles');
    record('media controls preserve the original mute state and remain correct after rapid hide/restore operations');
    await perform('close-page');
  } finally {
    server.closeAllConnections(); server.close();
    crossServer.closeAllConnections(); crossServer.close();
  }
};
