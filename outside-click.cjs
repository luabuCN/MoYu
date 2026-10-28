'use strict';
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');

function createOutsideClickMonitor(onClick, onStatus) {
  let running;
  function stop() {
    const item = running;
    running = null;
    if (!item) return;
    clearTimeout(item.startup);
    item.lines.close();
    item.child.stdin.end();
    const force = setTimeout(() => { if (item.child.exitCode === null) item.child.kill(); }, 500);
    force.unref();
    item.child.once('exit', () => clearTimeout(force));
    onStatus('stopped');
  }
  function start() {
    if (running || process.platform !== 'win32') return;
    onStatus('starting');
    const nativeRoot = __dirname.endsWith('app.asar') ? `${__dirname}.unpacked` : __dirname;
    const child = spawn(path.join(nativeRoot, 'native', 'outside-click-monitor.exe'), [String(process.pid)], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    const item = running = {child, lines: createInterface({input: child.stdout}), startup: null, error: ''};
    const fail = reason => {
      if (running !== item) return;
      item.error = String(reason || '外部点击监听已停止').slice(0, 400);
      stop(); onStatus('failed', item.error);
    };
    item.startup = setTimeout(() => fail('外部点击监听启动超时'), 5000);
    item.startup.unref();
    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => { item.error = (item.error + data).slice(-400); });
    child.once('error', error => fail(error.message));
    child.once('exit', () => { if (running === item) fail(item.error); });
    item.lines.on('line', line => {
      if (running !== item) return;
      if (line === 'ready') { clearTimeout(item.startup); onStatus('ready'); return; }
      const fields = line.split('\t');
      if (fields.length !== 5 || fields[0] !== 'click') return;
      const x = Number(fields[1]), y = Number(fields[2]), time = Number(fields[4]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time) || !/^[a-f\d]+$/i.test(fields[3])) return;
      onClick({x, y, window: fields[3].toLowerCase(), time});
    });
  }
  return {start, stop};
}

module.exports = {createOutsideClickMonitor};
