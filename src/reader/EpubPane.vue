<script setup>
import {nextTick, onUnmounted, ref, watch} from 'vue';
import DOMPurify from 'dompurify';
import JSZip from 'jszip';

const props = defineProps({data: Object, preferences: Object, active: Boolean});
const emit = defineEmits(['toc', 'metadata', 'progress', 'error', 'ready', 'key', 'turn']);
const host = ref();
const transparentStyles = new WeakMap();
let book, rendition, observer, revision = 0, lastCfi = '', locationsReady = false;
async function bounded(promise, milliseconds = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('EPUB 加载超时，文件可能损坏或受 DRM 保护')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const colors = {paper: ['#f8f4eb', '#3d382f'], light: ['#ffffff', '#29352e'], green: ['#e7efe4', '#2d4134'], dark: ['#202824', '#d4ded5'], transparent: ['transparent', '#000000']};
const family = font => font === 'sans' ? '"Microsoft YaHei", sans-serif' : '"Noto Serif SC", "SimSun", serif';
function applyTransparency(contents) {
  const doc = contents.document, active = props.preferences.theme === 'transparent';
  doc.documentElement.toggleAttribute('data-moyu-transparent', active);
  const properties = ['color', 'background-color', 'background-image'];
  if (active) {
    let saved = transparentStyles.get(doc);
    if (!saved) { saved = new Map(); transparentStyles.set(doc, saved); }
    for (const element of [doc.documentElement, doc.body, ...doc.body.querySelectorAll('*')]) {
      if (!element.style) continue;
      if (!saved.has(element)) saved.set(element, properties.map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]));
      element.style.setProperty('color', '#000000', 'important');
      element.style.setProperty('background-color', 'transparent', 'important');
      element.style.setProperty('background-image', 'none', 'important');
    }
  } else {
    const saved = transparentStyles.get(doc);
    if (saved) for (const [element, values] of saved) for (const [name, value, priority] of values) {
      if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name);
    }
    transparentStyles.delete(doc);
  }
}
function applyTheme() {
  if (!rendition) return;
  const p = props.preferences, [background, color] = colors[p.theme] || colors.paper;
  for (const contents of rendition.getContents()) applyTransparency(contents);
  rendition.themes.default({
    html: {background: `${background} !important`, 'color-scheme': p.theme === 'transparent' ? 'light !important' : 'normal'},
    body: {'background': `${background} !important`, color: `${color} !important`, 'font-family': `${family(p.font)} !important`,
      'font-size': `${p.fontSize}px !important`, 'line-height': `${p.lineHeight} !important`, padding: '12px 20px !important'},
    p: {'line-height': `${p.lineHeight} !important`, color: `${color} !important`},
    img: {'max-width': '100% !important', 'object-fit': 'contain'},
    a: {color: 'inherit !important'},
    'html[data-moyu-transparent], html[data-moyu-transparent] body, html[data-moyu-transparent] body *': {color: '#000000 !important', 'background': 'transparent !important'},
  });
  rendition.themes.fontSize(`${p.fontSize}px`);
}
function cleanup() {
  observer?.disconnect(); observer = undefined;
  rendition?.destroy(); rendition = undefined;
  book?.destroy(); book = undefined;
  lastCfi = ''; locationsReady = false;
}
function sanitizeSection(_output, section) {
  const html = DOMPurify.sanitize(section.output, {WHOLE_DOCUMENT: true, ADD_TAGS: ['style', 'link'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ADD_DATA_URI_TAGS: ['image'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base', 'meta'], FORBID_ATTR: ['srcdoc']});
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const a of doc.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) { a.removeAttribute('href'); continue; }
    try { a.setAttribute('href', new URL(raw, `https://moyu.invalid/${section.url.replace(/^\//, '')}`).pathname + new URL(raw, `https://moyu.invalid/${section.url.replace(/^\//, '')}`).hash); }
    catch { a.removeAttribute('href'); }
  }
  const meta = doc.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(meta);
  section.output = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}
function flatten(entries, depth = 0) {
  return entries.flatMap(entry => [{title: entry.label?.trim() || '未命名章节', href: entry.href, depth}, ...flatten(entry.subitems || [], depth + 1)]);
}
function report(location) {
  if (!location?.start || !book) return;
  lastCfi = location.start.cfi;
  const chapter = location.start.index || 0;
  const displayed = location.start.displayed;
  const fraction = displayed?.total > 1 ? (displayed.page - 1) / displayed.total : 0;
  const percentage = locationsReady ? book.locations.percentageFromCfi(lastCfi) : (chapter + fraction) / Math.max(book.spine.length, 1);
  emit('progress', {cfi: lastCfi, chapter, fraction, percent: location.atEnd ? 100 : Math.max(0, percentage * 100), href: location.start.href});
}
async function coverThumbnail() {
  try {
    const url = await book.coverUrl();
    if (!url?.startsWith('blob:') && !url?.startsWith('data:')) return '';
    const image = new Image(); image.src = url;
    await bounded(image.decode(), 5000);
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 240;
    const context = canvas.getContext('2d'); context.fillStyle = '#f8f4eb'; context.fillRect(0, 0, 180, 240);
    const scale = Math.min(180 / image.width, 240 / image.height);
    context.drawImage(image, (180 - image.width * scale) / 2, (240 - image.height * scale) / 2, image.width * scale, image.height * scale);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch { return ''; }
}
async function initialize(data) {
  const token = ++revision;
  cleanup();
  if (!data) return;
  try {
    const bytes = new Uint8Array(data.bytes);
    const zip = await JSZip.loadAsync(bytes);
    const files = Object.values(zip.files);
    if (files.length > 12000 || files.reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0) > 180 * 1024 * 1024) throw new Error('EPUB 解压后的内容过大，无法打开');
    if (!zip.file('META-INF/container.xml')) throw new Error('EPUB 缺少 META-INF/container.xml');
    if (token !== revision) return;
    const {default: ePub} = await import('epubjs');
    if (token !== revision) return;
    const current = book = ePub(bytes.buffer, {replacements: 'blobUrl', openAs: 'binary'});
    await bounded(Promise.all([current.opened, current.ready]));
    if (token !== revision) return;
    const navigation = await current.loaded.navigation;
    emit('toc', flatten(navigation.toc));
    // Registered after EPUB resource substitution, before any document enters an iframe.
    current.spine.hooks.serialize.register(sanitizeSection);
    await nextTick();
    rendition = current.renderTo(host.value, {width: '100%', height: '100%', spread: 'none', flow: props.preferences.readingMode === 'paged' ? 'paginated' : 'scrolled-doc',
      allowScriptedContent: false, allowPopups: false, method: 'srcdoc'});
    rendition.on('relocated', report);
    rendition.on('displayError', error => emit('error', error?.message || 'EPUB 章节无法显示'));
    rendition.on('keydown', event => emit('key', event));
    rendition.hooks.content.register(contents => {
      applyTransparency(contents);
      let pointer;
      contents.document.addEventListener('pointerdown', event => {
        pointer = {x: event.clientX, y: event.clientY, selected: Boolean(contents.window.getSelection()?.toString())};
      });
      contents.document.addEventListener('click', event => {
        if (event.target.closest?.('a') && !event.target.closest('a').getAttribute('href')) { event.preventDefault(); event.stopImmediatePropagation(); }
        const start = pointer; pointer = null;
        if (props.preferences.readingMode !== 'paged' || event.button !== 0 || !start || start.selected
          || contents.window.getSelection()?.toString() || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
          || event.target.closest?.('a,button,input,select,textarea')) return;
        const rect = host.value.getBoundingClientRect();
        const x = event.clientX + contents.window.frameElement.getBoundingClientRect().left;
        emit('turn', x < rect.left + rect.width / 2 ? -1 : 1);
      }, true);
    });
    applyTheme();
    try { await bounded(rendition.display(data.book.progress?.cfi || undefined)); }
    catch { await bounded(rendition.display()); }
    if (token !== revision) return;
    emit('ready');
    observer = new ResizeObserver(() => {
      if (props.active && host.value?.clientWidth && host.value?.clientHeight) rendition?.resize(host.value.clientWidth, host.value.clientHeight);
    });
    observer.observe(host.value);
    const metadata = await current.loaded.metadata;
    const cover = await coverThumbnail();
    if (token === revision) emit('metadata', {title: metadata.title, author: metadata.creator, cover, chapterCount: current.spine.length});
    // Generate CFI locations in the background; the book is already readable.
    try {
      await current.locations.generate(1800);
      if (token === revision) { locationsReady = true; report(rendition.currentLocation()); }
    } catch { /* CFI restoration still works if a book cannot generate percentage locations. */ }
  } catch (error) {
    if (token === revision) { cleanup(); emit('error', error?.message || 'EPUB 解析失败，文件可能损坏或受 DRM 保护'); }
  }
}
async function turn(direction) {
  if (!rendition) return;
  const container = rendition.manager?.container;
  if (props.preferences.readingMode !== 'paged' && container) {
    const end = container.scrollHeight - container.clientHeight;
    if (direction > 0 && container.scrollTop < end - 2 || direction < 0 && container.scrollTop > 2) {
      container.scrollBy({top: direction * container.clientHeight * 0.85, behavior: 'auto'}); return;
    }
  }
  await (direction < 0 ? rendition.prev() : rendition.next());
}
async function display(target) { if (rendition) await rendition.display(target); }
function scroll(amount) { rendition?.manager?.container?.scrollBy({top: amount, behavior: 'auto'}); }
async function search(query) {
  if (!book || !query.trim()) return [];
  const current = book, token = revision, results = [];
  for (const section of current.spine.spineItems) {
    if (token !== revision || results.length >= 100) break;
    const alreadyLoaded = Boolean(section.contents);
    try { await section.load(current.load.bind(current)); results.push(...section.find(query).slice(0, 100 - results.length)); }
    finally { if (!alreadyLoaded) section.unload(); }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return results;
}
async function seek(percent) {
  if (!book) return;
  if (locationsReady) await display(book.locations.cfiFromPercentage(percent / 100));
  else await display(book.spine.spineItems[Math.min(book.spine.length - 1, Math.floor(percent / 100 * book.spine.length))]?.href);
}
watch(() => props.data, initialize, {immediate: true, flush: 'post'});
watch(() => [props.preferences.theme, props.preferences.font, props.preferences.fontSize, props.preferences.lineHeight], applyTheme);
watch(() => props.preferences.readingMode, mode => { rendition?.flow(mode === 'paged' ? 'paginated' : 'scrolled-doc'); });
watch(() => props.active, async active => { if (active) { await nextTick(); if (host.value?.clientWidth) rendition?.resize(host.value.clientWidth, host.value.clientHeight); } });
onUnmounted(() => { ++revision; cleanup(); });
defineExpose({turn, display, search, seek, scroll});
</script>

<template><div ref="host" class="epub-host" aria-label="EPUB 正文"></div></template>
