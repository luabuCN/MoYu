'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  opacity: 1, zoom: 1, pinned: false, mobile: false, theme: 'light',
  pauseOnHide: true, hoverHide: false, hoverHideDelayMs: 1000, edgeHide: false, toolbarAutoHide: false,
  bounds: null, lastUrl: '', bookmarks: [], history: [],
});

function webUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function normalizeInput(value) {
  if (typeof value !== 'string') throw new Error('请输入网址或搜索内容');
  const input = value.trim();
  if (!input || input.length > 4096 || /[\x00-\x1f\x7f]/.test(input)) {
    throw new Error('请输入有效的网址或搜索内容（最多 4096 字）');
  }
  if (/^https?:\/\//i.test(input)) {
    const url = webUrl(input);
    if (!url) throw new Error('网址格式不正确，请检查后重试');
    return url;
  }
  // Host:port must be recognized before rejecting arbitrary URI schemes.
  const host = /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(input);
  if (host && !/\s/.test(input)) {
    const url = webUrl(`http://${input}`);
    if (!url) throw new Error('本地网址格式不正确');
    return url;
  }
  if (/^[^\s/:?#]+\.[^\s/:?#]+(?::\d+)?(?:[/?#]|$)/u.test(input) && !/\s/.test(input)) {
    const url = webUrl(`https://${input}`);
    if (url) return url;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) throw new Error('仅支持 http 和 https 网页');
  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
}

function safeBounds(value, area) {
  const width = Math.min(area.width, Math.max(420, Number(value?.width) || 820));
  const height = Math.min(area.height, Math.max(420, Number(value?.height) || 720));
  return {
    x: Math.round(Math.min(area.x + area.width - width, Math.max(area.x, Number.isFinite(value?.x) ? value.x : area.x + area.width - width - 32))),
    y: Math.round(Math.min(area.y + area.height - height, Math.max(area.y, Number.isFinite(value?.y) ? value.y : area.y + area.height - height - 32))),
    width: Math.round(width), height: Math.round(height),
  };
}

function cleanList(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.filter(item => item && webUrl(item.url) && !seen.has(item.url) && seen.add(item.url))
    .slice(0, 200).map(item => ({url: webUrl(item.url), title: String(item.title || item.url).slice(0, 200), at: Number(item.at) || Date.now()}));
}

class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, {recursive: true});
    this.file = path.join(directory, 'settings.json');
    this.value = structuredClone(DEFAULTS);
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const key of ['pinned', 'mobile', 'pauseOnHide', 'hoverHide', 'edgeHide', 'toolbarAutoHide']) {
        if (typeof saved[key] === 'boolean') this.value[key] = saved[key];
      }
      if (['light', 'dark'].includes(saved.theme)) this.value.theme = saved.theme;
      if (Number.isFinite(saved.opacity)) this.value.opacity = Math.max(.3, Math.min(1, saved.opacity));
      if (Number.isFinite(saved.zoom)) this.value.zoom = Math.max(.5, Math.min(2, saved.zoom));
      if (Number.isSafeInteger(saved.hoverHideDelayMs) && saved.hoverHideDelayMs >= 0) this.value.hoverHideDelayMs = saved.hoverHideDelayMs;
      this.value.bounds = saved.bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved.bounds[key])) ? saved.bounds : null;
      this.value.lastUrl = webUrl(saved.lastUrl) || '';
      this.value.bookmarks = cleanList(saved.bookmarks);
      this.value.history = cleanList(saved.history);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep damaged input for recovery, then start from safe defaults.
        try { fs.copyFileSync(this.file, `${this.file}.invalid-${Date.now()}`); } catch {}
      }
    }
  }
  save() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.value, null, 2), 'utf8');
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, this.file); break; }
      catch (error) {
        if (attempt >= 5 || !['EPERM','EACCES','EBUSY'].includes(error.code)) throw error;
        // Windows file scanners can briefly lock the previous settings file.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
      }
    }
  }
  visit(url, title) {
    if (!webUrl(url)) return;
    this.value.lastUrl = url;
    this.value.history = [{url, title: String(title || url).slice(0, 200), at: Date.now()}, ...this.value.history.filter(item => item.url !== url)].slice(0, 200);
    this.save();
  }
  toggleBookmark(url, title) {
    if (!webUrl(url)) throw new Error('先打开一个网页，再添加收藏');
    const exists = this.value.bookmarks.some(item => item.url === url);
    this.value.bookmarks = exists ? this.value.bookmarks.filter(item => item.url !== url)
      : [{url, title: String(title || url).slice(0, 200), at: Date.now()}, ...this.value.bookmarks].slice(0, 200);
    this.save();
    return !exists;
  }
}

module.exports = {DEFAULTS, webUrl, normalizeInput, safeBounds, Store};
