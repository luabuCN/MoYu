'use strict';
const cheerio = require('cheerio');
const xpath = require('xpath');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');

function select($, input, rule) {
  let nodes = input;
  for (let step of String(rule || '').replace(/^@?css:/i, '').split('@').filter(Boolean)) {
    const children = step.match(/^children(?:\[(-?\d+)\])?$/);
    if (children) { nodes = nodes.flatMap(node => { const found = $(node).children().toArray(); return children[1] === undefined ? found : [found.at(+children[1])].filter(Boolean); }); continue; }
    const byText = step.match(/^text\.(.+?)(?:\.(-?\d+))?$/);
    const exclude = step.match(/!([\d:-]+)$/);
    if (exclude) step = step.slice(0, exclude.index);
    const slice = step.match(/\[(-?\d*):(-?\d*)(?::(-?\d+))?\]$/);
    if (slice) step = step.slice(0, slice.index);
    let index;
    const legacy = step.match(/^(class|id|tag)\.([\w-]+(?:\s+[\w-]+)*)(?:\.(-?\d+))?$/);
    if (legacy) { step = legacy[1] === 'class' ? '.' + legacy[2].split(/\s+/).join('.') : (legacy[1] === 'id' ? '#' : '') + legacy[2]; index = legacy[3] === undefined ? undefined : +legacy[3]; }
    else { const tag = step.match(/^([a-z][\w-]*)\.(-?\d+)$/i); if (tag) { step = tag[1]; index = +tag[2]; } }
    nodes = nodes.flatMap(node => {
      let found = byText ? $(node).find('a').toArray().filter(n => $(n).text().trim() === byText[1]) : $(node).find(step).toArray();
      if (byText && byText[2] !== undefined) found = [found.at(+byText[2])].filter(Boolean);
      if (index !== undefined) found = [found.at(index)].filter(Boolean);
      if (exclude) { const indexes = exclude[1].split(':').map(Number); found = found.filter((_n, i) => !indexes.some(j => (j < 0 ? found.length + j : j) === i)); }
      if (slice) {
        const start = slice[1] ? +slice[1] : 0, end = slice[2] ? +slice[2] : found.length - 1;
        const a = start < 0 ? found.length + start : start, b = end < 0 ? found.length + end : end, increment = slice[3] ? +slice[3] : a > b ? -1 : 1;
        if (!increment) throw new Error('选择器步长不能为 0');
        const picked = []; for (let i = a, count = 0; (increment > 0 ? i <= b : i >= b) && count++ <= found.length; i += increment) if (found[i]) picked.push(found[i]);
        found = picked;
      }
      return found;
    });
  }
  return nodes;
}

function domCall({html = '', rule = '', attr = 'text', mode = 'field'}) {
  if (String(html).length > 8 * 1024 * 1024) throw new Error('待解析页面超过 8 MB');
  const $ = cheerio.load(String(html));
  if (/^(?:@?xpath:|\.?\/|\(\/)/i.test(rule)) {
    const doc = new DOMParser({errorHandler: {warning() {}, error() {}, fatalError(message) { throw new Error(message); }}}).parseFromString($.xml(), 'application/xml');
    const result = xpath.select(rule.replace(/^@?xpath:/i, ''), doc);
    const list = Array.isArray(result) ? result : [result];
    return list.map(node => mode === 'nodes' && node?.nodeType === 1 ? new XMLSerializer().serializeToString(node) : node?.nodeValue ?? node?.textContent ?? String(node));
  }
  // A row passed back from a list is serialized markup. Bare @href / ownText
  // applies to that row element rather than Cheerio's synthetic document root.
  const root = !rule && mode !== 'nodes' && !['text', 'all', 'html'].includes(attr) ? $('body').children().first()[0] || $.root()[0] : $.root()[0];
  const nodes = rule ? select($, [$.root()[0]], rule) : [root];
  if (mode === 'nodes') return nodes.slice(0, 50000).map(node => node.type === 'root' ? $.root().html() : $.html(node));
  return nodes.map(node => {
    const current = $(node);
    if (attr === 'html') return current.html() || '';
    if (attr === 'outerHtml') return $.html(node);
    if (attr === 'ownText' || attr === 'textNodes') return current.contents().filter((_i, child) => child.type === 'text').text();
    if (attr === 'text' || attr === 'all') {
      const copy = cheerio.load($.html(node));
      copy('script,style,iframe,object,embed').remove();
      copy('br').replaceWith('\n'); copy('p,div,li,h1,h2,h3,section').append('\n');
      return copy.root().text().replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }
    return current.attr(attr) || '';
  });
}
module.exports = {domCall};
