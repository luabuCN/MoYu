'use strict';

// Local library storage and bounded HTTP transport. Book/source scripts never run here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const iconv = require('iconv-lite');
const JSON5 = require('json5');
const MAX_BOOK = 50 * 1024 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const clean = (value, max = 300) => String(value ?? '').replace(/\0/g, '').slice(0, max);
const hash = data => crypto.createHash('sha256').update(data).digest('hex').slice(0, 24);
const clamp = (value, min, max, fallback = min) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

function decode(bytes, hint = '') {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (hint) {
    try { return new TextDecoder(hint.trim()).decode(bytes); } catch {}
  }
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

function parseTxt(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\0/g, '');
  if (!text.trim()) throw new Error('这本 TXT 没有可读正文');
  const heading = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章回节卷部篇集][^\n]{0,65}|(?:序章|序言|前言|楔子|引子|后记|尾声|番外)(?:[\s：:、].{0,60})?|chapter\s+\d+[^\n]{0,65})$/i;
  const chapters = [];
  let title = '正文', lines = [], size = 0;
  const flush = () => {
    const content = lines.join('\n').trim();
    if (content) chapters.push({title, text: content});
    lines = []; size = 0;
  };
  const linesToParse = text.split('\n').flatMap(line => line.length <= 48000 ? [line] : line.match(/[\s\S]{1,24000}/g));
  for (const raw of linesToParse) {
    const line = raw.trim();
    if (heading.test(line)) {
      // Some exports repeat the heading immediately after their chapter marker.
      if (line === title && !lines.some(v => v.trim())) continue;
      flush(); title = line;
    } else {
      lines.push(raw); size += raw.length + 1;
      if (size > 24000 && !line) { flush(); title = `${title.replace(/ · 续$/, '')} · 续`; }
      else if (size > 48000) { flush(); title = `${title.replace(/ · 续$/, '')} · 续`; }
    }
  }
  flush();
  if (!chapters.length) chapters.push({title, text: text.trim()});
  return chapters;
}

function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  const ip = address.toLowerCase();
  if (ip.startsWith('::ffff:')) return publicAddress(ip.slice(7));
  return ip !== '::' && ip !== '::1' && !/^(fc|fd|fe[89ab]|ff)/.test(ip);
}

async function checkedUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('书源地址只支持 HTTP / HTTPS');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{address: hostname}] : await dns.lookup(hostname, {all: true});
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('书源不能访问本机或内网地址');
  return url;
}

function requestError(message, code, status = 0, url = '') {
  return Object.assign(new Error(message), {code, status, url});
}

function readerUserAgent(value) {
  // Electron includes the app name, which may contain Chinese characters.
  // Keep the browser identity while removing app tokens invalid in HTTP headers.
  return String(value).split(/\s+/).filter(token =>
    !/^(?:Electron|moyu-browser|shpeerlazy-browser)\//i.test(token) && !/[^\x20-\x7e]/.test(token)).join(' ');
}

function sourceImportUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); }
  catch { throw new Error('书源链接不是有效的网址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('书源地址只支持 HTTP / HTTPS');
  if (url.origin === 'https://shuyuan.yiove.com' && /^\/book-sources\/?$/.test(url.pathname)) {
    const page = url.searchParams.get('page') ?? '1';
    const size = url.searchParams.get('page_size') ?? '20';
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) ||
        !/^[1-9]\d*$/.test(size) || Number(size) > 1000) throw new Error('Yiove 页码须为正整数，每页数量须在 1 到 1000 之间');
    return `https://shuyuan-api.yiove.com/import/book-sources/${page}-${size}`;
  }
  return url.href;
}

function encodeRequest(value, charset) {
  if (!charset || /^utf-?8$/i.test(charset)) return value;
  if (!iconv.encodingExists(charset)) throw requestError(`不支持的请求编码：${charset}`, 'encoding');
  // Templates and URLSearchParams produce UTF-8 percent escapes. Transcode their values,
  // without decoding escaped separators into actual URL/form delimiters.
  return String(value).replace(/(?:%[\da-f]{2})+/gi, encoded => {
    let decoded;
    try { decoded = decodeURIComponent(encoded); } catch { return encoded; }
    return [...iconv.encode(decoded, charset)].map(byte => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('');
  });
}

// Electron fetch cancels manual redirects instead of returning a 3xx response.
// Return each hop so requestPage can validate its URL before requesting it.
function chromiumFetch(ses, url, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason); return; }
    const request = require('electron').net.request({url, method: options.method || 'GET', session: ses, credentials: 'include', redirect: 'manual'});
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(response);
    };
    const abort = () => { finish(options.signal.reason || new Error('请求已取消')); request.abort(); };
    options.signal?.addEventListener('abort', abort, {once: true});
    request.on('error', error => finish(error));
    request.on('login', (_auth, callback) => callback());
    request.on('redirect', (status, _method, target) => {
      finish(null, new Response(null, {status, headers: {Location: target}}));
      request.abort();
    });
    request.on('response', incoming => {
      const chunks = []; let length = 0;
      const headers = new Headers();
      for (const [name, values] of Object.entries(incoming.headers)) {
        for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
      }
      incoming.on('error', error => finish(error));
      incoming.on('aborted', () => finish(new Error('网站中断了响应')));
      incoming.on('data', chunk => {
        length += chunk.length;
        if (length > MAX_RESPONSE) { finish(new Error('书源响应超过 8 MB')); request.abort(); return; }
        chunks.push(Buffer.from(chunk));
      });
      incoming.on('end', () => {
        if (settled) return;
        const body = [204, 205, 304].includes(incoming.statusCode) ? null : Buffer.concat(chunks);
        finish(null, new Response(body, {status: incoming.statusCode, headers}));
      });
    });
    for (const [name, value] of new Headers(options.headers)) request.setHeader(name, value);
    request.end(options.body);
  });
}

async function requestPage(value, options = {}, transport = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(60000, Math.max(1000, transport.timeoutMs || 20000)));
  const signal = transport.signal ? AbortSignal.any([transport.signal, controller.signal]) : controller.signal;
  try {
    let target = encodeRequest(value, options.charset);
    let method = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'HEAD'].includes(method)) throw new Error('书源请求仅支持 GET、POST 和 HEAD');
    let body = method === 'POST' ? encodeRequest(clean(options.body, 128000), options.charset) : undefined;
    const initialOrigin = new URL(target).origin;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const url = await checkedUrl(target);
      const headers = new Headers({'User-Agent': transport.userAgent || 'Mozilla/5.0 MoyuReader/1.4', Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'});
      if (transport.baseUrl) headers.set('Referer', new URL(transport.baseUrl).origin + '/');
      for (const [key, value] of Object.entries(options.headers || {})) {
        const runtimeHeader = transport.sourceHeaders && /^[!#$%&'*+.^_`|~\w-]+$/.test(key) && !/^(host|connection|content-length|transfer-encoding|upgrade|proxy-|sec-)/i.test(key);
        if ((/^(accept|accept-language|content-type|user-agent|referer|origin)$/i.test(key) || runtimeHeader) &&
            (url.origin === initialOrigin || !/^(referer|origin|authorization|cookie)$/i.test(key))) headers.set(key, clean(value, 2000));
      }
      if (method === 'POST' && !headers.has('Content-Type')) headers.set('Content-Type', `application/x-www-form-urlencoded; charset=${options.charset || 'UTF-8'}`);
      if (method === 'POST' && !headers.has('Origin')) headers.set('Origin', transport.baseUrl ? new URL(transport.baseUrl).origin : url.origin);
      const response = await (transport.fetch || fetch)(url.href, {method, body, headers, redirect: 'manual', signal, credentials: 'include', bypassCustomProtocolHandlers: true});
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('书源重定向缺少地址');
        target = new URL(location, url).href;
        if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) { method = 'GET'; body = undefined; }
        continue;
      }
      if (!response.ok && response.status !== 403) {
        await response.body?.cancel();
        const reasons = {401: '网站要求登录', 403: '网站拒绝请求，可能需要在网站完成验证或已限制访问', 404: '地址不存在，书源可能已失效', 429: '网站限制了请求频率，请稍后重试', 451: '网站限制了此内容的访问'};
        throw requestError(`${reasons[response.status] || '网站请求失败'}（HTTP ${response.status}）`, 'http', response.status, url.href);
      }
      if (Number(response.headers.get('content-length')) > MAX_RESPONSE) { await response.body?.cancel(); throw new Error('书源响应超过 8 MB'); }
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      while (true) {
        const {done, value: chunk} = await reader.read();
        if (done) break;
        length += chunk.length;
        if (length > MAX_RESPONSE) { await reader.cancel(); throw new Error('书源响应超过 8 MB'); }
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      const type = response.headers.get('content-type') || '';
      const charset = type.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || bytes.subarray(0, 2048).toString('ascii').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
      const content = decode(bytes, charset || options.charset);
      // Source JSON and static source.ts may quote challenge HTML in their rules.
      // Only classify actual HTML responses, including challenges served as HTTP 403.
      if (content.trimStart().startsWith('<') && /cf-chl-|cf-turnstile|<title>\s*(?:Just a moment|Attention Required|人机验证|安全验证)|id=["']challenge-form|<form\b[^>]*\b(?:id|class)=["'][^"']*captcha/i.test(content)) {
        throw requestError('需要人机验证，已跳过此书源', 'verification', response.status, url.href);
      }
      if (!response.ok) throw requestError('网站拒绝请求，已限制访问（HTTP 403）', 'http', response.status, url.href);
      return transport.metadata ? {url: url.href, text: content, status: response.status, headers: Object.fromEntries(response.headers)} : {url: url.href, text: content};
    }
    throw new Error('书源重定向次数过多');
  } catch (error) {
    if (transport.signal?.aborted) throw requestError('搜索已取消', 'canceled');
    if (controller.signal.aborted) throw requestError('书源请求超时，请稍后重试', 'timeout');
    if (error.code === 'ENOTFOUND' || error.cause?.code === 'ENOTFOUND') throw requestError('书源域名无法解析，可能已停用或网络不可用', 'network');
    if (/ERR_BLOCKED_BY_CLIENT/.test(error.message)) throw requestError('书源接口请求被客户端或网络策略阻止', 'network');
    throw requestError(clean(error.message || '连接书源失败', 350), error.code || 'network', error.status || 0, error.url || '');
  } finally { clearTimeout(timer); }
}

const {defaultShortcuts, normalizeShortcuts} = require('./reader-shortcuts.cjs');
class ReaderLibrary {
  constructor(directory) {
    this.root = path.join(directory, 'reader');
    fs.mkdirSync(this.root, {recursive: true});
    this.index = path.join(this.root, 'library.json');
    this.cache = new Map();
    this.value = {books: [], sources: [], preferences: {theme: 'paper', previousTheme: 'paper', fontSize: 20, lineHeight: 1.9, width: 720, font: 'serif', readingMode: 'scroll', shortcuts: {...defaultShortcuts}, scrollKeys: true, scrollSpeed: 5}};
    if (fs.existsSync(this.index)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.index, 'utf8'));
        if (!Array.isArray(data.books) || !Array.isArray(data.sources)) throw new Error('invalid library');
        this.value = {...this.value, ...data, preferences: {...this.value.preferences, ...data.preferences}};
        try { this.value.preferences.shortcuts = normalizeShortcuts(this.value.preferences.shortcuts); }
        catch { this.value.preferences.shortcuts = {...defaultShortcuts}; }
      } catch (error) {
        fs.copyFileSync(this.index, `${this.index}.damaged-${Date.now()}`);
        // Preserve the damaged index and imported files for recovery.
        this.value.notice = '书架索引损坏，已保留备份；原始书籍仍在 reader 文件夹中。';
      }
    }
  }
  save() {
    const temporary = `${this.index}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.value, null, 2), 'utf8');
    for (let retry = 0; ; retry++) {
      try { fs.renameSync(temporary, this.index); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || retry >= 5) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (retry + 1));
      }
    }
  }
  state() { return this.value; }
  book(id) {
    const book = this.value.books.find(item => item.id === id);
    if (!book || !/^[a-f\d]{24}$/.test(book.id)) throw new Error('书籍不存在');
    return book;
  }
  file(id, name) {
    const book = this.book(id);
    const edition = book.type === 'online' && /^(toc|chapter-\d+)\.json$/.test(name) && /^[a-f\d]{24}$/.test(book.storageId || '') ? book.storageId : '';
    return path.join(this.root, id, edition, name);
  }
  readDocument(id) {
    if (!this.cache.has(id)) {
      const data = JSON.parse(fs.readFileSync(this.file(id, 'text.json'), 'utf8'));
      if (this.cache.size >= 2) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(id, data);
    }
    return this.cache.get(id);
  }
  importFile(filename, input) {
    const extension = path.extname(filename).toLowerCase();
    if (!['.txt', '.epub'].includes(extension)) throw new Error('请选择 TXT 或 EPUB 文件');
    const bytes = Buffer.from(input);
    if (!bytes.length || bytes.length > MAX_BOOK) throw new Error('单本书需大于 0 字节且不超过 50 MB');
    if (extension === '.epub' && (bytes.length < 4 || bytes.readUInt16LE(0) !== 0x4b50)) throw new Error('这不是有效的 EPUB 压缩文件');
    const id = hash(bytes);
    const existing = this.value.books.find(book => book.id === id);
    if (existing) return {book: existing, duplicate: true};
    const chapters = extension === '.txt' ? parseTxt(decode(bytes)) : null;
    const folder = path.join(this.root, id);
    fs.mkdirSync(folder, {recursive: true});
    fs.writeFileSync(path.join(folder, `original${extension}`), bytes);
    if (chapters) fs.writeFileSync(path.join(folder, 'text.json'), JSON.stringify(chapters), 'utf8');
    const book = {id, title: clean(path.parse(filename).name), author: '', type: extension.slice(1), addedAt: Date.now(), lastRead: 0,
      chapterCount: chapters?.length || 0, progress: {chapter: 0, fraction: 0, percent: 0}, marks: []};
    this.value.books.unshift(book); this.save();
    return {book, duplicate: false};
  }
  open(id) {
    const book = this.book(id);
    book.lastRead = Date.now(); this.save();
    if (book.type === 'epub') return {book, bytes: fs.readFileSync(this.file(id, 'original.epub'))};
    if (book.type === 'txt') return {book, toc: this.readDocument(id).map((c, index) => ({title: c.title, index}))};
    const filename = this.file(id, 'toc.json');
    return {book, toc: fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : []};
  }
  chapter(id, index) {
    const book = this.book(id);
    index = Math.floor(clamp(index, 0, Math.max(0, book.chapterCount - 1)));
    if (book.type === 'txt') return this.readDocument(id)[index];
    const filename = this.file(id, `chapter-${index}.json`);
    return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null;
  }
  progress(id, progress) {
    const book = this.book(id);
    book.progress = {chapter: Math.floor(clamp(progress.chapter, 0, Math.max(book.chapterCount - 1, 0))),
      fraction: clamp(progress.fraction, 0, 1), percent: clamp(progress.percent, 0, 100), cfi: clean(progress.cfi, 4000)};
    book.lastRead = Date.now(); this.save(); return book;
  }
  metadata(id, data) {
    const book = this.book(id);
    if (data.title) book.title = clean(data.title);
    if (data.author) book.author = clean(data.author);
    if (data.chapterCount) book.chapterCount = Math.floor(clamp(data.chapterCount, 0, 100000));
    if (typeof data.cover === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(data.cover) && data.cover.length < 800000) book.cover = data.cover;
    this.save(); return book;
  }
  preferences(data) {
    const old = this.value.preferences;
    this.value.preferences = {theme: ['paper', 'light', 'green', 'dark', 'transparent'].includes(data.theme) ? data.theme : old.theme,
      previousTheme: ['paper', 'light', 'green', 'dark'].includes(data.previousTheme) ? data.previousTheme : old.previousTheme || 'paper',
      fontSize: clamp(data.fontSize ?? old.fontSize, 14, 36, 20), lineHeight: clamp(data.lineHeight ?? old.lineHeight, 1.4, 2.6, 1.9),
      width: clamp(data.width ?? old.width, 480, 1000, 720), font: ['serif', 'sans'].includes(data.font) ? data.font : old.font,
      readingMode: ['scroll', 'paged'].includes(data.readingMode) ? data.readingMode : old.readingMode,
      shortcuts: normalizeShortcuts(data.shortcuts ?? {}, old.shortcuts), scrollKeys: typeof data.scrollKeys === 'boolean' ? data.scrollKeys : old.scrollKeys,
      scrollSpeed: Math.round(clamp(data.scrollSpeed ?? old.scrollSpeed, 1, 10, 5))};
    this.save(); return this.value.preferences;
  }
  importSources(text) {
    if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) throw new Error('书源 JSON 不能超过 5 MB');
    let parsed;
    try {
      let config = text.replace(/^\uFEFF/, '').trim();
      // Accept eReader's static source.ts container as data. Never evaluate TS/JS.
      const wrapped = config.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)\s*;?\s*export\s+default\s+\1\s*;?\s*$/);
      config = wrapped ? wrapped[2].replace(/;\s*$/, '') : config.replace(/^export\s+default\s+/, '').replace(/;\s*$/, '');
      parsed = JSON5.parse(config);
    } catch { throw new Error('无法识别书源：支持 JSON / JSON5 和 eReader 静态 source.ts，不执行脚本代码'); }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : Array.isArray(parsed?.local) ? parsed.local : [parsed];
    if (list.length > 1000) throw new Error('一次最多导入 1000 个书源');
    let imported = 0, skipped = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || !((raw.bookSourceUrl && raw.ruleSearch) || (raw.origin && raw.search) || (raw.baseUrl && raw.search))) { skipped++; continue; }
      const base = clean(raw.bookSourceUrl || raw.origin || raw.baseUrl, 2000);
      try { if (!['https:', 'http:'].includes(new URL(base).protocol)) throw 0; } catch { skipped++; continue; }
      const id = hash(base + (raw.bookSourceName || raw.name || ''));
      const item = {id, name: clean(raw.bookSourceName || raw.name || new URL(base).hostname), baseUrl: base, enabled: true, raw};
      const index = this.value.sources.findIndex(source => source.id === id);
      if (index >= 0) this.value.sources[index] = {...item, enabled: this.value.sources[index].enabled}; else this.value.sources.push(item);
      imported++;
    }
    this.save(); return {imported, skipped};
  }
  source(id) {
    const source = this.value.sources.find(item => item.id === id);
    if (!source) throw new Error('书源不存在');
    return source;
  }
  sourceAction(id, remove) {
    const source = this.source(id);
    if (remove) this.value.sources = this.value.sources.filter(item => item.id !== id);
    else source.enabled = !source.enabled;
    this.save(); return this.state();
  }
  addOnline(data) {
    const source = this.source(data.sourceId);
    const url = new URL(clean(data.url, 4000), source.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('书籍地址无效');
    let id = hash(source.id + url.href);
    let book = this.value.books.find(item => item.type === 'online' && item.sourceId === source.id && item.url === url.href);
    if (!book) {
      if (this.value.books.some(item => item.id === id)) id = hash(source.id + url.href + crypto.randomUUID());
      book = {id, title: clean(data.title) || '未命名小说', author: clean(data.author), type: 'online', sourceId: source.id,
        sourceName: source.name, url: url.href, addedAt: Date.now(), lastRead: 0, chapterCount: 0,
        progress: {chapter: 0, fraction: 0, percent: 0}, marks: []};
      fs.mkdirSync(path.join(this.root, id), {recursive: true});
      this.value.books.unshift(book); this.save();
    }
    return book;
  }
  switchOnline(data) {
    const book = this.book(data.id), source = this.source(data.sourceId);
    if (book.type !== 'online' || !source.enabled) throw new Error('请先启用新的小说书源');
    if (book.sourceId !== data.previousSourceId || book.url !== data.previousUrl) throw new Error('书源已发生变化，请重新打开换源面板');
    const url = new URL(clean(data.url, 4000), source.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('书籍地址无效');
    if (!Array.isArray(data.entries) || !data.entries.length || data.entries.length > 50000) throw new Error('新书源目录无效');
    const entries = data.entries.map(entry => ({title: clean(entry.title), url: clean(entry.url, 4000)}));
    if (entries.some(entry => { try { const value = new URL(entry.url); return !entry.title || !['http:', 'https:'].includes(value.protocol) || value.username || value.password; } catch { return true; } })) throw new Error('新书源章节地址无效');
    const index = data.index;
    if (!Number.isInteger(index) || index < 0 || index >= entries.length || !data.chapter?.text?.trim()) throw new Error('新书源未能加载正文，原书源已保留');
    const file = this.file(book.id, 'toc.json');
    const previousToc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    const key = value => String(value || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
    const byTitle = new Map(entries.map((entry, i) => [key(entry.title), i]));
    const matched = key(previousToc[book.progress.chapter]?.title) === key(entries[index].title);
    const fraction = matched ? clamp(book.progress.fraction, 0, 1) : 0;
    const storageId = hash(source.id + url.href + crypto.randomUUID());
    const directory = path.join(this.root, book.id, storageId);
    fs.mkdirSync(directory, {recursive: true});
    // Prepare a complete new edition before the atomic library index switches to it.
    // Previous caches and marks stay on disk and in sourceHistory for recovery.
    fs.writeFileSync(path.join(directory, 'toc.json'), JSON.stringify(entries));
    fs.writeFileSync(path.join(directory, `chapter-${index}.json`), JSON.stringify({title: entries[index].title, text: clean(data.chapter.text, 1000000)}));
    const history = {sourceId: book.sourceId, sourceName: book.sourceName, url: book.url, storageId: book.storageId || '', progress: book.progress, marks: book.marks, switchedAt: Date.now()};
    const updated = {...book, sourceId: source.id, sourceName: source.name, url: url.href, storageId, chapterCount: entries.length,
      sourceHistory: [...(book.sourceHistory || []), history],
      progress: {chapter: index, fraction, percent: (index + fraction) / entries.length * 100},
      marks: (book.marks || []).flatMap(mark => {
        const chapter = byTitle.get(key(previousToc[mark.chapter]?.title));
        return chapter === undefined ? [] : [{...mark, chapter, key: `${chapter}:${Math.floor((mark.fraction || 0) * 100)}`}];
      })};
    const at = this.value.books.indexOf(book);
    this.value.books[at] = updated;
    try { this.save(); } catch (error) { this.value.books[at] = book; throw error; }
    return {book: updated, toc: entries, chapter: {title: entries[index].title, text: clean(data.chapter.text, 1000000)}, matched};
  }
  saveToc(id, entries) {
    const book = this.book(id);
    if (book.type !== 'online' || !Array.isArray(entries) || entries.length > 50000) throw new Error('目录格式无效');
    const seen = new Set();
    const toc = entries.map(item => ({title: clean(item.title), url: clean(item.url, 4000)})).filter(item => {
      try {
        const url = new URL(item.url);
        if (!['https:', 'http:'].includes(url.protocol) || seen.has(url.href)) return false;
        seen.add(url.href); return true;
      } catch { return false; }
    });
    if (!toc.length) throw new Error('书源没有解析到章节，请检查目录规则');
    // Cache files use chapter indices. Restore positions by chapter URL if the order changes.
    const file = this.file(id, 'toc.json');
    const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    if (previous.some((entry, i) => entry.url !== toc[i]?.url)) {
      for (const name of fs.readdirSync(path.dirname(file))) if (/^chapter-\d+\.json$/.test(name)) fs.unlinkSync(this.file(id, name));
      const byUrl = new Map(toc.map((entry, i) => [entry.url, i]));
      const nextIndex = byUrl.get(previous[book.progress.chapter]?.url);
      book.progress = nextIndex === undefined ? {chapter: 0, fraction: 0, percent: 0}
        : {...book.progress, chapter: nextIndex, percent: (nextIndex + (book.progress.fraction || 0)) / toc.length * 100};
      book.marks = (book.marks || []).flatMap(mark => {
        const index = byUrl.get(previous[mark.chapter]?.url);
        return index === undefined ? [] : [{...mark, chapter: index, key: `${index}:${Math.floor((mark.fraction || 0) * 100)}`}];
      });
    }
    fs.writeFileSync(file, JSON.stringify(toc), 'utf8'); book.chapterCount = toc.length; this.save(); return toc;
  }
  cacheChapter(id, index, data) {
    const book = this.book(id);
    if (book.type !== 'online' || !Number.isInteger(index) || index < 0 || index >= book.chapterCount) throw new Error('章节不存在');
    const chapter = {title: clean(data.title), text: clean(data.text, 1000000)};
    if (!chapter.text.trim()) throw new Error('书源未能提取正文');
    fs.writeFileSync(this.file(id, `chapter-${index}.json`), JSON.stringify(chapter), 'utf8'); return chapter;
  }
  mark(id, position) {
    const book = this.book(id);
    book.marks ||= [];
    const key = clean(position.key, 4000);
    const old = book.marks.findIndex(mark => mark.key === key);
    if (old >= 0) book.marks.splice(old, 1);
    else if (book.marks.length < 200) book.marks.push({key, title: clean(position.title), chapter: position.chapter, fraction: clamp(position.fraction, 0, 1), cfi: clean(position.cfi, 4000), createdAt: Date.now()});
    this.save(); return book;
  }
  search(id, query) {
    const book = this.book(id);
    query = clean(query, 200).trim();
    if (!query) return [];
    const results = [], lower = query.toLocaleLowerCase();
    const toc = book.type === 'txt' ? this.readDocument(id) : JSON.parse(fs.readFileSync(this.file(id, 'toc.json'), 'utf8'));
    for (let chapter = 0; chapter < toc.length && results.length < 100; chapter++) {
      const data = book.type === 'txt' ? toc[chapter] : this.chapter(id, chapter);
      if (!data) continue;
      let offset = -1;
      const content = data.text.toLocaleLowerCase();
      while ((offset = content.indexOf(lower, offset + 1)) >= 0 && results.length < 100) {
        results.push({chapter, title: toc[chapter].title, fraction: offset / Math.max(1, content.length), excerpt: data.text.slice(Math.max(0, offset - 30), offset + query.length + 65)});
      }
    }
    return results;
  }
  remove(id) {
    this.book(id);
    const folder = path.join(this.root, id), trash = path.join(this.root, 'removed');
    fs.mkdirSync(trash, {recursive: true});
    if (fs.existsSync(folder)) fs.renameSync(folder, path.join(trash, `${id}-${Date.now()}`));
    this.value.books = this.value.books.filter(book => book.id !== id);
    this.cache.delete(id); this.save(); return this.state();
  }
}

module.exports = {ReaderLibrary, requestPage, chromiumFetch, readerUserAgent, sourceImportUrl, checkedUrl, MAX_BOOK};
