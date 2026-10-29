// Browser-only, opt-in preview. Vite removes this module from production builds.
// All example data lives in memory and never touches the desktop library.
import JSZip from 'jszip';
import {defaultShortcuts} from './reader/shortcuts.js';

const chapters = ['第一章 · 山间来信', '第二章 · 雨后的长街', '第三章 · 一盏灯的距离', '第四章 · 沿着河流走', '第五章 · 窗边的旧书', '第六章 · 晚风有信'];
const passages = [
  '午后的阳光斜斜地照进来，在木地板上落下一块明亮的方形。林溪把信放在桌角，推开窗。山里的风带着草木的气息，远处传来几声清脆的鸟鸣。',
  '这封信没有署名，信封上只写着书店的地址。她拆开来，里面是一张薄薄的纸，和一片已经干透的银杏叶。纸上写着：如果你也有一段想要慢下来的日子，就来山里走走。',
  '她已经很久没有认真地读过一封信了。那些匆匆发出的消息，像水面上掠过的风，来不及留下什么，就被下一阵风覆盖。可这张纸不一样，每个字都安静地待在那里，等她看见。',
  '楼下的书店刚刚开门。老人把一张藤椅搬到门口，拿出昨天还没读完的书。街上有人提着早餐走过，有人在树下停住了脚步。这里的早晨，似乎总有足够的时间。',
  '林溪拿起笔，在信纸的背面写下第一行字。她不知道这封回信会寄到哪里，也不知道谁会读到它。但是，当笔尖落下的时候，她忽然觉得，有些事情不必一开始就有答案。',
  '窗外的云慢慢散开。小路一直通向树林深处，路边的花开得很低，像是不愿打扰经过的人。她把书放进包里，决定出去走一走。哪怕只是一小段路，也会遇到不一样的风景。',
  '傍晚回来的时候，门口多了一束野花。花旁边留着一张便条，上面写着：今天的夕阳很好。她笑了笑，把花插在一只旧玻璃杯里。平凡的一天，就这样有了值得记住的样子。',
  '她又翻开桌上的书，读到先前折起的那一页。故事里的人正要出发，而她终于学会了停留。灯光照着纸页，山风经过屋檐，夜晚才刚刚开始。',
];
const chapterText = index => [...passages.slice(index % 4), ...passages, ...passages.slice(0, 4)].join('\n');
const source = (id, name) => ({id, name, baseUrl: `https://${id}.example/`, enabled: true, raw: {
  search: {url: '/search?q={{key}}', list: '.result', name: '.title', author: '.author', bookUrl: {selector: 'a', attr: 'href'}},
  toc: {list: '.chapter', name: {selector: '', attr: 'text'}, chapterUrl: {selector: '', attr: 'href'}},
  content: {text: '.content'},
}});

async function makeEpub(book) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${book.id}</dc:identifier><dc:title>${book.title}</dc:title><dc:creator>${book.author}</dc:creator><dc:language>zh</dc:language><meta property="dcterms:modified">2026-10-28T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${chapters.map((title, i) => `<li><a href="c${i}.xhtml">${title}</a></li>`).join('')}</ol></nav></body></html>`);
  chapters.forEach((title, i) => zip.file(`OEBPS/c${i}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${chapterText(i).split('\n').map(text => `<p>${text}</p>`).join('')}</body></html>`));
  return [...await zip.generateAsync({type: 'uint8array'})];
}

export function installPreview() {
  const now = Date.now();
  const books = ['山海来信', '长街慢行', '风起青萍', '在林间', '月亮的背面', '人间小满'].map((title, i) => ({
    id: `preview-${i}`, title, author: ['林间', '陈小满', '南风', '鹿鸣', '白昼', '林间'][i], type: ['txt', 'epub', 'online', 'txt', 'epub', 'txt'][i],
    sourceId: 'sample', sourceName: '示例书源 · 山间书屋', url: `https://sample.example/book/${i}`,
    addedAt: now - i * 86400000, lastRead: i < 3 ? now - i * 3600000 : 0,
    progress: {chapter: 0, fraction: 0, percent: i < 3 ? [28.6, 12, 6.8][i] : 0}, marks: [], chapterCount: chapters.length,
  }));
  const library = {books, sources: [source('sample', '示例书源 · 山间书屋'), source('quiet', '示例书源 · 晚风阅读')], preferences: {
    theme: 'paper', previousTheme: 'paper', fontSize: 20, lineHeight: 1.9, width: 720, font: 'serif', readingMode: 'scroll', shortcuts: {...defaultShortcuts}, scrollKeys: true, scrollSpeed: 5,
  }};
  const state = {panel: 'home', theme: 'light', toolbarAutoHide: false, toolbarVisible: true, lastUrl: 'https://weread.qq.com/', hasPage: false, opacity: 1, zoom: 1, pauseOnHide: true, version: '交互预览', bookmarks: [], history: [{url: 'https://weread.qq.com/', title: '微信读书 · 阅读让生活更丰富', at: now}]};
  const listeners = new Set();
  const copy = value => structuredClone(value);
  const ok = result => ({ok: true, result: copy(result)});
  const notify = () => listeners.forEach(listener => listener(copy(state)));
  const toolbarListeners = new Set();
  let toolbarTimer, toolbarFocused = false, pointer = {x: -1, y: -1};
  function updateToolbar() {
    const overToolbar = pointer.x >= 0 && pointer.x < innerWidth && pointer.y >= 0 && pointer.y < (state.toolbarVisible ? 38 : 8);
    if (!state.toolbarAutoHide || toolbarFocused || overToolbar) {
      clearTimeout(toolbarTimer); toolbarTimer = null;
      if (!state.toolbarVisible) { state.toolbarVisible = true; notify(); }
    } else if (state.toolbarVisible && !toolbarTimer) {
      toolbarTimer = setTimeout(() => { toolbarTimer = null; state.toolbarVisible = false; notify(); }, 400);
    }
  }
  document.addEventListener('pointermove', event => { pointer = {x: event.clientX, y: event.clientY}; updateToolbar(); });
  document.documentElement.addEventListener('mouseleave', () => { pointer = {x: -1, y: -1}; updateToolbar(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'F6' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); toolbarFocused = true; updateToolbar();
      toolbarListeners.forEach(listener => listener());
    }
  });
  const unsupported = () => ({ok: false, error: '当前为交互预览；网页浏览、文件导入和窗口控制请在桌面版使用。'});
  window.moyu = {
    preview: true,
    getState: async () => copy(state),
    onState: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    onFocusAddress: () => () => {}, onReaderRecovery: () => () => {},
    onFocusToolbar: listener => { toolbarListeners.add(listener); return () => toolbarListeners.delete(listener); },
    action: async (name, value) => {
      if (name === 'panel') { if (value === 'web') return unsupported(); state.panel = value; }
      else if (name === 'theme') state.theme = state.theme === 'light' ? 'dark' : 'light';
      else if (['opacity', 'zoom'].includes(name)) state[name] = value;
      else if (name === 'hover-hide') state.hoverHide = value;
      else if (name === 'hover-hide-delay') state.hoverHideDelayMs = value;
      else if (name === 'toolbar-auto-hide') { state.toolbarAutoHide = value; toolbarFocused = false; updateToolbar(); }
      else if (name === 'toolbar-focus') { toolbarFocused = Boolean(value); updateToolbar(); }
      else if (name === 'toolbar-dismiss') {
        toolbarFocused = false; clearTimeout(toolbarTimer); toolbarTimer = null;
        state.toolbarVisible = !state.toolbarAutoHide;
      }
      else if (name === 'edge-hide') state.edgeHide = value;
      else if (name === 'pause-on-hide') state.pauseOnHide = value;
      else if (name === 'pin') state.pinned = !state.pinned;
      else if (name === 'mobile') state.mobile = !state.mobile;
      else if (name === 'clear-history') state.history = [];
      else return unsupported();
      notify(); return ok(state);
    },
    reader: async (name, value) => {
      const book = library.books.find(item => item.id === value?.id);
      if (name === 'state') return ok(library);
      if (name === 'open') { book.lastRead = Date.now(); return ok({book, toc: chapters.map(title => ({title})), ...(book.type === 'epub' ? {bytes: await makeEpub(book)} : {})}); }
      if (name === 'chapter') return ok({title: chapters[value.index], text: chapterText(value.index)});
      if (name === 'preferences') { Object.assign(library.preferences, value); return ok(library.preferences); }
      if (name === 'progress') { book.progress = value.progress; return ok(book); }
      if (name === 'metadata') { Object.assign(book, value.data); return ok(book); }
      if (name === 'mark') {
        const index = book.marks.findIndex(mark => mark.key === value.position.key);
        if (index < 0) book.marks.push({...value.position, createdAt: Date.now()}); else book.marks.splice(index, 1);
        return ok(book);
      }
      if (name === 'search') return ok(chapters.flatMap((title, chapter) => chapterText(chapter).split('\n').map((excerpt, i, all) => ({title, chapter, fraction: i / all.length, excerpt})).filter(item => item.excerpt.includes(value.query))).slice(0, 100));
      if (name === 'remove') { library.books = library.books.filter(item => item.id !== value.id); return ok(library); }
      if (name === 'source-toggle') { const selected = library.sources.find(item => item.id === value.id); selected.enabled = !selected.enabled; return ok(library); }
      if (name === 'source-remove') { library.sources = library.sources.filter(item => item.id !== value.id); return ok(library); }
      if (name === 'presentation' || name === 'shortcut-capture' || name === 'fetch-cancel') return ok(true);
      if (name === 'fetch') {
        const url = new URL(value.url);
        const q = url.searchParams.get('q') || '';
        return ok({url: value.url, text: library.books.filter(item => `${item.title}${item.author}`.includes(q)).map(item => `<div class="result"><a href="/book/${item.id}"><span class="title">${item.title}</span></a><span class="author">${item.author}</span></div>`).join('')});
      }
      if (name === 'online-add') {
        const added = {...value, id: `added-${Date.now()}`, type: 'online', addedAt: Date.now(), marks: [], progress: {chapter: 0, fraction: 0, percent: 0}};
        library.books.push(added); return ok(added);
      }
      return unsupported();
    },
  };
  document.title = '沫鱼 · 界面交互预览';
}
