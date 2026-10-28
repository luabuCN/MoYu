// Declarative rules run here; executable Legado rules run in the main process's
// isolated QuickJS worker through the restricted reader bridge.
import JSON5 from 'json5';
import {splitRule, transformTexts} from './text-rules.js';
const text = value => String(value ?? '').trim();
const supportedTemplates = /{{\s*(?:key|searchKey|page|baseUrl)\s*}}/g;
// A common declarative pagination pattern; match its exact grammar without eval.
const pagePathTemplate = /{{\s*page\s*={2,3}\s*1\s*\?\s*(?:''|"")\s*:\s*(?:'\/'|"\/")\s*\+\s*page\s*}}/g;

export function normalizeSource(item) {
  const raw = item.raw || {};
  const source = {...item, format: 'Moyu JSON', warning: '', warningCode: '', issues: [], runtime: false};
  const warn = (code, message) => {
    if (!source.issues.some(issue => issue.code === code)) source.issues.push({code, message});
  };
  if (raw.bookSourceUrl) {
    source.runtime = Boolean(raw.jsLib);
    source.format = '阅读 3.0';
    if (raw.bookSourceType && Number(raw.bookSourceType) !== 0) warn('type', '当前阅读器支持文字小说，这个书源属于其他内容类型。');
    const s = raw.ruleSearch || {}, t = raw.ruleToc || {}, c = raw.ruleContent || {};
    source.search = {url: raw.searchUrl, list: s.bookList, name: s.name, author: s.author, bookUrl: s.bookUrl};
    source.info = {tocUrl: raw.ruleBookInfo?.tocUrl};
    source.toc = {list: t.chapterList, name: t.chapterName, chapterUrl: t.chapterUrl, next: t.nextTocUrl};
    source.content = {text: c.content, next: c.nextContentUrl, replaceRegex: c.replaceRegex};
    source.headers = raw.header;
  } else if (raw.origin) {
    source.format = 'eReader JSON';
    const s = raw.search?.rules || {}, t = raw.catalogs?.rules || {}, c = raw.content?.rules || {};
    const info = s.infomation || s.information || {};
    source.search = {url: raw.search?.pathname, method: raw.search?.method, query: raw.search?.query, charset: raw.search?.charset,
      list: s.wrapContainer, name: info.bookName, author: info.author, bookUrl: info.pathname};
    source.toc = {list: t.wrapContainer, name: {selector: '', attr: 'text'}, chapterUrl: {selector: '', attr: 'href'}, pagination: t.pagination, redirect: t.redirect};
    source.content = {text: c.wrapContainer, title: c.titleContainer, pagination: c.pagination, handler: raw.content?.handler};
    source.headers = raw.headers;
  } else {
    source.search = raw.search;
    source.toc = raw.toc;
    source.info = raw.info;
    source.content = {text: raw.content?.text || raw.content?.selector, next: raw.content?.next};
    source.headers = raw.headers;
  }
  const headers = source.headers;
  if (headers) {
    if (typeof headers === 'string' && /@js:|<js>|javascript:/i.test(headers)) {
      if (raw.bookSourceUrl) source.runtime = true;
      else warn('header-script', '此格式的动态请求头暂不支持，请使用阅读 3.0 书源格式。');
      source.headers = undefined;
    } else {
      try {
        source.headers = typeof headers === 'object' ? headers : JSON5.parse(headers);
        if (!source.headers || Array.isArray(source.headers) || typeof source.headers !== 'object' ||
          Object.values(source.headers).some(value => typeof value !== 'string' && typeof value !== 'number')) throw new Error('invalid headers');
      } catch {
        if (raw.bookSourceUrl) source.runtime = true;
        else warn('header-format', '请求头无法解析为静态对象；支持 JSON / JSON5 写法。');
        source.headers = undefined;
      }
    }
  }
  // Only inspect rules used by search/reading. Explore, login and comments are not executed.
  const activeRules = {search: source.search, info: source.info, toc: source.toc, content: source.content, headers: source.headers};
  const serialized = JSON.stringify(activeRules);
  const executable = /@js:|<js>|javascript:|@put:|@get:|@json:|\$\./i.test(serialized + JSON.stringify({info: raw.ruleBookInfo, volume: raw.ruleToc?.isVolume}));
  if (executable && raw.bookSourceUrl) source.runtime = true;
  else if (executable) warn('script', '脚本或 JSONPath 规则请使用阅读 3.0 书源格式。');
  const unknownTemplates = JSON.stringify(activeRules, (_key, value) => typeof value === 'string' ? value.replace(supportedTemplates, '').replace(pagePathTemplate, '') : value);
  if (/{{/.test(unknownTemplates)) {
    if (raw.bookSourceUrl) source.runtime = true;
    else warn('expression', '动态表达式请使用阅读 3.0 书源格式。');
  }
  if (!source.search?.url || !source.search?.list || !source.search?.name || !source.search?.bookUrl || !source.toc?.list || !source.content?.text) {
    warn('missing', '缺少搜索、目录或正文规则，请补全书源配置或换用完整的书源。');
  }
  source.warning = source.issues[0]?.message || '';
  source.warningCode = source.issues[0]?.code || '';
  if (raw.bookSourceUrl && !source.warning) source.format = source.runtime ? '阅读 3.0 · JS / JSONPath' : '阅读 3.0 · CSS / XPath';
  return source;
}

export function parsePage(html) {
  // DOMParser's inert document is never mounted into the application.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,template,noscript').forEach(node => node.remove());
  return doc;
}

function selectorStep(input) {
  let selector = input.trim().replace(/^@?css:/i, '');
  let index;
  const classes = selector.match(/^class\.([\w-]+(?:\s+[\w-]+)*)(?:\.(-?\d+))?$/);
  if (classes) return {selector: '.' + classes[1].split(/\s+/).join('.'), index: classes[2] === undefined ? undefined : Number(classes[2])};
  const legacy = selector.match(/^(class|id|tag)\.([\w-]+)(?:\.(-?\d+))?$/);
  if (legacy) {
    selector = (legacy[1] === 'class' ? '.' : legacy[1] === 'id' ? '#' : '') + legacy[2];
    if (legacy[3] !== undefined) index = Number(legacy[3]);
  } else {
    const indexedTag = selector.match(/^([a-z][\w-]*)\.(-?\d+)$/i);
    if (indexedTag) { selector = indexedTag[1]; index = Number(indexedTag[2]); }
  }
  return {selector, index};
}

function walk(root, selector) {
  if (!selector) return [root];
  if (/^(?:@xpath:|xpath:|\.?\/|\(\/)/i.test(selector)) {
    const expression = selector.replace(/^@?xpath:/i, '');
    try {
      const document = root.ownerDocument || root;
      const result = document.evaluate(expression, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return Array.from({length: result.snapshotLength}, (_, index) => result.snapshotItem(index));
    } catch { throw new Error(`XPath 规则无效：${expression}`); }
  }
  const steps = selector.replace(/^@?css:/i, '').split('@').filter(Boolean);
  let nodes = [root];
  for (const step of steps) {
    const linkText = step.match(/^text\.(.+?)(?:\.(-?\d+))?$/);
    if (linkText) {
      nodes = nodes.flatMap(node => {
        const links = [...node.querySelectorAll('a')].filter(link => link.textContent.trim() === linkText[1]);
        return linkText[2] === undefined ? links : [links.at(Number(linkText[2]))].filter(Boolean);
      });
      continue;
    }
    const children = step.match(/^children(?:\[(-?\d+)\])?$/);
    if (children) {
      nodes = nodes.flatMap(node => children[1] === undefined ? [...(node.children || [])] : [Array.from(node.children || []).at(Number(children[1]))].filter(Boolean));
      continue;
    }
    const {selector: css, index} = selectorStep(step);
    nodes = nodes.flatMap(node => {
      let found;
      try { found = [...node.querySelectorAll(css)]; }
      catch { throw new Error(`不支持的 CSS 选择器：${css}`); }
      return index === undefined ? found : [found.at(index)].filter(Boolean);
    });
  }
  return nodes;
}

export function selectNodes(root, rule) {
  if (typeof rule === 'object') {
    const found = walk(root, rule.selector || '');
    return rule.nthchild === undefined ? found : [found.at(Number(rule.nthchild))].filter(Boolean);
  }
  const selector = text(rule);
  if (selector.startsWith('-')) return walk(root, selector.slice(1)).reverse();
  return walk(root, selector);
}

function readable(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll?.('br').forEach(br => br.replaceWith('\n'));
  copy.querySelectorAll?.('p,div,li,h1,h2,h3,section').forEach(block => block.append('\n'));
  return (copy.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extract(root, rule, fallback = 'text') {
  if (!rule) return '';
  rule = splitRule(rule).selector;
  if (typeof rule === 'string' && /^(?:@xpath:|xpath:|\.?\/|\(\/)/i.test(rule)) {
    const expression = rule.replace(/^@?xpath:/i, '');
    try {
      const result = (root.ownerDocument || root).evaluate(expression, root, null, XPathResult.ANY_TYPE, null);
      if (result.resultType === XPathResult.STRING_TYPE) return result.stringValue.trim();
      if (result.resultType === XPathResult.NUMBER_TYPE) return String(result.numberValue);
      if (result.resultType === XPathResult.BOOLEAN_TYPE) return String(result.booleanValue);
      const values = []; let node;
      while ((node = result.iterateNext())) values.push(node.nodeType === 2 ? node.value : readable(node));
      return values.join('\n').trim();
    } catch { throw new Error(`XPath 规则无效：${expression}`); }
  }
  if (typeof rule === 'string' && rule.includes('||')) {
    for (const alternative of rule.split('||')) { const value = extract(root, alternative, fallback); if (value) return value; }
    return '';
  }
  if (typeof rule === 'string' && rule.includes('&&')) return rule.split('&&').map(part => extract(root, part, fallback)).filter(Boolean).join('\n');
  let selector, attr, config;
  if (typeof rule === 'object') {
    config = rule; selector = rule.selector || ''; attr = rule.attr || fallback;
  } else {
    const parts = text(rule).replace(/^@?css:/i, '').split('@');
    const last = parts.at(-1);
    if (/^(?:text|textNodes|ownText|html|all|href|src|content|title|alt|value|data-[\w-]+)$/i.test(last)) attr = parts.pop();
    selector = parts.join('@'); attr ||= fallback;
    config = {selector};
  }
  const nodes = selectNodes(root, {...config, selector});
  const values = nodes.map(node => {
    if (['text', 'textNodes', 'html', 'all'].includes(attr)) return readable(node) || node.getAttribute?.('content') || '';
    if (attr === 'ownText') return [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    return node.getAttribute?.(attr) || '';
  });
  let result = (attr === 'href' || attr === 'src' ? values.find(Boolean) || '' : values.filter(Boolean).join('\n')).trim();
  return result;
}

async function fields(jobs) {
  return transformTexts(jobs.map(({node, rule, fallback}) => ({text: extract(node, rule, fallback), rules: splitRule(rule).rules})));
}

function absolute(value, base) {
  if (!value) return '';
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function searchRequest(source, keyword, page = 1) {
  if (source.warning) throw new Error(source.warning);
  if (source.runtime) return {sourceId: source.id, runtime: {operation: 'search', params: {keyword, page}}};
  const replace = value => String(value).replace(pagePathTemplate, Number(page) === 1 ? '' : `/${page}`).replace(/{{\s*(key|searchKey|page|baseUrl)\s*}}/g,
    (_, name) => name === 'page' ? page : name === 'baseUrl' ? source.baseUrl : encodeURIComponent(keyword));
  // Parse static options before inserting the keyword so quotes in a book title cannot break JSON.
  let url = source.search.url, options = {};
  const optionStart = url.search(/,\s*\{/);
  if (optionStart >= 0) {
    try { options = JSON5.parse(url.slice(optionStart + 1)); } catch { throw new Error('搜索请求参数不是有效的静态 JSON / JSON5'); }
    url = url.slice(0, optionStart);
  }
  url = absolute(replace(url), source.baseUrl);
  if (!url) throw new Error('搜索地址无效');
  const method = String(options.method || source.search.method || 'GET').toUpperCase();
  const replacePlain = value => String(value).replace(pagePathTemplate, Number(page) === 1 ? '' : `/${page}`).replace(/{{\s*(key|searchKey|page|baseUrl)\s*}}/g,
    (_, name) => name === 'page' ? page : name === 'baseUrl' ? source.baseUrl : keyword);
  let body = options.body === undefined ? undefined : typeof options.body === 'object'
    ? new URLSearchParams(Object.entries(options.body).map(([key, value]) => [key, replacePlain(value)])).toString() : replace(options.body);
  if (source.search.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(source.search.query)) {
      params.set(key, typeof value !== 'object' ? value : value?.type === 'query' ? keyword : value?.type === 'date' ? String(Date.now()) : String(page));
    }
    if (method === 'POST') body = params.toString();
    else { const parsed = new URL(url); params.forEach((v, k) => parsed.searchParams.set(k, v)); url = parsed.href; }
  }
  return {sourceId: source.id, url, method, body, headers: {...source.headers, ...options.headers}, charset: options.charset || source.search.charset};
}

export async function searchResults(source, response) {
  if (Array.isArray(response.runtimeBooks)) return response.runtimeBooks;
  const doc = parsePage(response.text), seen = new Set();
  const nodes = selectNodes(doc, source.search.list).slice(0, 200);
  if (!nodes.length && !/没有找到|未找到|暂无|没有搜索到|无相关|0\s*条|no results/i.test(doc.body.textContent)) throw Object.assign(new Error('网站已响应，但没有匹配到搜索列表；可能是规则过期、网站改版或验证页面'), {code: 'parse', url: response.url});
  const values = await fields(nodes.flatMap(node => [{node, rule: source.search.name}, {node, rule: source.search.author}, {node, rule: source.search.bookUrl, fallback: 'href'}]));
  const books = nodes.map((node, index) => ({sourceId: source.id, sourceName: source.name,
    title: values[index * 3], author: values[index * 3 + 1],
    url: absolute(values[index * 3 + 2], response.url)})).filter(book => {
    if (!book.title || !book.url || seen.has(book.url)) return false;
    seen.add(book.url); return true;
  });
  if (nodes.length && !books.length) throw Object.assign(new Error('找到搜索列表，但未提取到书名或链接，请更新书源规则'), {code: 'parse', url: response.url});
  return books;
}

function paginationLink(doc, rule, base) {
  if (!rule) return '';
  const node = selectNodes(doc, rule).filter(node => /^(?:下一页|下页|next\s*(?:page)?|›|»|>)$/i.test(node.textContent.trim())).at(-1);
  const value = node?.getAttribute('href');
  if (rule.fullpath && value && !/^(?:[a-z]+:|\/|\?|#)/i.test(value)) {
    const parsed = new URL(base);
    return absolute(`${parsed.pathname}${value}`, parsed.origin);
  }
  return absolute(value, base);
}

export async function loadToc(source, bookUrl, fetchPage, book = {}) {
  if (source.runtime) return fetchPage({sourceId: source.id, runtime: {operation: 'toc', params: {url: bookUrl, book}}});
  let response = await fetchPage({sourceId: source.id, url: bookUrl, headers: source.headers});
  let doc = parsePage(response.text);
  if (source.info?.tocUrl) {
    const [path] = await fields([{node: doc, rule: source.info.tocUrl, fallback: 'href'}]);
    const tocUrl = absolute(path, response.url);
    if (tocUrl && tocUrl !== response.url) { response = await fetchPage({sourceId: source.id, url: tocUrl, headers: source.headers}); doc = parsePage(response.text); }
  }
  const entries = [], visited = new Set();
  for (let page = 0; page < 30; page++) {
    if (visited.has(response.url)) break;
    visited.add(response.url);
    const nodes = selectNodes(doc, source.toc.list);
    const values = await fields(nodes.flatMap(node => [{node, rule: source.toc.name || {selector: ''}}, {node, rule: source.toc.chapterUrl || {selector: '', attr: 'href'}, fallback: 'href'}]));
    for (let index = 0; index < nodes.length; index++) {
      const title = values[index * 2];
      let link = values[index * 2 + 1];
      if (source.toc.redirect && link && !/^(?:[a-z]+:|\/|\?|#)/i.test(link)) link = new URL(response.url).pathname + link;
      const url = absolute(link, response.url);
      if (title && url) entries.push({title, url});
    }
    const [nextPath, redirectPath] = await fields([{node: doc, rule: source.toc.next, fallback: 'href'}, {node: doc, rule: source.toc.redirect, fallback: 'href'}]);
    const next = absolute(nextPath, response.url) || paginationLink(doc, source.toc.pagination, response.url) || absolute(redirectPath, response.url);
    if (!next || visited.has(next)) break;
    if (page === 29) throw new Error('目录超过 30 页，请使用不分页的目录书源');
    response = await fetchPage({sourceId: source.id, url: next, headers: source.headers}); doc = parsePage(response.text);
  }
  if (!entries.length) throw new Error('没有解析到目录，请检查书源规则或网站是否需要登录');
  // Recent-chapter previews often precede the full catalogue. Keep the last
  // occurrence's position so those previews do not become the first chapters.
  const unique = new Map();
  for (const entry of entries) { unique.delete(entry.url); unique.set(entry.url, entry); }
  return [...unique.values()];
}

export async function loadChapter(source, entry, fetchPage, book = {}) {
  if (source.runtime) return fetchPage({sourceId: source.id, runtime: {operation: 'chapter', params: {entry, book}}});
  const sections = [], visited = new Set();
  let url = entry.url;
  for (let i = 0; i < 12; i++) {
    if (visited.has(url)) break;
    visited.add(url);
    const response = await fetchPage({sourceId: source.id, url, headers: source.headers});
    const doc = parsePage(response.text);
    const [content] = await fields([{node: doc, rule: source.content.text}]);
    if (!content) throw new Error('没有解析到正文，请检查书源规则或网站是否需要验证');
    sections.push(content);
    const [nextPath] = await fields([{node: doc, rule: source.content.next, fallback: 'href'}]);
    const next = absolute(nextPath, response.url) || paginationLink(doc, source.content.pagination, response.url);
    if (!next || visited.has(next)) break;
    if (i === 11) throw new Error('正文分页超过 12 页，已停止加载');
    url = next;
  }
  const replacement = source.content.replaceRegex;
  const rules = replacement ? splitRule(replacement.startsWith('##') ? replacement : `##${replacement}`).rules : [];
  let [content] = await transformTexts([{text: sections.join('\n\n'), rules}]);
  if (Array.isArray(source.content.handler?.replace)) {
    const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
    for (const rule of source.content.handler.replace) if (rule.type === 'Array' && Number.isInteger(rule.value)) lines.splice(rule.value, 1);
    content = lines.join('\n');
  }
  return {title: entry.title, text: content};
}
