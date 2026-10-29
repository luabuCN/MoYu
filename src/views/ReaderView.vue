<script setup>
import {computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch} from 'vue';
import AppIcon from '../components/AppIcon.vue';
import UiSelect from '../components/UiSelect.vue';
import UiSlider from '../components/UiSlider.vue';
import UiScrollArea from '../components/UiScrollArea.vue';
import {DialogRoot, DialogOverlay, DialogContent, DialogTitle} from 'reka-ui';
import EpubPane from '../reader/EpubPane.vue';
import {normalizeSource, searchRequest, searchResults, loadToc, loadChapter} from '../reader/sources.js';
import {shortcutActions, defaultShortcuts, eventShortcut, reservedShortcut, shortcutLabel} from '../reader/shortcuts.js';

const props = defineProps({active: Boolean});
const emit = defineEmits(['toast']);
const library = ref({books: [], sources: [], preferences: {theme: 'paper', previousTheme: 'paper', fontSize: 20, lineHeight: 1.9, width: 720, font: 'serif', readingMode: 'scroll', shortcuts: {...defaultShortcuts}, scrollKeys: true, scrollSpeed: 5}});
const page = ref('shelf'), filter = ref('all'), shelfQuery = ref(''), sort = ref('recent');
const book = shallowRef(), epubData = shallowRef(), epub = ref(), toc = ref([]), chapter = shallowRef();
const position = ref({chapter: 0, fraction: 0, percent: 0, cfi: ''});
const drawer = ref(''), tocQuery = ref(''), contentQuery = ref(''), contentResults = ref([]), searching = ref(false);
const settingsTab = ref('appearance'), capturing = ref(''), shortcutMessage = ref('');
const shortcutGroups = [...new Set(shortcutActions.map(item => item.group))];
let unsubscribeRecovery;
const sourceUrl = ref(''), selectedSource = ref(''), novelQuery = ref(''), novelResults = ref([]);
const sourceFilter = ref('all');
const sourceRuns = ref([]), searchedQuery = ref(''), switchingBook = shallowRef();
const busy = ref(false), operation = ref(''), error = ref(''), scrollHost = ref(), removeTarget = ref(), removeDialog = ref();
const epubLoading = ref(false);
const textPage = ref(0), textPages = ref(1);
const scrollChapters = shallowRef([]), continuationLoading = ref(0), continuationErrors = ref({});
let chapterRevision = 0, continuationWorker;
let textObserver, layoutFrame, layoutRevision = 0, pagePointer, readingAnchor;
let openRevision = 0, searchRevision = 0, networkRevision = 0, progressTimer, settingsTimer, pendingProgress, ignoreScroll = false;
const networkSearching = ref(false);
const verificationSkippedSources = new Set();
let drawerOpener;
const preferences = computed(() => library.value.preferences);
const paged = computed(() => preferences.value.readingMode === 'paged');
const shortcuts = computed(() => ({...defaultShortcuts, ...preferences.value.shortcuts}));
const transparentReading = computed(() => props.active && page.value === 'reading' && Boolean(book.value) && preferences.value.theme === 'transparent');
const chapterIndex = computed(() => book.value?.type === 'epub'
  ? toc.value.findIndex(entry => position.value.href && entry.href?.split('#')[0] === position.value.href.split('#')[0])
  : position.value.chapter || 0);
const sources = computed(() => library.value.sources.map(normalizeSource));
const availableSources = computed(() => sources.value.filter(s => s.enabled && !s.warning));
const sourceCounts = computed(() => ({all: sources.value.length, compatible: sources.value.filter(s => !s.warning).length, unsupported: sources.value.filter(s => s.warning).length}));
const visibleSources = computed(() => sources.value.filter(source => sourceFilter.value === 'all' || (sourceFilter.value === 'compatible' ? !source.warning : Boolean(source.warning)))
  .sort((a, b) => Number(Boolean(a.warning)) - Number(Boolean(b.warning)) || Number(b.enabled) - Number(a.enabled)));
const searchSourceOptions = computed(() => {
  const choices = availableSources.value.filter(source => !switchingBook.value || source.id !== switchingBook.value.sourceId);
  return [{value: '', label: `全部已启用书源（${choices.length}）`}, ...choices.map(source => ({value: source.id, label: source.name}))];
});
const currentSource = computed(() => sources.value.find(s => s.id === book.value?.sourceId));
const filteredBooks = computed(() => {
  const query = shelfQuery.value.toLocaleLowerCase();
  return library.value.books.filter(b => (filter.value === 'all' || b.type === filter.value) && `${b.title} ${b.author}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => sort.value === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : (b.lastRead || b.addedAt) - (a.lastRead || a.addedAt));
});
const latestBook = computed(() => [...library.value.books].filter(b => b.lastRead).sort((a, b) => b.lastRead - a.lastRead)[0]);
const visibleToc = computed(() => toc.value.map((entry, index) => ({...entry, index})).filter(entry => entry.title.toLocaleLowerCase().includes(tocQuery.value.toLocaleLowerCase())));
const visibleChapters = computed(() => paged.value ? (chapter.value ? [chapter.value] : []) : scrollChapters.value);
const chapterTitle = computed(() => book.value?.type === 'epub'
  ? toc.value.find(entry => position.value.href && entry.href?.split('#')[0] === position.value.href.split('#')[0])?.title || book.value.title
  : toc.value[position.value.chapter]?.title || book.value?.title);
const isMarked = computed(() => book.value?.marks?.some(mark => mark.key === markKey()));
const typeLabel = type => ({txt: 'TXT', epub: 'EPUB', online: '在线'})[type];
const readingStyle = computed(() => ({'--reading-size': `${preferences.value.fontSize}px`, '--reading-line': preferences.value.lineHeight,
  '--reading-width': `${preferences.value.width}px`, '--reading-font': preferences.value.font === 'sans' ? '"Microsoft YaHei", sans-serif' : '"Noto Serif SC", "SimSun", serif'}));
const percent = value => `${Number(value || 0).toFixed(1)}%`;
const readStatus = b => b.lastRead ? `读到 ${percent(b.progress?.percent)}` : '还未开始';

async function request(name, value) {
  if (!window.moyu?.reader) throw new Error('请重启应用以加载新版阅读器');
  // IPC accepts plain values, not Vue's reactive proxies. Responses become local mutable state.
  const payload = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const response = await window.moyu.reader(name, payload);
  if (!response.ok) throw Object.assign(new Error(response.error || '阅读器操作失败'), {code: response.code, status: response.status, url: response.url});
  return structuredClone(response.result);
}
async function refresh() {
  library.value = await request('state');
  if (library.value.notice) error.value = library.value.notice;
}
async function run(label, callback) {
  if (busy.value) return;
  busy.value = true; operation.value = label; error.value = '';
  try { return await callback(); }
  catch (e) { error.value = e.message || '操作失败，请重试'; }
  finally { busy.value = false; operation.value = ''; }
}
function updateBook(updated) {
  if (book.value?.id === updated.id) book.value = updated;
  const index = library.value.books.findIndex(b => b.id === updated.id);
  if (index >= 0) library.value.books[index] = updated;
}
function scheduleProgress(data) {
  if (!book.value) return;
  position.value = {...position.value, ...data};
  pendingProgress = {id: book.value.id, progress: {...position.value}};
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => void flushProgress(), 300);
}
async function flushProgress() {
  clearTimeout(progressTimer);
  const pending = pendingProgress; pendingProgress = null;
  if (!pending) return;
  try { updateBook(await request('progress', pending)); }
  catch (e) { error.value = `进度保存失败：${e.message}`; }
}
async function importBooks() {
  await run('正在导入电子书…', async () => {
    const result = await request('import');
    await refresh();
    if (result.errors.length) error.value = result.errors.join('\n');
    if (result.imported.length) emit('toast', `已导入 ${result.imported.length} 本书${result.imported.some(r => r.duplicate) ? '（已存在的书籍保留原进度）' : ''}`);
  });
}
async function openBook(item) {
  if (busy.value) return;
  await flushProgress();
  const token = ++openRevision;
  await run('正在打开电子书…', async () => {
    drawer.value = ''; contentResults.value = []; contentQuery.value = ''; tocQuery.value = '';
    resetContinuation(); scrollChapters.value = [];
    epubData.value = null; chapter.value = null; toc.value = [];
    const data = await request('open', {id: item.id});
    if (token !== openRevision) return;
    book.value = data.book; position.value = {...data.book.progress}; updateBook(data.book); page.value = 'reading';
    if (item.type === 'epub') { epubLoading.value = true; epubData.value = data; return; }
    let entries = data.toc;
    if (item.type === 'online' && !entries.length) {
      const source = currentSource.value;
      if (!source || source.warning) throw new Error(source?.warning || '这本书的书源已删除，请重新导入书源');
      entries = await loadToc(source, data.book.url, value => request('fetch', value), data.book);
      entries = await request('toc-save', {id: item.id, entries});
    }
    if (token !== openRevision) return;
    toc.value = entries;
    await displayChapter(Math.min(position.value.chapter || 0, Math.max(entries.length - 1, 0)), position.value.fraction || 0, position.value.scrollFraction);
  });
}
function resetContinuation() {
  ++chapterRevision; continuationWorker = null; continuationLoading.value = 0; continuationErrors.value = {};
  ++layoutRevision; cancelAnimationFrame(layoutFrame); ignoreScroll = false;
}
async function readChapter(index, token) {
  const current = book.value, source = currentSource.value, entry = toc.value[index];
  const id = current.id;
  const valid = () => token === chapterRevision && book.value?.id === id && book.value?.storageId === current.storageId;
  let data = await request('chapter', {id, index});
  if (!valid()) return;
  if (!data) {
    if (!source || source.warning) throw new Error(source?.warning || '书源已删除，未缓存的章节无法读取');
    data = await loadChapter(source, entry, value => request('fetch', value), current);
    if (!valid()) return;
    data = await request('chapter-save', {id, index, data});
  }
  if (valid()) return {...data, index, paragraphs: (data.text || '').split(/\n/).map(p => p.trim()).filter(Boolean)};
}
async function displayChapter(index, fraction = 0, scrollFraction) {
  if (!book.value || !toc.value[index]) return;
  resetContinuation();
  const token = chapterRevision, data = await readChapter(index, token);
  if (!data) return;
  ignoreScroll = true;
  chapter.value = data; scrollChapters.value = [data];
  position.value = {chapter: index, fraction, scrollFraction, percent: (index + fraction) / Math.max(toc.value.length, 1) * 100};
  readingAnchor = null;
  await nextTick();
  // Restoring the last screen of a chapter may need the start of the next one.
  const element = scrollHost.value, article = element?.querySelector('.text-reading');
  if (!paged.value && scrollFraction > 0 && toc.value[index + 1] && article
    && scrollFraction * article.offsetHeight > article.offsetHeight - element.clientHeight) {
    try {
      const next = await readChapter(index + 1, token);
      if (next) scrollChapters.value = [data, next];
    } catch (e) { if (token === chapterRevision) continuationErrors.value = {1: e.message}; }
  }
  if (token !== chapterRevision) return;
  await layoutText(fraction);
  scheduleProgress(position.value);
}
async function goChapter(index, fraction = 0, scrollFraction) {
  if (!toc.value[index]) return;
  await run('正在加载章节…', async () => {
    await flushProgress();
    if (book.value.type === 'epub') await epub.value.display(toc.value[index]?.href);
    else await displayChapter(index, fraction, scrollFraction);
    drawer.value = '';
  });
}
async function backToShelf() {
  if (busy.value) return;
  ++openRevision; ++searchRevision; resetContinuation();
  await flushProgress();
  page.value = 'shelf'; book.value = null; epubData.value = null; epubLoading.value = false; drawer.value = ''; error.value = ''; searching.value = false;
}
function onScroll() {
  if (ignoreScroll || !props.active || page.value !== 'reading' || !scrollHost.value?.clientHeight || !chapter.value || busy.value) return;
  const element = scrollHost.value;
  let index = position.value.chapter, fraction, scrollFraction;
  if (paged.value) {
    textPage.value = Math.min(textPages.value - 1, Math.max(0, Math.round(element.scrollLeft / pageStride())));
    fraction = textPage.value / Math.max(1, textPages.value - 1);
  } else {
    const top = element.getBoundingClientRect().top;
    const articles = [...element.querySelectorAll('.text-reading')];
    const article = articles.find(a => a.getBoundingClientRect().bottom > top + 1) || articles.at(-1);
    if (!article) return;
    const rect = article.getBoundingClientRect(), offset = Math.max(0, top - rect.top);
    index = Number(article.dataset.chapterIndex);
    chapter.value = scrollChapters.value.find(item => item.index === index);
    scrollFraction = Math.min(1, offset / Math.max(1, rect.height));
    fraction = Math.min(1, offset / Math.max(1, rect.height - element.clientHeight));
  }
  scheduleProgress({chapter: index, fraction, scrollFraction, percent: (index + (index === toc.value.length - 1 ? fraction : scrollFraction ?? fraction)) / Math.max(1, toc.value.length) * 100});
  rememberAnchor();
  void maintainContinuation();
}
async function replaceScrollChapters(items, token) {
  const element = scrollHost.value, top = element.getBoundingClientRect().top;
  const anchor = [...element.querySelectorAll('.text-reading')].find(a => a.getBoundingClientRect().bottom > top && items.some(item => item.index === Number(a.dataset.chapterIndex)));
  const before = anchor?.getBoundingClientRect().top, layout = layoutRevision;
  const errors = {...continuationErrors.value};
  if (items[0].index !== scrollChapters.value[0].index) delete errors[-1];
  if (items.at(-1).index !== scrollChapters.value.at(-1).index) delete errors[1];
  continuationErrors.value = errors;
  ignoreScroll = true; scrollChapters.value = items;
  await nextTick();
  if (token !== chapterRevision || element !== scrollHost.value) return;
  if (anchor?.isConnected) element.scrollTop += anchor.getBoundingClientRect().top - before;
  if (layout === layoutRevision) { ignoreScroll = false; onScroll(); }
}
async function maintainContinuation() {
  if (continuationWorker || paged.value || ignoreScroll || busy.value || !props.active || page.value !== 'reading' || !scrollHost.value || !scrollChapters.value.length) return;
  const worker = continuationWorker = {}, token = chapterRevision;
  try {
    while (token === chapterRevision && !paged.value && !ignoreScroll && !busy.value && props.active && page.value === 'reading' && scrollHost.value) {
      const element = scrollHost.value, bounds = element.getBoundingClientRect(), height = element.clientHeight;
      const articles = [...element.querySelectorAll('.text-reading')];
      // Keep the visible passage and a few screens around it, even in very long books.
      const retained = articles.filter(a => { const r = a.getBoundingClientRect(); return r.bottom >= bounds.top - height * 3 && r.top <= bounds.bottom + height * 3; });
      if (retained.length && retained.length < articles.length) {
        const indexes = new Set(retained.map(a => Number(a.dataset.chapterIndex)));
        await replaceScrollChapters(scrollChapters.value.filter(item => indexes.has(item.index)), token);
        continue;
      }
      const first = scrollChapters.value[0], last = scrollChapters.value.at(-1);
      const direction = first.index > 0 && articles[0].getBoundingClientRect().top > bounds.top - height * 1.5 && !continuationErrors.value[-1] ? -1
        : last.index < toc.value.length - 1 && articles.at(-1).getBoundingClientRect().bottom < bounds.bottom + height * 1.5 && !continuationErrors.value[1] ? 1 : 0;
      if (!direction) break;
      continuationLoading.value = direction;
      try {
        const data = await readChapter(direction < 0 ? first.index - 1 : last.index + 1, token);
        if (!data || token !== chapterRevision || paged.value) break;
        // Layout and pointer movement may have changed while an online chapter loaded.
        while (ignoreScroll && token === chapterRevision) await new Promise(resolve => requestAnimationFrame(resolve));
        if (token !== chapterRevision || !props.active || !scrollHost.value || page.value !== 'reading') break;
        await replaceScrollChapters(direction < 0 ? [data, ...scrollChapters.value] : [...scrollChapters.value, data], token);
      } catch (e) {
        if (token === chapterRevision) continuationErrors.value = {...continuationErrors.value, [direction]: e.message || '章节加载失败'};
      }
      if (token === chapterRevision) continuationLoading.value = 0;
    }
  } finally {
    if (continuationWorker === worker) { continuationWorker = null; continuationLoading.value = 0; }
  }
}
function retryContinuation(direction) {
  const errors = {...continuationErrors.value}; delete errors[direction]; continuationErrors.value = errors;
  void maintainContinuation();
}
function pageStride() { return (scrollHost.value?.clientWidth || 0) + 40; }
function rememberAnchor() {
  const element = scrollHost.value;
  readingAnchor = null;
  if (!element || !chapter.value) return;
  const rect = element.getBoundingClientRect();
  // A text range follows the same sentence when columns, fonts or the window change.
  const range = document.caretRangeFromPoint?.(rect.left + rect.width * 0.25, rect.top + Math.min(24, rect.height / 2));
  if (range && range.startContainer.nodeType === Node.TEXT_NODE && element.contains(range.startContainer)) {
    const end = Math.min(range.startOffset + 1, range.startContainer.length);
    range.setEnd(range.startContainer, end);
    readingAnchor = {range, offset: range.getBoundingClientRect().top - rect.top};
  }
}
async function layoutText(fraction = position.value.fraction || 0, anchor = null) {
  const token = ++layoutRevision;
  ignoreScroll = true;
  await nextTick();
  const element = scrollHost.value;
  if (!element?.clientWidth || !element.clientHeight) { ignoreScroll = false; return; }
  element.style.setProperty('--page-width', `${element.clientWidth}px`);
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (token !== layoutRevision || element !== scrollHost.value) return;
  const bounds = element.getBoundingClientRect();
  const rect = anchor && element.contains(anchor.range.startContainer) ? anchor.range.getBoundingClientRect() : null;
  if (paged.value) {
    textPages.value = Math.max(1, Math.round((element.scrollWidth + 40) / pageStride()));
    const index = rect ? Math.floor((rect.left - bounds.left + element.scrollLeft + 1) / pageStride()) : Math.round(fraction * (textPages.value - 1));
    textPage.value = Math.max(0, Math.min(textPages.value - 1, index));
    element.scrollLeft = textPage.value * pageStride(); element.scrollTop = 0;
  } else {
    textPage.value = 0; textPages.value = 1; element.scrollLeft = 0;
    const article = element.querySelector(`[data-chapter-index="${position.value.chapter}"]`);
    const height = article?.getBoundingClientRect().height || 0;
    const top = article ? element.scrollTop + article.getBoundingClientRect().top - bounds.top : 0;
    element.scrollTop = rect ? element.scrollTop + rect.top - bounds.top - anchor.offset : top + (Number.isFinite(position.value.scrollFraction)
      ? position.value.scrollFraction * height : fraction * Math.max(0, height - element.clientHeight));
  }
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (token !== layoutRevision) return;
  ignoreScroll = false; onScroll(); rememberAnchor();
}
function queueTextLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => { void layoutText(position.value.fraction, readingAnchor); });
}
function startPageClick(event) {
  pagePointer = {x: event.clientX, y: event.clientY, selected: Boolean(window.getSelection()?.toString())};
}
function pageClick(event) {
  const pointer = pagePointer; pagePointer = null;
  if (!paged.value || event.button !== 0 || !pointer || pointer.selected || window.getSelection()?.toString()
    || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5
    || event.target.closest('a,button,input,select,textarea')) return;
  const rect = scrollHost.value.getBoundingClientRect();
  void turn(event.clientX < rect.left + rect.width / 2 ? -1 : 1);
}
function turnChapter(direction) { if (!busy.value && !epubLoading.value) void goChapter(chapterIndex.value + direction); }
function toggleReadingMode() { changeSetting('readingMode', paged.value ? 'scroll' : 'paged'); }
async function turn(direction) {
  if (busy.value || !book.value || drawer.value) return;
  if (book.value.type === 'epub') {
    try { await epub.value?.turn(direction); } catch (e) { error.value = e.message; }
    return;
  }
  const target = scrollHost.value;
  if (!target || ignoreScroll) return;
  if (paged.value) {
    const index = textPage.value + direction;
    if (index >= 0 && index < textPages.value) {
      target.scrollLeft = index * pageStride(); onScroll();
    } else await goChapter(position.value.chapter + direction, direction < 0 ? 1 : 0);
    return;
  }
  target.scrollBy({top: direction * target.clientHeight * 0.85, behavior: 'auto'});
  void maintainContinuation();
}
function markKey() { return book.value?.type === 'epub' ? position.value.cfi || '' : `${position.value.chapter}:${Math.floor(position.value.fraction * 100)}`; }
async function toggleMark() {
  if (!book.value || !markKey()) return;
  try {
    updateBook(await request('mark', {id: book.value.id, position: {...position.value, key: markKey(), title: chapterTitle.value}}));
    emit('toast', isMarked.value ? '已添加书签' : '已取消书签');
  } catch (e) { error.value = e.message; }
}
async function jumpMark(mark) {
  if (book.value.type === 'epub') {
    try { await epub.value.display(mark.cfi); drawer.value = ''; } catch (e) { error.value = e.message; }
  } else await goChapter(mark.chapter, mark.fraction, mark.scrollFraction);
}
function changeSetting(name, value) {
  const anchor = readingAnchor;
  if (name === 'readingMode') {
    resetContinuation();
    // Keep the current article keyed across modes so its text range survives reflow.
    if (chapter.value) scrollChapters.value = [chapter.value];
  }
  const previousTheme = name === 'theme' && value === 'transparent' && preferences.value.theme !== 'transparent' ? preferences.value.theme : preferences.value.previousTheme;
  library.value.preferences = {...preferences.value, previousTheme, [name]: value};
  if (name === 'theme' && value === 'transparent') { drawer.value = ''; document.activeElement?.blur(); }
  if (['readingMode', 'fontSize', 'lineHeight', 'width', 'font'].includes(name) && chapter.value) void layoutText(position.value.fraction, anchor);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => { void savePreferences().catch(e => { error.value = e.message; }); }, 200);
}
async function savePreferences() { clearTimeout(settingsTimer); return request('preferences', library.value.preferences); }
function exitTransparent() { if (preferences.value.theme === 'transparent') changeSetting('theme', preferences.value.previousTheme || 'paper'); }
function toggleTransparent() { if (transparentReading.value) exitTransparent(); else changeSetting('theme', 'transparent'); }
function openReadingSettings() { exitTransparent(); drawer.value = 'settings'; }
function cancelCapture() {
  if (!capturing.value) return;
  capturing.value = '';
  void request('shortcut-capture', {active: false}).catch(() => {});
}
function captureShortcut(id) {
  capturing.value = id; shortcutMessage.value = '请按新的按键或组合键，Esc 取消。';
  void request('shortcut-capture', {active: true}).catch(e => { shortcutMessage.value = e.message; capturing.value = ''; });
}
function resetShortcuts() {
  cancelCapture(); changeSetting('shortcuts', {...defaultShortcuts}); changeSetting('scrollKeys', true); changeSetting('scrollSpeed', 5);
  shortcutMessage.value = '已恢复默认快捷键。';
}
function captureKey(event) {
  event.preventDefault(); event.stopPropagation();
  if (event.key === 'Escape') { cancelCapture(); shortcutMessage.value = '已取消修改。'; return; }
  const key = eventShortcut(event);
  if (!key || event.repeat) return;
  if (reservedShortcut(key)) { shortcutMessage.value = '此按键由系统或浏览器使用，请换一组按键。'; return; }
  if (capturing.value === 'toggleTransparent' && !/^(?:Ctrl|Alt|Meta)\+|\+(?:Ctrl|Alt|Meta)\+|^F\d+$/.test(key)) { shortcutMessage.value = '透明切换请使用 Ctrl、Alt、Win 组合键或功能键。'; return; }
  const conflict = shortcutActions.find(item => item.id !== capturing.value && shortcuts.value[item.id] === key);
  if (conflict) { shortcutMessage.value = `此按键已用于“${conflict.label}”，请换一组按键。`; return; }
  changeSetting('shortcuts', {...shortcuts.value, [capturing.value]: key});
  cancelCapture(); shortcutMessage.value = `已设置为 ${shortcutLabel(key)}。`;
}
function scrollReading(direction) {
  if (busy.value || paged.value || preferences.value.scrollKeys === false) return;
  const amount = (preferences.value.scrollSpeed || 5) * 24 * direction;
  if (book.value?.type === 'epub') epub.value?.scroll(amount);
  else scrollHost.value?.scrollBy({top: amount, behavior: 'auto'});
}
async function updateMetadata(data) {
  const id = book.value?.id;
  if (!id) return;
  try { updateBook(await request('metadata', {id, data})); } catch (e) { error.value = e.message; }
}
async function searchContent() {
  if (!book.value || searching.value || !contentQuery.value.trim()) return;
  const token = ++searchRevision;
  searching.value = true; contentResults.value = []; error.value = '';
  try {
    const results = book.value.type === 'epub' ? await epub.value.search(contentQuery.value) : await request('search', {id: book.value.id, query: contentQuery.value});
    if (token === searchRevision) contentResults.value = results;
  } catch (e) { error.value = e.message; }
  finally { if (token === searchRevision) searching.value = false; }
}
async function jumpResult(result) {
  if (result.cfi) {
    try { await epub.value.display(result.cfi); drawer.value = ''; } catch (e) { error.value = e.message; }
  } else await goChapter(result.chapter, result.fraction);
}
async function importSources(fromUrl = false) {
  await run('正在导入书源…', async () => {
    if (fromUrl && !sourceUrl.value.trim()) throw new Error('请先填写书源 JSON 链接');
    const result = await request('sources-import', fromUrl ? {url: sourceUrl.value.trim()} : {});
    if (result.canceled) return;
    if (result.verificationSkipped) { emit('toast', '书源链接需要人机验证，已跳过导入'); return; }
    await refresh(); sourceUrl.value = '';
    emit('toast', `已导入 ${result.imported} 个书源，当前 ${sourceCounts.value.compatible} 个规则兼容${result.skipped ? `，跳过 ${result.skipped} 个无效配置` : ''}`);
  });
}
async function sourceAction(source, remove = false) {
  await run(remove ? '正在移除书源…' : '正在更新书源…', async () => {
    library.value = await request(remove ? 'source-remove' : 'source-toggle', {id: source.id});
    verificationSkippedSources.delete(source.id);
    if (selectedSource.value && !availableSources.value.some(source => source.id === selectedSource.value)) selectedSource.value = '';
  });
}
async function findNovels(onlyId = '') {
  if (networkSearching.value) cancelNovelSearch();
  if (busy.value) return;
  const token = ++networkRevision;
  const group = `novel-${token}`, query = novelQuery.value.trim(), selection = typeof onlyId === 'string' && onlyId ? onlyId : selectedSource.value;
  busy.value = true; networkSearching.value = true; operation.value = '正在搜索书源…'; error.value = '';
  try {
    if (!query) throw new Error('请输入书名或作者');
    const chosen = availableSources.value.filter(source => (!selection || source.id === selection) && (!switchingBook.value || source.id !== switchingBook.value.sourceId));
    if (!chosen.length) throw new Error('请先导入并启用兼容的书源');
    const retry = typeof onlyId === 'string' && Boolean(onlyId) && searchedQuery.value === query;
    novelResults.value = retry ? novelResults.value.filter(result => result.sourceId !== onlyId) : [];
    searchedQuery.value = query;
    const runs = chosen.map(source => ({id: source.id, name: source.name, status: 'pending', count: 0, message: '等待搜索'}));
    sourceRuns.value = retry ? [...sourceRuns.value.filter(row => row.id !== onlyId), ...runs] : runs;
    // Two concurrent sources keep both the UI and source websites responsive.
    let cursor = 0;
    const worker = async () => {
      while (cursor < chosen.length && token === networkRevision) {
        const source = chosen[cursor++];
        const row = sourceRuns.value.find(row => row.id === source.id);
        if (verificationSkippedSources.has(source.id)) {
          row.status = 'skipped'; row.code = 'verification'; row.message = '需要人机验证，本次运行已跳过';
          continue;
        }
        row.status = 'loading'; row.message = '正在搜索…';
        try {
          const response = await request('fetch', {...searchRequest(source, query), group});
          if (token !== networkRevision) return;
          const results = await searchResults(source, response);
          if (token !== networkRevision) return;
          novelResults.value.push(...results);
          row.status = results.length ? 'success' : 'empty'; row.count = results.length;
          row.message = results.length ? `找到 ${results.length} 本` : '网站已响应，没有相关结果';
        } catch (e) {
          if (token === networkRevision) {
            row.code = e.code;
            if (e.code === 'verification') {
              verificationSkippedSources.add(source.id);
              row.status = 'skipped'; row.message = '需要人机验证，本次运行已跳过';
            } else { row.status = 'error'; row.message = e.message; }
          }
        }
      }
    };
    await Promise.all([worker(), worker()]);
  } catch (e) { if (token === networkRevision) error.value = e.message; }
  finally { if (token === networkRevision) { busy.value = false; networkSearching.value = false; operation.value = ''; } }
}
function cancelNovelSearch() {
  void request('fetch-cancel', {group: `novel-${networkRevision}`}).catch(() => {});
  ++networkRevision; busy.value = false; networkSearching.value = false; operation.value = '';
  sourceRuns.value.forEach(row => { if (['loading', 'pending'].includes(row.status)) { row.status = 'canceled'; row.message = '已停止'; } });
}
function changeSearchSource() {
  if (networkSearching.value) cancelNovelSearch();
  novelResults.value = []; sourceRuns.value = []; searchedQuery.value = '';
  if (novelQuery.value.trim()) void findNovels();
}
async function openSource(source) {
  try { await request('source-open', {id: source.id}); emit('toast', '完成网站验证后，点击顶部书本图标返回阅读器，再点击该书源的“重试”'); }
  catch (e) { error.value = e.message; }
}
const nameKey = value => String(value || '').normalize('NFKC').replace(/^(?:作者|著者)\s*[:：]?\s*/, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const isSameBook = result => !switchingBook.value || (nameKey(result.title) === nameKey(switchingBook.value.title) &&
  (!switchingBook.value.author || !result.author || nameKey(result.author) === nameKey(switchingBook.value.author)));
async function startSwitch() {
  if (busy.value || book.value?.type !== 'online') return;
  await flushProgress();
  switchingBook.value = book.value; drawer.value = ''; page.value = 'discover'; selectedSource.value = '';
  novelQuery.value = book.value.title; sourceRuns.value = []; novelResults.value = [];
  await findNovels();
}
function cancelSwitch() {
  if (networkSearching.value) cancelNovelSearch();
  if (busy.value) return;
  switchingBook.value = null; page.value = 'reading'; error.value = '';
  void nextTick().then(() => { if (scrollHost.value) scrollHost.value.scrollTop = (position.value.fraction || 0) * Math.max(0, scrollHost.value.scrollHeight - scrollHost.value.clientHeight); });
}
async function useSource(result) {
  if (!switchingBook.value || !isSameBook(result)) return;
  await run('正在检查新书源目录和正文…', async () => {
    resetContinuation();
    const previous = switchingBook.value, source = sources.value.find(source => source.id === result.sourceId);
    if (!source || source.warning) throw new Error('新书源规则不兼容');
    const entries = await loadToc(source, result.url, value => request('fetch', value), result);
    const oldTitle = toc.value[position.value.chapter]?.title;
    let index = oldTitle ? entries.findIndex(entry => nameKey(entry.title) === nameKey(oldTitle)) : -1;
    const matched = index >= 0;
    if (index < 0) index = Math.min(position.value.chapter || 0, entries.length - 1);
    const loaded = await loadChapter(source, entries[index], value => request('fetch', value), result);
    await flushProgress();
    const response = await request('online-switch', {id: previous.id, previousSourceId: previous.sourceId, previousUrl: previous.url,
      sourceId: source.id, url: result.url, entries, index, chapter: loaded});
    updateBook(response.book); toc.value = response.toc; position.value = response.book.progress;
    switchingBook.value = null; page.value = 'reading'; contentResults.value = [];
    await displayChapter(index, response.book.progress.fraction, response.book.progress.scrollFraction);
    emit('toast', matched ? `已切换到${source.name}，接着本章阅读` : `已切换到${source.name}；章节名称不同，已定位到第 ${index + 1} 项，请核对目录`);
  });
}
async function addNovel(result) {
  await run('正在加入书架…', async () => {
    const added = await request('online-add', result); await refresh();
    emit('toast', `《${added.title}》已加入书架`);
  });
}
const onShelf = result => library.value.books.some(b => b.type === 'online' && b.sourceId === result.sourceId && b.url === result.url);
async function refreshToc() {
  await run('正在更新目录…', async () => {
    resetContinuation();
    if (!currentSource.value || currentSource.value.warning) throw new Error('请重新导入兼容的书源');
    const entries = await loadToc(currentSource.value, book.value.url, value => request('fetch', value), book.value);
    toc.value = await request('toc-save', {id: book.value.id, entries});
    const data = await request('open', {id: book.value.id}); updateBook(data.book);
    await displayChapter(data.book.progress.chapter, data.book.progress.fraction, data.book.progress.scrollFraction);
    emit('toast', `目录已更新，共 ${toc.value.length} 章`);
  });
}
function confirmRemove(item) { removeTarget.value = item; removeDialog.value.showModal(); }
async function removeBook() {
  removeDialog.value.close();
  await run('正在移除书籍…', async () => {
    library.value = await request('remove', {id: removeTarget.value.id}); removeTarget.value = null;
    emit('toast', '已从书架移除');
  });
}
function keydown(event) {
  if (!props.active || page.value !== 'reading') return;
  if (event.isComposing) return;
  if (capturing.value) { captureKey(event); return; }
  // Let nested controls consume their own navigation keys and Escape first.
  if (event.target?.closest?.('[role=combobox][aria-expanded=true], [role=option], [role=listbox]')) return;
  if (event.target?.closest?.('[role=slider]') && event.key !== 'Escape') return;
  if (event.key === 'Escape') {
    if (transparentReading.value) { event.preventDefault(); exitTransparent(); }
    else if (drawer.value) { drawer.value = ''; event.preventDefault(); }
    return;
  }
  const shortcut = eventShortcut(event);
  if (shortcut === shortcuts.value.toggleTransparent) { event.preventDefault(); if (!event.repeat) toggleTransparent(); return; }
  if (shortcut === shortcuts.value.openSettings && (!event.target?.closest?.('input,textarea,select,[contenteditable=true]') || event.ctrlKey || event.altKey || event.metaKey || /^F\d+$/.test(shortcut))) { event.preventDefault(); if (!event.repeat) openReadingSettings(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); exitTransparent(); drawer.value = 'search'; return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); void toggleMark(); return; }
  if (drawer.value || event.target?.closest?.('input,textarea,select,[role=combobox],[role=slider],[contenteditable=true]')) return;
  if ((event.code === 'Space' || event.key === ' ') && event.target?.closest?.('button')) return;
  const command = Object.entries(shortcuts.value).find(([, key]) => key === shortcut)?.[0];
  if (command) {
    event.preventDefault();
    if (command === 'previousPage' || command === 'nextPage') void turn(command === 'previousPage' ? -1 : 1);
    if (command === 'previousChapter' || command === 'nextChapter') turnChapter(command === 'previousChapter' ? -1 : 1);
    if (command === 'scrollUp' || command === 'scrollDown') scrollReading(command === 'scrollUp' ? -1 : 1);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'PageDown' || event.code === 'Space') { event.preventDefault(); void turn(event.shiftKey ? -1 : 1); }
  if (event.key === 'PageUp') { event.preventDefault(); void turn(-1); }
}
watch(() => props.active, active => { if (!active) { void flushProgress(); ++searchRevision; searching.value = false; } });
watch([busy, () => props.active, page], () => { if (!busy.value && props.active && page.value === 'reading') { onScroll(); void maintainContinuation(); } }, {flush: 'post'});
watch(transparentReading, async (active, old) => {
  document.documentElement.dataset.readerTransparent = String(active);
  if (old === undefined && !active) return;
  try {
    if (active) await savePreferences();
    // A later mode switch wins if saving settings took time.
    if (active !== transparentReading.value) return;
    await request('presentation', {transparent: active});
    if (active) { document.activeElement?.blur(); await nextTick(); scrollHost.value?.focus({preventScroll: true}); }
  } catch (e) { error.value = e.message; if (active) exitTransparent(); }
}, {immediate: true, flush: 'post'});
watch([drawer, settingsTab, () => props.active], () => { if (drawer.value !== 'settings' || settingsTab.value !== 'shortcuts' || !props.active) cancelCapture(); });
watch(scrollHost, element => {
  textObserver?.disconnect();
  if (element) {
    let width = element.clientWidth, height = element.clientHeight;
    textObserver = new ResizeObserver(() => {
      if (width === element.clientWidth && height === element.clientHeight) return;
      width = element.clientWidth; height = element.clientHeight; queueTextLayout();
    });
    textObserver.observe(element);
  }
  else { ++layoutRevision; cancelAnimationFrame(layoutFrame); readingAnchor = null; }
});
watch(novelQuery, () => {
  if (networkSearching.value) cancelNovelSearch();
  if (searchedQuery.value && novelQuery.value.trim() !== searchedQuery.value) { novelResults.value = []; sourceRuns.value = []; searchedQuery.value = ''; }
}, {flush: 'sync'});
watch(drawer, async (value, old) => {
  if (value) {
    if (!old) drawerOpener = document.activeElement;
    // DialogContent handles initial focus and trapping; retain the opener for restore.
  } else if (props.active && drawerOpener?.isConnected) drawerOpener.focus();
});
function visibility() { if (document.hidden) void flushProgress(); }
onMounted(() => { void refresh().catch(e => { error.value = e.message; }); document.addEventListener('keydown', keydown, true); document.addEventListener('visibilitychange', visibility); unsubscribeRecovery = window.moyu?.onReaderRecovery?.(exitTransparent); });
onUnmounted(() => { if (networkSearching.value) cancelNovelSearch(); resetContinuation(); cancelCapture(); unsubscribeRecovery?.(); document.documentElement.dataset.readerTransparent = 'false'; if (transparentReading.value) void request('presentation', {transparent: false}).catch(() => {}); ++openRevision; ++searchRevision; ++networkRevision; ++layoutRevision; textObserver?.disconnect(); cancelAnimationFrame(layoutFrame); void flushProgress(); clearTimeout(settingsTimer); document.removeEventListener('keydown', keydown, true); document.removeEventListener('visibilitychange', visibility); });
</script>

<template>
  <section id="reader-panel" class="panel reader-panel" :class="{'is-reading': page === 'reading'}" :data-paper="preferences.theme" :style="readingStyle" aria-label="阅读器">
    <template v-if="page !== 'reading'">
      <header class="library-header"><div><span class="reader-eyebrow">YOUR QUIET CORNER</span><h1>{{ page === 'sources' ? '书源管理' : page === 'discover' ? '发现下一本好书' : '我的书架' }}</h1><p>{{ page === 'shelf' ? '故事不必一口气读完，好时光可以慢慢来。' : '循着自己的喜好，找一个想停留的故事。' }}</p></div>
        <button v-if="!switchingBook" class="reader-primary" :disabled="busy" @click="importBooks"><AppIcon name="upload" />导入书籍</button>
      </header>
      <nav v-if="!switchingBook" class="library-tabs" aria-label="阅读器导航">
        <button v-for="tab in [{id:'shelf',label:'我的书架',icon:'book'},{id:'discover',label:'找小说',icon:'search'},{id:'sources',label:'书源管理',icon:'layers'}]" :key="tab.id" :aria-current="page === tab.id ? 'page' : undefined" :disabled="busy" @click="page = tab.id; error = ''"><AppIcon :name="tab.icon" />{{ tab.label }}<span v-if="tab.id === 'shelf'">{{ library.books.length }}</span></button>
      </nav>
      <p v-if="error" class="reader-alert" role="alert">{{ error }}<button aria-label="关闭提示" @click="error = ''"><AppIcon name="close" /></button></p>
      <div v-if="busy" class="reader-loading" role="status">{{ operation }}<button v-if="networkSearching" class="reader-secondary" @click="cancelNovelSearch">停止搜索</button></div>
      <template v-if="page === 'shelf'">
        <button v-if="latestBook && !shelfQuery && filter === 'all'" class="continue-reading" :disabled="busy" @click="openBook(latestBook)">
          <span class="continue-book-symbol"><AppIcon name="book" /></span><span><small>接着读</small><strong>{{ latestBook.title }}</strong><span>{{ latestBook.author || typeLabel(latestBook.type) }} · {{ readStatus(latestBook) }}</span></span><span class="continue-cta">继续阅读<AppIcon name="arrow" /></span>
        </button>
        <div class="library-tools"><div class="book-filters" aria-label="书籍格式"><button v-for="tab in [{id:'all',label:'全部'},{id:'txt',label:'TXT'},{id:'epub',label:'EPUB'},{id:'online',label:'在线'}]" :key="tab.id" :aria-pressed="filter === tab.id" @click="filter = tab.id">{{ tab.label }}</button></div>
          <label class="reader-search"><AppIcon name="search" /><input v-model="shelfQuery" aria-label="搜索书架" placeholder="搜索书名、作者" /></label>
          <UiSelect v-model="sort" label="书架排序" :options="[{value:'recent',label:'最近阅读'},{value:'title',label:'书名排序'}]" />
        </div>
        <div v-if="filteredBooks.length" class="book-grid">
          <article v-for="item in filteredBooks" :key="item.id" class="shelf-book">
            <button class="book-open" :disabled="busy" @click="openBook(item)"><span class="book-cover" :data-type="item.type"><img v-if="item.cover" :src="item.cover" alt="" /><template v-else><span class="cover-rule"></span><strong>{{ item.title }}</strong><small>{{ item.author || '沫鱼 · 私人书架' }}</small><AppIcon name="book" /></template><span class="book-format">{{ typeLabel(item.type) }}</span></span><strong class="book-name">{{ item.title }}</strong><span class="book-author">{{ item.author || (item.type === 'online' ? item.sourceName : '本地导入') }}</span><span class="book-progress"><span :style="{width: `${item.progress?.percent || 0}%`}"></span></span><span class="book-status">{{ readStatus(item) }}</span></button>
            <button class="book-remove icon-button" :aria-label="`移除《${item.title}》`" title="从书架移除" :disabled="busy" @click="confirmRemove(item)"><AppIcon name="trash" /></button>
          </article>
        </div>
        <div v-else class="reader-empty"><AppIcon name="book" /><h2>{{ library.books.length ? '没有找到这本书' : '你的下一段故事，从这里开始' }}</h2><p>{{ library.books.length ? '换个书名，或试试其他分类。' : '导入 TXT、EPUB，或到「找小说」直接搜索。' }}</p><button v-if="!library.books.length" class="reader-primary" :disabled="busy" @click="importBooks">导入第一本书<AppIcon name="arrow" /></button></div>
        <footer class="library-footnote">本地书籍离线阅读 · 自动记住阅读位置 · 单本最高 50 MB</footer>
      </template>
      <template v-if="page === 'sources'">
        <div class="source-intro"><h2>故事来自你选择的地方。</h2><p>默认提供笔趣阁、番茄小说和玄幻文学，到「找小说」即可搜索。也可导入其他书源 JSON 文件、订阅链接或 Yiove 列表页。</p><button class="reader-secondary" :disabled="busy" @click="importSources(false)"><AppIcon name="upload" />导入 JSON 文件</button></div>
        <form class="source-import" @submit.prevent="importSources(true)"><label for="source-url">书源 JSON 链接</label><div><input id="source-url" v-model="sourceUrl" type="url" placeholder="https://…/sources.json" required /><button class="reader-primary" :disabled="busy" type="submit">导入链接</button></div></form>
        <p class="reader-note">支持阅读 3.0 的 CSS、XPath、JSONPath、JavaScript、共享脚本库和动态模板，也支持 eReader JSON / 静态 source.ts 与 Moyu JSON。需要人机验证的书源会自动跳过。</p>
        <template v-if="sources.length">
          <div class="source-summary" role="status"><strong>{{ sourceCounts.all }} 个书源 · {{ sourceCounts.compatible }} 个规则兼容 · {{ sourceCounts.unsupported }} 个暂不支持</strong><p>合集可能包含当前尚未支持的规则，可先筛选「规则兼容」。兼容性提示用于说明规则范围，网站能否访问以实际搜索为准。</p></div>
          <nav class="source-filters book-filters" aria-label="筛选书源兼容性"><button v-for="tab in [{id:'all',label:'全部'},{id:'compatible',label:'规则兼容'},{id:'unsupported',label:'暂不支持'}]" :key="tab.id" :aria-pressed="sourceFilter === tab.id" @click="sourceFilter = tab.id">{{ tab.label }} <span>{{ sourceCounts[tab.id] }}</span></button></nav>
          <div v-if="visibleSources.length" class="source-list"><article v-for="source in visibleSources" :key="source.id"><div><strong>{{ source.name }}</strong><small>{{ source.format }} · {{ source.baseUrl }}</small><details v-if="source.warning" class="source-compat-details"><summary>查看暂不支持的原因</summary><ul><li v-for="issue in source.issues" :key="issue.code">{{ issue.message }}</li></ul></details></div><button class="reader-secondary" :disabled="busy || Boolean(source.warning)" :aria-pressed="source.enabled && !source.warning" @click="sourceAction(source)">{{ source.warning ? '暂不支持' : source.enabled ? '已启用' : '已停用' }}</button><button class="icon-button" :disabled="busy" :aria-label="`移除书源 ${source.name}`" @click="sourceAction(source, true)"><AppIcon name="trash" /></button></article></div>
          <div v-else class="reader-empty compact-empty"><AppIcon name="layers" /><h2>{{ sourceFilter === 'compatible' ? '这个合集暂时没有兼容的规则' : '没有此类书源' }}</h2><p>{{ sourceFilter === 'compatible' ? '可导入 eReader JSON 或静态 CSS 书源，现有书源会继续保留。' : '切换筛选查看其他书源。' }}</p><button class="reader-secondary" @click="sourceFilter = 'all'">查看全部书源</button></div>
        </template>
        <div v-else class="reader-empty compact-empty"><AppIcon name="layers" /><h2>还没有书源</h2><p>导入后可以启用、停用或移除，书籍与进度独立保留。</p></div>
      </template>
      <template v-if="page === 'discover'">
        <div v-if="switchingBook" class="switch-notice"><div><strong>为《{{ switchingBook.title }}》切换书源</strong><p>当前：{{ switchingBook.sourceName }} · {{ switchingBook.author || '作者未记录，请核对候选书籍' }}</p><p>新书源的目录与正文加载成功后才会切换，优先按章节名称续读。</p></div><button class="reader-secondary" :disabled="busy && !networkSearching" @click="cancelSwitch">返回阅读</button></div>
        <form class="novel-search" @submit.prevent="findNovels()"><label for="novel-query">{{ switchingBook ? '搜索同一本书' : '想读什么故事？' }}</label><div><input id="novel-query" v-model="novelQuery" placeholder="输入书名或作者" :readonly="Boolean(switchingBook)" required /><button class="reader-primary" :disabled="busy && !networkSearching" type="submit"><AppIcon name="search" />{{ networkSearching ? '重新搜索' : '搜索' }}</button></div><label class="source-select-label" for="search-source">搜索书源 · 切换后自动搜索</label><UiSelect id="search-source" :model-value="selectedSource" label="搜索书源" :disabled="busy && !networkSearching" :options="searchSourceOptions" @update:model-value="selectedSource = $event; changeSearchSource()" /></form>
        <div v-if="!availableSources.length" class="reader-empty compact-empty"><AppIcon name="layers" /><h2>暂无启用的书源</h2><p>到书源管理启用已有书源，或从本地文件、链接导入。</p><button class="reader-secondary" @click="page = 'sources'">管理书源<AppIcon name="arrow" /></button></div>
        <section v-if="sourceRuns.length" class="source-run-list" aria-label="各书源搜索状态"><p class="reader-note" role="status">“{{ searchedQuery }}” · {{ novelResults.length }} 个结果 · {{ sourceRuns.filter(row => !['pending','loading'].includes(row.status)).length }} / {{ sourceRuns.length }} 个书源已完成</p><article v-for="row in sourceRuns" :key="row.id" :data-status="row.status"><div><strong>{{ row.name }}</strong><p>{{ row.message }}</p></div><div class="source-run-actions"><button v-if="['error','empty','canceled'].includes(row.status)" class="reader-secondary" :disabled="busy" @click="findNovels(row.id)">重试</button><button v-if="row.status === 'error'" class="reader-secondary" :disabled="busy" @click="openSource(row)">打开网站</button></div></article></section>
        <div v-if="novelResults.length" class="novel-results"><article v-for="result in novelResults" :key="result.sourceId + result.url"><span class="novel-symbol"><AppIcon name="book" /></span><div><h3>{{ result.title }}</h3><p>{{ result.author || '作者未知' }}<span> · {{ result.sourceName }}</span></p><small v-if="switchingBook && !isSameBook(result)">书名或作者不一致</small></div><button v-if="switchingBook" class="reader-secondary" :disabled="busy || !isSameBook(result)" @click="useSource(result)">使用此书源</button><button v-else class="reader-secondary" :disabled="busy || onShelf(result)" @click="addNovel(result)">{{ onShelf(result) ? '已在书架' : '加入书架' }}</button></article></div>
        <p v-else-if="!busy && searchedQuery && sourceRuns.length" class="reader-note">这次没有可显示的书籍。上方列出了每个书源的原因，可重试或切换其他书源。</p>
        <p v-else-if="!busy && availableSources.length" class="reader-note">输入书名或作者开始搜索；需要人机验证的书源会自动跳过。</p>
      </template>
    </template>

    <template v-else-if="book">
      <p v-if="error" class="reader-alert reading-alert" role="alert">{{ error }}<button aria-label="关闭提示" @click="error = ''"><AppIcon name="close" /></button></p>
      <div v-if="busy || epubLoading" class="reading-busy" role="status">{{ operation || '正在排版 EPUB…' }}</div>
      <div class="reading-stage">
        <EpubPane v-if="book.type === 'epub' && epubData" ref="epub" :data="epubData" :preferences="preferences" :active="active" @toc="entries => toc = entries" @progress="scheduleProgress" @metadata="updateMetadata" @ready="epubLoading = false" @error="message => { error = message; epubLoading = false; }" @key="keydown" @turn="turn" />
        <div v-else class="text-reading-layout" :class="{'is-paged': paged}">
          <div ref="scrollHost" class="text-reading-scroll" tabindex="0" aria-label="小说正文" :aria-describedby="paged ? 'reader-page-hint' : undefined" @scroll.passive="onScroll" @pointerdown="startPageClick" @click="pageClick">
            <article v-for="item in visibleChapters" :key="item.index" class="text-reading" :data-chapter-index="item.index"><p class="chapter-kicker">{{ book.type === 'txt' ? '本地 · TXT' : book.sourceName }}<span>{{ item.index + 1 }} / {{ toc.length }}</span></p><h1>{{ item.title }}</h1><p v-for="(paragraph, index) in item.paragraphs" :key="index">{{ paragraph }}</p></article>
            <div v-if="!chapter && !busy" class="reader-empty"><h2>这一章还没有加载</h2><p>请检查网络和书源，或从目录选择其他章节。</p><button class="reader-secondary" @click="goChapter(position.chapter || 0)">重新加载</button></div>
          </div>
          <template v-if="!paged"><div v-for="direction in [-1, 1]" v-show="continuationLoading === direction || continuationErrors[direction]" :key="direction" class="reading-continuation" :class="{'is-previous': direction < 0}" role="status"><span>{{ continuationErrors[direction] ? `${direction < 0 ? '上一章' : '下一章'}加载失败：${continuationErrors[direction]}` : `正在加载${direction < 0 ? '上一章' : '下一章'}…` }}</span><button v-if="continuationErrors[direction]" class="reader-secondary" @click="retryContinuation(direction)">重试</button></div></template>
          <span v-if="paged" id="reader-page-hint" class="reader-sr-only">点击正文左侧上一页，右侧下一页，也可使用左右方向键。</span>
        </div>
      </div>
      <footer class="reading-footer">
        <div class="reading-bookbar">
          <button class="reader-icon" aria-label="返回书架" title="返回书架" :disabled="busy" @click="backToShelf"><AppIcon name="back" /></button>
          <div class="reading-book-info"><strong :title="book.title">{{ book.title }}</strong><small :title="chapterTitle">{{ chapterTitle }}</small></div>
          <span v-if="paged && chapter" class="reading-page-number" role="status" aria-live="polite">{{ textPage + 1 }} / {{ textPages }} 页</span>
          <div class="reading-book-actions">
            <button v-if="book.type === 'online'" class="reader-icon" aria-label="切换书源" title="切换书源" :disabled="busy" @click="startSwitch"><AppIcon name="layers" /></button>
            <button class="reader-icon" :aria-pressed="isMarked" aria-label="添加或取消书签" :title="isMarked ? '取消当前书签' : '添加当前书签'" :disabled="busy" @click="toggleMark"><AppIcon :name="isMarked ? 'bookmark-check' : 'bookmark-add'" /></button>
            <button class="reader-icon" :aria-pressed="drawer === 'settings'" aria-label="阅读设置" title="阅读设置" @click="drawer = drawer === 'settings' ? '' : 'settings'"><AppIcon name="sliders" /></button>
          </div>
        </div>
        <div class="reading-controls" role="group" aria-label="阅读控制">
        <button class="reader-icon" :aria-pressed="drawer === 'toc'" aria-label="打开目录" title="目录" @click="drawer = drawer === 'toc' ? '' : 'toc'"><AppIcon name="list" /></button>
        <button class="reader-icon" :aria-pressed="drawer === 'search'" aria-label="搜索正文" title="搜索正文" @click="drawer = drawer === 'search' ? '' : 'search'"><AppIcon name="search" /></button>
        <button class="reader-icon" :aria-pressed="drawer === 'marks'" aria-label="查看书签" title="书签列表" @click="drawer = drawer === 'marks' ? '' : 'marks'"><AppIcon name="bookmark-list" /></button>
        <div class="reader-turns"><button class="reader-icon" aria-label="上一章" title="上一章" :disabled="busy || epubLoading || chapterIndex <= 0" @click="turnChapter(-1)"><AppIcon name="back" /></button><button class="reader-icon" aria-label="下一章" title="下一章" :disabled="busy || epubLoading || chapterIndex < 0 || chapterIndex >= toc.length - 1" @click="turnChapter(1)"><AppIcon name="arrow" /></button></div>
        <button class="reader-mode" :aria-label="paged ? '切换为上下滚动' : '切换为左右翻页'" :title="paged ? '左右翻页 · 点击切换为上下滚动' : '上下滚动 · 点击切换为左右翻页'" :aria-pressed="paged" :disabled="busy || epubLoading" @click="toggleReadingMode"><AppIcon :name="paged ? 'page-mode' : 'scroll-mode'" /><span>{{ paged ? '翻页' : '滚动' }}</span></button>
        </div>
      </footer>
      <DialogRoot :open="Boolean(drawer)" @update:open="!$event && (drawer = '')"><DialogOverlay class="reader-overlay" :data-drawer="drawer"><DialogContent as="aside" class="reader-drawer" :aria-describedby="undefined" @close-auto-focus.prevent="drawerOpener?.focus()"><header><DialogTitle as="h2">{{ ({toc:'目录',search:'搜索正文',marks:'书签',settings:'阅读设置'})[drawer] }}</DialogTitle><button class="reader-icon" aria-label="关闭面板" @click="drawer = ''"><AppIcon name="close" /></button></header>
        <template v-if="drawer === 'toc'"><div class="toc-tools"><input v-model="tocQuery" aria-label="搜索目录" placeholder="搜索章节名称" /><button v-if="book.type === 'online'" class="reader-secondary" :disabled="busy" @click="refreshToc">更新目录</button></div><UiScrollArea class="drawer-scroll" label="章节目录"><div class="toc-list"><button v-for="entry in visibleToc" :key="entry.href || entry.url || entry.index" :aria-current="book.type === 'epub' ? (position.href?.split('#')[0] === entry.href?.split('#')[0] ? 'location' : undefined) : position.chapter === entry.index ? 'location' : undefined" :disabled="busy" :style="{'padding-left':`${18 + (entry.depth || 0) * 14}px`}" @click="goChapter(entry.index)"><small>{{ String(entry.index + 1).padStart(2, '0') }}</small>{{ entry.title }}</button><p v-if="!visibleToc.length" class="reader-note">没有匹配的章节。</p></div></UiScrollArea></template>
        <template v-if="drawer === 'settings'">
          <UiScrollArea class="drawer-scroll" label="阅读设置选项"><div class="reading-settings">
            <div class="reading-settings-tabs" role="group" aria-label="阅读设置分类">
              <button :aria-pressed="settingsTab === 'appearance'" @click="settingsTab = 'appearance'">阅读外观</button>
              <button :aria-pressed="settingsTab === 'shortcuts'" @click="settingsTab = 'shortcuts'">快捷键</button>
            </div>
            <div v-if="settingsTab === 'appearance'" class="reading-appearance">
              <fieldset><legend>阅读背景</legend><div class="paper-options"><button v-for="theme in [{id:'paper',name:'纸张'},{id:'light',name:'纯白'},{id:'green',name:'护眼'},{id:'dark',name:'夜读'},{id:'transparent',name:'透明'}]" :key="theme.id" :data-paper="theme.id" :aria-pressed="preferences.theme === theme.id" @click="changeSetting('theme', theme.id)">{{ theme.name }}</button></div></fieldset>
              <p v-if="preferences.theme === 'transparent'" class="transparent-help">透明背景会隐藏工具栏。按 {{ shortcutLabel(shortcuts.toggleTransparent) }} 或 Esc 恢复。</p>
              <div class="reading-control"><span>字号<output>{{ preferences.fontSize }} px</output></span><UiSlider label="字号" :min="14" :max="36" :step="1" :model-value="preferences.fontSize" @update:model-value="changeSetting('fontSize', $event)" /></div>
              <div class="reading-control"><span>行距<output>{{ Number(preferences.lineHeight).toFixed(1) }}</output></span><UiSlider label="行距" :min="1.4" :max="2.6" :step="0.1" :model-value="preferences.lineHeight" @update:model-value="changeSetting('lineHeight', $event)" /></div>
              <div class="reading-control"><span>正文宽度<output>{{ preferences.width }} px</output></span><UiSlider label="正文宽度" :min="480" :max="1000" :step="40" :model-value="preferences.width" @update:model-value="changeSetting('width', $event)" /></div>
              <div class="reading-font-label"><span>正文字体</span><UiSelect label="正文字体" :paper="preferences.theme" :model-value="preferences.font" :options="[{value:'serif',label:'宋体 · 经典阅读'},{value:'sans',label:'雅黑 · 清晰简洁'}]" @update:model-value="changeSetting('font', $event)" /></div><div class="reading-sample"><small>阅读预览 · 调整即时生效</small><p>慢慢读，日子也会变得悠长。</p></div>
              <p class="reader-note">底部箭头切换上、下章，“滚动 / 翻页”切换阅读方式。左右翻页时点击正文两侧翻页，阅读位置自动保存。</p>
            </div>
            <div v-else class="reading-shortcuts">
              <fieldset v-for="group in shortcutGroups" :key="group"><legend>{{ group }}</legend>
                <div v-for="item in shortcutActions.filter(item => item.group === group)" :key="item.id" class="shortcut-row">
                  <span>{{ item.label }}</span><button class="shortcut-key" :data-shortcut="item.id" :aria-label="`修改${item.label}快捷键`" :aria-pressed="capturing === item.id" @click="captureShortcut(item.id)"><kbd>{{ capturing === item.id ? '请按键…' : shortcutLabel(shortcuts[item.id]) }}</kbd><AppIcon name="pen" /></button>
                </div>
              </fieldset>
              <div class="shortcut-options">
                <label class="shortcut-toggle"><input type="checkbox" :checked="preferences.scrollKeys !== false" @change="changeSetting('scrollKeys', $event.target.checked)" />启用上下滚动快捷键</label>
                <p class="reader-note">仅在上下滚动模式生效，按住按键可连续滚动。</p>
                <div class="reading-control"><span>滚动速度<output>{{ preferences.scrollSpeed || 5 }}</output></span><UiSlider label="快捷键滚动速度" :min="1" :max="10" :model-value="preferences.scrollSpeed || 5" @update:model-value="changeSetting('scrollSpeed', $event)" /></div>
              </div>
              <p class="shortcut-message" role="status">{{ shortcutMessage || '点击按键即可修改，Esc 取消录入；Esc 始终可以退出透明阅读。PageUp / PageDown 和空格也可翻页。' }}</p>
              <button class="reader-secondary" @click="resetShortcuts">恢复默认快捷键</button>
            </div>
          </div></UiScrollArea>
        </template>
        <template v-if="drawer === 'marks'"><UiScrollArea class="drawer-scroll" label="书签列表"><div class="toc-list"><button v-for="mark in book.marks" :key="mark.key" @click="jumpMark(mark)"><AppIcon name="bookmark" /><span>{{ mark.title }}<small class="mark-date">{{ new Date(mark.createdAt).toLocaleString('zh-CN') }}</small></span></button><p v-if="!book.marks?.length" class="reader-note">点击阅读页底部的书签，留住想回来的位置。</p></div></UiScrollArea></template>
        <template v-if="drawer === 'search'"><form class="content-search" @submit.prevent="searchContent"><input v-model="contentQuery" aria-label="搜索内容" placeholder="输入书中的词句" maxlength="200" /><button class="reader-primary" :disabled="searching">{{ searching ? '搜索中…' : '查找' }}</button></form><p class="reader-note">最多显示 100 条结果{{ book.type === 'online' ? '，在线小说只搜索已缓存的章节' : '' }}。</p><UiScrollArea class="drawer-scroll" label="正文搜索结果"><div class="content-results"><button v-for="(result, index) in contentResults" :key="index" @click="jumpResult(result)"><strong>{{ result.title || `结果 ${index + 1}` }}</strong><span>{{ result.excerpt }}</span></button><p v-if="!searching && !contentResults.length" class="reader-note">输入关键词，查找书中的内容。</p></div></UiScrollArea></template>
      </DialogContent></DialogOverlay></DialogRoot>
    </template>
    <dialog ref="removeDialog" class="reader-confirm"><h2>移除《{{ removeTarget?.title }}》？</h2><p>原始导入文件不受影响。书架副本会移到本机 reader/removed 文件夹。</p><div><button class="reader-secondary" @click="removeDialog.close()">取消</button><button class="reader-primary" @click="removeBook">从书架移除</button></div></dialog>
  </section>
</template>

<style scoped>
.source-summary { padding: 14px 16px; background: var(--accent-soft); border: 1px solid var(--line); border-radius: 8px; margin: 18px 0; }
.source-summary strong { font-size: 12px; font-weight: 550; color: var(--text); }
.source-summary p { font-size: 11px; line-height: 1.8; color: var(--muted); margin: 7px 0 0; }
.source-filters { flex-wrap: wrap; gap: 5px; }
.source-filters span { margin-left: 4px; font-size: 10px; font-variant-numeric: tabular-nums; }
.source-compat-details { color: var(--muted); font-size: 11px; line-height: 1.8; margin-top: 7px; }
.source-compat-details summary { cursor: pointer; width: fit-content; }
.source-compat-details summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.source-compat-details ul { padding-left: 18px; margin: 6px 0 0; }
.source-compat-details li + li { margin-top: 5px; }
.source-select-label { display: block; margin: 14px 0 6px; font-size: 11px !important; color: var(--muted); }
.source-run-list { margin: 20px 0; }
.source-run-list > article { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.source-run-list > article > div:first-child { flex: 1; min-width: 0; }
.source-run-list strong { font-size: 12px; font-weight: 550; }
.source-run-list p { font-size: 11px; line-height: 1.7; margin: 5px 0 0; color: var(--muted); overflow-wrap: anywhere; }
.source-run-list [data-status="error"] p { color: #ae3e43; }
.source-run-list [data-status="success"] p { color: var(--accent); }
.source-run-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.source-run-actions button { min-height: 38px; padding: 6px 9px; font-size: 11px !important; }
.switch-notice { padding: 15px; display: flex; align-items: flex-start; gap: 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--accent-soft); margin-bottom: 22px; }
.switch-notice > div { flex: 1; min-width: 0; }
.switch-notice strong { font-size: 13px; }
.switch-notice p { font-size: 11px; line-height: 1.7; margin: 7px 0 0; color: var(--muted); }
@media (max-width: 540px) { .source-run-list > article { flex-wrap: wrap; } .source-run-list > article > div:first-child { flex-basis: 100%; } .switch-notice { flex-wrap: wrap; } }
</style>
