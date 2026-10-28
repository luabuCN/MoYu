'use strict';
const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');
const JSON5 = require('json5');
const {newAsyncContext} = require('quickjs-emscripten');
const {domCall} = require('./legado-dom.cjs');
const pending = new Map(); let id = 0;
parentPort.on('message', message => { const job = pending.get(message.id); if (!job) return; pending.delete(message.id); message.error ? job.reject(Object.assign(new Error(message.error.message), message.error)) : job.resolve(message.value); });
const remote = value => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, {resolve, reject}); parentPort.postMessage({type: 'call', id: requestId, value}); });

function hostCall(kind, data) {
  if (kind === 'dom') return domCall(data);
  if (kind === 'json5') return JSON5.parse(data);
  if (kind === 'url') { const url = new URL(data.url, data.base); return {href: url.href, origin: url.origin, protocol: url.protocol, host: url.host, hostname: url.hostname, port: url.port, pathname: url.pathname, search: url.search, hash: url.hash}; }
  if (kind === 'codec') {
    const value = String(data.value ?? '');
    if (data.method === 'base64Decode') return Buffer.from(value, 'base64').toString(data.charset || 'utf8');
    if (data.method === 'base64Encode') return Buffer.from(value, data.charset || 'utf8').toString('base64');
    if (data.method === 'hexDecode') return Buffer.from(value, 'hex').toString(data.charset || 'utf8');
    if (data.method === 'hexEncode') return Buffer.from(value).toString('hex');
    if (data.method === 'encodeURI') return [...iconv.encode(value, data.charset || 'utf8')].map(byte => /[a-z0-9_.~-]/i.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : '%' + byte.toString(16).padStart(2, '0').toUpperCase()).join('');
    if (data.method === 'hash') return crypto.createHash(data.algorithm || 'md5').update(value).digest(data.encoding || 'hex');
    if (data.method === 'hmac') return crypto.createHmac(data.algorithm || 'sha256', String(data.key)).update(value).digest(data.encoding || 'hex');
    if (data.method === 'cipher') {
      const algorithm = String(data.algorithm || 'AES/CBC/PKCS5Padding').split('/'), key = Buffer.from(String(data.key));
      const mode = (algorithm[1] || 'CBC').toLowerCase(), cipherName = `aes-${key.length * 8}-${mode}`;
      const cipher = data.encrypt ? crypto.createCipheriv(cipherName, key, mode === 'ecb' ? null : Buffer.from(String(data.iv || '\0'.repeat(16)))) : crypto.createDecipheriv(cipherName, key, mode === 'ecb' ? null : Buffer.from(String(data.iv || '\0'.repeat(16))));
      if (/nopadding/i.test(algorithm[2])) cipher.setAutoPadding(false);
      return Buffer.concat([cipher.update(Buffer.from(value, data.encrypt ? 'utf8' : data.encoding || 'base64')), cipher.final()]).toString(data.encrypt ? data.encoding || 'base64' : 'utf8');
    }
  }
  throw new Error(`暂未实现书源接口：${kind}`);
}

(async () => {
  const context = await newAsyncContext();
  let deadline = Date.now() + workerData.cpuMs;
  context.runtime.setMemoryLimit(96 * 1024 * 1024);
  context.runtime.setMaxStackSize(2 * 1024 * 1024);
  context.runtime.setInterruptHandler(() => Date.now() > deadline);
  const sync = context.newFunction('__host', (kind, args) => {
    try { return context.newString(JSON.stringify({value: hostCall(context.getString(kind), JSON.parse(context.getString(args)))})); }
    catch (error) { return context.newString(JSON.stringify({error: error.message})); }
  });
  context.setProp(context.global, '__host', sync); sync.dispose();
  const asyncCall = context.newAsyncifiedFunction('__remote', async args => {
    const began = Date.now();
    try {
      const payload = context.getString(args);
      if (payload.length > 8 * 1024 * 1024) throw new Error('书源请求参数超过 8 MB');
      return context.newString(JSON.stringify({value: await remote(JSON.parse(payload))}));
    }
    catch (error) { return context.newString(JSON.stringify({error: error.message, code: error.code})); }
    finally { deadline += Date.now() - began; }
  });
  context.setProp(context.global, '__remote', asyncCall); asyncCall.dispose();
  const payload = context.newString(JSON.stringify(workerData)); context.setProp(context.global, '__payload', payload); payload.dispose();
  const evaluate = async (code, file) => {
    const result = await context.evalCodeAsync(code, file);
    if (result.error) { const detail = context.dump(result.error); result.error.dispose(); throw Object.assign(new Error(`${detail.message || detail}\n${detail.stack || file}`), {code: detail.code}); }
    return result.value;
  };
  try {
    const jsonPathFile = path.join(path.dirname(require.resolve('jsonpath-plus')), 'index-browser-umd.cjs');
    (await evaluate(fs.readFileSync(jsonPathFile, 'utf8'), 'jsonpath.js')).dispose();
    (await evaluate(fs.readFileSync(path.join(__dirname, 'legado-runtime.js'), 'utf8'), 'legado-runtime.js')).dispose();
    const handle = await evaluate('JSON.stringify(__run(JSON.parse(__payload)))', 'book-source.js');
    const value = context.getString(handle); handle.dispose();
    if (value.length > 8 * 1024 * 1024) throw new Error('书源解析结果超过 8 MB');
    parentPort.postMessage({type: 'result', result: JSON.parse(value)});
  } catch (error) { parentPort.postMessage({type: 'error', error: {message: error.message || String(error), code: error.code || (/interrupt|memory|stack overflow/i.test(error.message) ? 'script-timeout' : 'script')}}); }
  finally { context.dispose(); parentPort.close(); }
})().catch(error => { parentPort.postMessage({type: 'error', error: {message: error.message}}); parentPort.close(); });
