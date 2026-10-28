// Runs only inside the QuickJS WASM guest, never in Node or the application page.
(function () {
  'use strict';
  var G = globalThis, data, raw, state, headers = {}, currentUrl = '', rawPage = '', requestCount = 0;
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function host(kind, args) { var r = JSON.parse(__host(kind, JSON.stringify(args))); if (r.error) throw new Error(r.error); return r.value; }
  function remote(args) { var r = JSON.parse(__remote(JSON.stringify(args))); if (r.error) { var e = new Error(r.error); e.code = r.code; throw e; } return r.value; }
  function string(value) { if (value == null) return ''; return typeof value === 'object' && !(value instanceof Element) ? JSON.stringify(value) : String(value); }
  function array(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
  function json(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
  function absolute(value, base) { if (!value) return ''; return host('url', {url: string(value), base: base || currentUrl || raw.bookSourceUrl}).href; }
  function text(value) { return host('dom', {html: string(value), attr: 'text'}).join('\n').trim(); }
  function items(list) { if (typeof list === 'string' && list.trim()[0] === '[') { try { list = JSON.parse(list); } catch (_) {} } return array(list).slice(0, 50000); }
  function put(map, key, value) {
    key = String(key); value = string(value);
    if (key.length > 500 || value.length > 1000000 || Object.keys(map).length > 512) throw new Error('书源变量超出存储限制');
    Object.defineProperty(map, key, {value: value, configurable: true, enumerable: true, writable: true}); return value;
  }
  function jp(input, path) {
    if (input instanceof Element) input = input.html();
    return G.JSONPath.JSONPath({path: path.replace(/^@json:/i, ''), json: json(input), wrap: true, eval: 'native'});
  }
  function splitTop(value, token) {
    var parts = [], start = 0, quote = '', depth = 0;
    for (var i = 0; i < value.length; i++) {
      var c = value[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if ('[({'.indexOf(c) >= 0) depth++;
      else if ('])}'.indexOf(c) >= 0) depth--;
      if (depth === 0 && value.slice(i, i + token.length) === token) { parts.push(value.slice(start, i)); i += token.length - 1; start = i + 1; }
    }
    parts.push(value.slice(start)); return parts;
  }
  function render(value, input, options) {
    options = options || {}; value = String(value); var output = '', pos = 0;
    while (pos < value.length) {
      var start = value.indexOf('{{', pos); if (start < 0) return output + value.slice(pos);
      output += value.slice(pos, start); var quote = '', depth = 0, end = -1;
      for (var i = start + 2; i < value.length - 1; i++) {
        var c = value[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (!depth && c === '}' && value[i + 1] === '}') { end = i; break; }
        if ('([{'.indexOf(c) >= 0) depth++; else if (')]}'.indexOf(c) >= 0) depth--;
      }
      if (end < 0) throw new Error('书源模板花括号不完整');
      var expression = value.slice(start + 2, end).trim(), result;
      if (expression === 'key' || expression === 'searchKey') result = G.key;
      else if (expression[0] === '$') result = jp(input, expression)[0];
      else if (expression[0] === '@') result = read(input, expression, 'field');
      else result = (0, eval)('(' + expression + ')');
      result = string(result);
      if (options.url && /^(key|searchKey)$/.test(expression)) result = encodeURIComponent(result);
      if (options.script) result = JSON.stringify(result).slice(1, -1).replace(/'/g, "\\'");
      output += result; pos = end + 2;
    }
    return output;
  }
  function script(code, input) {
    G.result = input instanceof Element ? input.toString() : input && typeof input === 'object' ? JSON.stringify(input) : input;
    code = render(code, input, {script: true});
    var result;
    try { result = (0, eval)(code); }
    catch (error) { if (error instanceof SyntaxError && /return/i.test(error.message)) result = Function(code)(); else throw error; }
    return result === undefined ? G.result : result;
  }
  function read(input, rule, mode) {
    if (rule == null || rule === '') return mode === 'nodes' ? items(input) : string(input);
    if (typeof rule !== 'string') return rule;
    rule = rule.trim();
    rule = rule.replace(/@get:\{([^}]+)\}/g, function (_m, key) { return state.java[key] || ''; });
    if (rule.indexOf('@put:') === 0) {
      var end = rule.indexOf('}'); if (end < 0) throw new Error('@put 规则格式无效');
      var variables = host('json5', rule.slice(5, end + 1));
      for (var key of Object.keys(variables)) put(state.java, key, read(input, variables[key], 'field'));
      rule = rule.slice(end + 1);
    }
    var marker = rule.search(/<js>|@js:|^js:/i);
    if (marker >= 0) {
      var value = marker ? read(input, rule.slice(0, marker), mode === 'nodes' ? 'nodes' : 'field') : input;
      var rest = rule.slice(marker), code, suffix = '';
      if (/^<js>/i.test(rest)) { var close = rest.toLowerCase().indexOf('</js>'); if (close < 0) throw new Error('书源脚本缺少 </js>'); code = rest.slice(4, close); suffix = rest.slice(close + 5).trim(); }
      else code = rest.replace(/^@?js:/i, '');
      value = script(code, value);
      return suffix ? read(value, suffix, mode) : mode === 'nodes' ? items(value) : value;
    }
    var templateUrl = rule.indexOf('{{') >= 0 && /^(?:https?:\/\/|\/(?!\/))/.test(rule);
    rule = render(rule, input);
    if (templateUrl) return rule;
    var replacement = rule.indexOf('##');
    if (replacement >= 0) {
      var segments = rule.slice(replacement + 2).split('##'), result = read(input, rule.slice(0, replacement), mode);
      var replace = function (v) { v = string(v); var pattern = new RegExp(segments[0], 'g'); if (segments[2] === '1') v = (v.match(pattern) || [''])[0]; return v.replace(pattern, segments[1] || ''); };
      return mode === 'nodes' ? items(result).map(replace) : replace(result);
    }
    for (var operator of ['||', '&&', '%%']) {
      var parts = splitTop(rule, operator);
      if (parts.length > 1) {
        var results = [];
        for (var part of parts) { var found = read(input, part, mode); if (operator === '||') { if (Array.isArray(found) ? found.length : found != null && String(found) !== '') return found; } else results = results.concat(array(found)); }
        return mode === 'nodes' ? results : results.map(string).filter(Boolean).join('\n');
      }
    }
    if (/^\$\d+$/.test(rule) && input && input.__groups) return input.__groups[+rule.slice(1)] || '';
    if (/^-(?:@json:|\$)/i.test(rule)) { var reversed = read(input, rule.slice(1), mode); return Array.isArray(reversed) ? reversed.reverse() : reversed; }
    if (/^(?:@json:|\$(?:[.\[]|$))/i.test(rule)) { var found = jp(input, rule); return mode === 'nodes' ? found.reduce(function (all, value) { return all.concat(array(value)); }, []) : found.map(string).join('\n'); }
    if (/^(?:https?:\/\/|data:)/i.test(rule)) return rule;
    if (/^(?:@regex:|:)/i.test(rule)) {
      var pattern = new RegExp(rule.replace(/^(?:@regex:|:)/i, ''), 'g'), matches = [], match;
      while ((match = pattern.exec(string(input))) && matches.length < 50000) { matches.push({__groups: Array.from(match), toString: function () { return this.__groups[0]; }}); if (!match[0]) pattern.lastIndex++; }
      return mode === 'nodes' ? matches : matches.map(function (m) { return m.__groups[1] || m.__groups[0]; }).join('\n');
    }
    var reverse = rule[0] === '-'; if (reverse) rule = rule.slice(1);
    var attr = 'text', selector = rule;
    if (!/^(?:@?xpath:|\.?\/|\(\/)/i.test(rule)) {
      var bits = rule.replace(/^@?css:/i, '').split('@'), last = bits[bits.length - 1];
      if (/^(?:text|textNodes|ownText|html|all|href|src|content|title|alt|value|outerHtml|data-[\w-]+)$/i.test(last)) { attr = bits.pop(); selector = bits.join('@'); }
    }
    var found = host('dom', {html: input instanceof Element ? input.toString() : input && input.__groups ? input.__groups[0] : string(input), rule: selector, attr: attr, mode: mode === 'nodes' ? 'nodes' : 'field'});
    if (reverse) found.reverse(); return mode === 'nodes' ? found : found.join('\n').trim();
  }
  function Element(html) { this.value = string(html); }
  Element.prototype.toString = function () { return this.value; };
  Element.prototype.html = function () { return host('dom', {html: this.value, attr: 'html'}).join(''); };
  Element.prototype.outerHtml = Element.prototype.toString;
  Element.prototype.text = function () { return text(this.value); };
  Element.prototype.attr = function (name) { return host('dom', {html: this.value, rule: 'body > *', attr: name}).join(''); };
  Element.prototype.select = function (rule) { return host('dom', {html: this.value, rule: rule, mode: 'nodes'}).map(function (html) { return new Element(html); }); };
  Element.prototype.selectFirst = function (rule) { return this.select(rule)[0] || null; };
  Element.prototype.children = function () { return this.select('body > * > *'); };
  Object.defineProperties(Array.prototype, {size: {value: function () { return this.length; }}, get: {value: function (i) { return this[i]; }}, first: {value: function () { return this[0] || null; }}, last: {value: function () { return this[this.length - 1] || null; }}, toArray: {value: function () { return this.slice(); }}, text: {value: function () { return this.map(function (x) { return x instanceof Element ? x.text() : string(x); }).join(' '); }}, attr: {value: function (key) { return this[0] instanceof Element ? this[0].attr(key) : ''; }}});
  Object.defineProperties(String.prototype, {equals: {value: function (value) { return String(this) === String(value); }}, contains: {value: function (value) { return this.indexOf(value) >= 0; }}, isEmpty: {value: function () { return !this.length; }}, toArray: {value: function () { return Array.from(this); }}});
  function request(url, options) {
    if (++requestCount > 192) throw new Error('单次书源请求过多');
    options = options || {}; url = string(url);
    var split = url.search(/,\s*\{/);
    if (split >= 0) { options = Object.assign({}, host('json5', url.slice(split + 1)), options); url = url.slice(0, split); }
    if (/^@?js:/i.test(url) || /^<js>/i.test(url)) url = string(read('', url, 'field'));
    url = absolute(render(url, G.result, {url: true}));
    var method = String(options.method || 'GET').toUpperCase(), body = options.body;
    if (body && typeof body === 'object') body = Object.keys(body).map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(render(body[key], G.result)); }).join('&');
    else if (body != null) body = render(body, G.result, {url: true});
    var response = remote({kind: 'http', url: url, method: method, body: body, headers: Object.assign({}, headers, options.headers || {}), charset: options.charset});
    var responseCookie = response.cookie || '';
    var cookieMap = Object.create(null);
    responseCookie.split(';').forEach(function (pair) { var i = pair.indexOf('='); if (i > 0) cookieMap[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); });
    Object.defineProperty(cookieMap, 'toString', {value: function () { return responseCookie; }});
    response.body = function () { return this.text; }; response.header = function (name) { return this.headers && this.headers[String(name).toLowerCase()] || ''; }; response.cookies = function () { return cookieMap; }; response.code = function () { return this.status || 200; };
    response.cookie = function (name) { return cookieMap[name] || ''; };
    return response;
  }
  function codec(method, value, extra) { return host('codec', Object.assign({method: method, value: string(value)}, extra || {})); }
  function resetPage(response) { currentUrl = response.url; rawPage = response.text; G.baseUrl = currentUrl; G.src = rawPage; G.result = rawPage; }
  function bookData(values) {
    values = Object.assign({name: '', title: '', author: '', bookUrl: '', tocUrl: '', kind: '', coverUrl: ''}, values || {});
    values.name = values.name || values.title; values.title = values.title || values.name; values.bookUrl = values.bookUrl || values.url;
    values.getVariable = function () { return state.bookVariable || ''; }; values.setVariable = function (v) { state.bookVariable = string(v); };
    return values;
  }
  function install() {
    state.vars = state.vars || {}; state.cache = state.cache || {}; state.java = state.java || {};
    G.key = G.searchKey = string(data.params.keyword); G.page = Number(data.params.page || 1); G.baseUrl = raw.bookSourceUrl; G.result = G.src = '';
    G.book = bookData(data.params.book || state.book); G.chapter = Object.assign({title: '', url: '', baseUrl: ''}, data.params.entry || {});
    G.source = Object.assign({}, raw, {key: raw.bookSourceUrl, version: 1,
      get: function (key) { return own(state.vars, key) ? state.vars[key] : ''; }, put: function (key, value) { return put(state.vars, key, value); }, getKey: function () { return raw.bookSourceUrl; }, getVariable: function () { return state.variable || ''; }, setVariable: function (v) { state.variable = string(v); },
      getLoginInfo: function () { return state.loginInfo || ''; }, getLoginInfoMap: function () { var info; try { info = JSON.parse(state.loginInfo || '{}'); } catch (_) { info = {}; } return {get: function (key) { return info[key] || ''; }, toString: function () { return JSON.stringify(info); }}; }, getLoginHeader: function () { return '{}'; }
    });
    G.cache = {get: function (key) { var item = state.cache[key]; return item && (!item.expires || item.expires > Date.now()) ? item.value : ''; }, put: function (key, value, seconds) { state.cache[key] = {value: string(value), expires: seconds ? Date.now() + Number(seconds) * 1000 : 0}; return value; }, delete: function (key) { delete state.cache[key]; }};
    G.cookie = {getKey: function () { return raw.bookSourceUrl; }, getCookie: function (url) { return remote({kind: 'cookie-get', url: absolute(url || raw.bookSourceUrl)}); }, setCookie: function (url, value) { return remote({kind: 'cookie-set', url: absolute(url), cookie: string(value)}); }, removeCookie: function (url) { return remote({kind: 'cookie-remove', url: absolute(url || raw.bookSourceUrl)}); }};
    G.java = {
      ajax: function (url) { return request(url).text; }, get: function (url, h) { return request(url, {headers: h || {}}); }, post: function (url, body, h) { return request(url, {method: 'POST', body: body, headers: h || {}}); }, head: function (url, h) { return request(url, {method: 'HEAD', headers: h || {}}); },
      ajaxAll: function (urls) { return array(urls).map(function (url) { return request(url).text; }); }, getSource: function () { return G.source; }, getBook: function () { return G.book; }, getChapter: function () { return G.chapter; }, getWebViewUA: function () { return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36'; }, importScript: function (url) { return (0, eval)(request(url).text); },
      getString: function (rule, url) { var value = string(read(G.result, rule, 'field')); return url ? absolute(value) : value; }, getStringList: function (rule, url) { return array(read(G.result, rule, 'nodes')).map(function (v) { return url ? absolute(v) : string(v); }); }, getElements: function (rule) { return array(read(G.result, rule, 'nodes')).map(function (v) { return new Element(v); }); }, getElement: function (rule) { return this.getElements(rule); }, setContent: function (value) { G.result = string(value); },
      put: function (key, value) { return put(state.java, key, value); }, getVariable: function (key) { return state.java[key] || ''; },
      base64Decode: function (value, charset) { return codec('base64Decode', value, {charset: charset}); }, base64Encode: function (value, charset) { return codec('base64Encode', value, {charset: charset}); }, hexDecodeToString: function (value, charset) { return codec('hexDecode', value, {charset: charset}); }, hexDecode: function (value) { return codec('hexDecode', value); }, hexEncodeToString: function (value) { return codec('hexEncode', value); },
      encodeURI: function (value, charset) { return codec('encodeURI', value, {charset: charset}); }, decodeURI: function (value) { return decodeURIComponent(value); }, md5Encode: function (value) { return codec('hash', value); }, md5Encode16: function (value) { return codec('hash', value).slice(8, 24); }, sha1Encode: function (value) { return codec('hash', value, {algorithm: 'sha1'}); }, sha256Encode: function (value) { return codec('hash', value, {algorithm: 'sha256'}); },
      aesDecodeToString: function (value, key, algorithm, iv) { return codec('cipher', value, {key: key, algorithm: algorithm, iv: iv}); }, aesEncodeToBase64: function (value, key, algorithm, iv) { return codec('cipher', value, {key: key, algorithm: algorithm, iv: iv, encrypt: true}); },
      getCookie: function (url) { return G.cookie.getCookie(url); }, getCookieStore: function () { return G.cookie; }, androidId: function () { return codec('hash', raw.bookSourceUrl); }, deviceID: function () { return codec('hash', raw.bookSourceUrl); },
      toast: function () {}, longToast: function () {}, log: function () {}, refreshContent: function () {}, refreshExplore: function () {}, upLoginData: function () {}, timeFormat: function (v) { return new Date(Number(v)).toISOString(); }, getLoginInfo: function () { return G.source.getLoginInfo(); },
      startBrowserAwait: function () { var e = new Error('需要人机验证，已跳过此书源'); e.code = 'verification'; throw e; }, openUrl: function () { throw new Error('书源要求打开交互页面，请使用其他书源'); }
    };
    var httpGet = G.java.get; G.java.get = function (url, h) { return arguments.length === 1 && !/^(?:https?:|\/|<js>|@js:)/i.test(String(url)) ? state.java[url] || '' : httpGet(url, h); };
    G.org = {jsoup: {Jsoup: {parse: function (html) { return new Element(html); }}}}; G.jsoup = G.org.jsoup.Jsoup;
    G.Packages = {org: G.org}; G.importClass = function () {}; G.importPackage = function () {};
    G.console = {log: function () {}, warn: function () {}, error: function () {}};
    G.atob = function (value) { return codec('base64Decode', value, {charset: 'latin1'}); }; G.btoa = function (value) { return codec('base64Encode', value, {charset: 'latin1'}); };
    G.URL = function (url, base) { Object.assign(this, host('url', {url: String(url), base: base || currentUrl || raw.bookSourceUrl})); this.toString = function () { return this.href; }; };
    G.java.net = {URI: function (url) { this.toString = function () { return string(url); }; this.resolve = function (next) { return new G.java.net.URI(absolute(next, string(url))); }; }};
  }
  function initLibrary() {
    if (!raw.jsLib) return;
    var libraries = raw.jsLib;
    if (typeof libraries === 'string' && libraries.trim()[0] === '[') { try { libraries = JSON.parse(libraries); } catch (_) {} }
    for (var library of array(libraries)) {
      if (typeof library !== 'string') throw new Error('jsLib 必须为脚本或脚本链接');
      if (/^https?:\/\/[^\s]+$/.test(library.trim())) library = request(library).text;
      (0, eval)(library);
    }
  }
  function prepareHeaders() {
    var value = raw.header || raw.headers || {};
    if (typeof value === 'string') {
      if (/^@?js:|<js>/i.test(value.trim())) value = read('', value, 'field');
      else { try { value = host('json5', value); } catch (_) { try { value = host('json5', '{' + value + '}'); } catch (_) { value = script(value, ''); } } }
    }
    if (typeof value === 'string') value = host('json5', value);
    headers = value || {};
  }
  function search() {
    var urlRule = raw.searchUrl;
    if (!urlRule) throw new Error('书源缺少搜索地址');
    var url = /^\s*(?:@?js:|<js>)/i.test(urlRule) ? read('', urlRule, 'field') : urlRule;
    var response = request(url); resetPage(response);
    var rules = raw.ruleSearch || {}, rows = items(read(response.text, rules.bookList, 'nodes')), found = [], seen = {};
    for (var row of rows.slice(0, 200)) {
      var name = string(read(row, rules.name, 'field')), author = rules.author ? string(read(row, rules.author, 'field')) : '';
      var link = string(read(row, rules.bookUrl || 'href', 'field'));
      if (!name || !link) continue;
      link = absolute(link, response.url); if (seen[link]) continue; seen[link] = true;
      found.push({sourceId: data.source.id, sourceName: data.source.name, title: name, author: author, url: link});
    }
    return found;
  }
  function toc() {
    var bookUrl = data.params.url, response = request(bookUrl); resetPage(response);
    var info = raw.ruleBookInfo || {};
    if (info.init) { var initialized = read(response.text, info.init, 'field'); if (initialized != null) { response.text = string(initialized); G.result = response.text; } }
    for (var field of ['name', 'author', 'coverUrl', 'kind']) if (info[field]) G.book[field] = string(read(response.text, info[field], 'field'));
    G.book.bookUrl = bookUrl; G.book.title = G.book.name;
    if (info.tocUrl) {
      var link = string(read(response.text, info.tocUrl, 'field'));
      if (link && absolute(link, response.url) !== response.url) { response = request(absolute(link, response.url)); resetPage(response); }
    }
    G.book.tocUrl = response.url; state.book = JSON.parse(JSON.stringify(G.book));
    var rules = raw.ruleToc || {}, found = [], visited = {};
    for (var page = 0; page < 30; page++) {
      if (visited[response.url]) break; visited[response.url] = true;
      var rows = items(read(response.text, rules.chapterList, 'nodes'));
      for (var row of rows) {
        if (rules.isVolume && /^(?:true|1)$/i.test(string(read(row, rules.isVolume, 'field')))) continue;
        var name = string(read(row, rules.chapterName || 'text', 'field')), url = string(read(row, rules.chapterUrl || 'href', 'field'));
        if (name && url) found.push({title: name, url: absolute(url, response.url)});
      }
      var next = rules.nextTocUrl ? string(read(response.text, rules.nextTocUrl, 'field')) : '';
      if (!next || visited[absolute(next, response.url)]) break;
      if (page === 29) throw new Error('目录超过 30 页'); response = request(absolute(next, response.url)); resetPage(response);
    }
    var byUrl = new Map(); for (var entry of found) { byUrl.delete(entry.url); byUrl.set(entry.url, entry); }
    found = Array.from(byUrl.values()); if (!found.length) throw new Error('没有解析到章节目录'); return found;
  }
  function content() {
    var rules = raw.ruleContent || {}, entry = data.params.entry || {}, url = entry.url, parts = [], visited = {};
    G.chapter = Object.assign({baseUrl: url}, entry); G.book.durChapterTitle = entry.title;
    for (var page = 0; page < 12; page++) {
      if (visited[url]) break; visited[url] = true;
      var response = request(url); resetPage(response); G.chapter.baseUrl = G.chapter.url = response.url;
      var value = string(read(response.text, rules.content, 'field'));
      if (!value.trim()) throw new Error('没有解析到正文'); parts.push(text(value));
      var next = rules.nextContentUrl ? string(read(response.text, rules.nextContentUrl, 'field')) : '';
      if (!next || next === 'null' || next === 'undefined' || visited[absolute(next, response.url)]) break;
      if (page === 11) throw new Error('正文分页超过 12 页'); url = absolute(next, response.url);
    }
    var value = parts.join('\n\n');
    if (rules.replaceRegex) value = string(read(value, rules.replaceRegex.indexOf('##') === 0 ? rules.replaceRegex : '##' + rules.replaceRegex, 'field'));
    if (!value.trim()) throw new Error('正文为空'); return {title: entry.title, text: value.trim().slice(0, 1000000)};
  }
  G.__run = function (input) {
    data = input; raw = data.source.raw; state = data.state || {}; install(); initLibrary(); prepareHeaders();
    var value;
    if (data.operation === 'search') value = search(); else if (data.operation === 'toc') value = toc(); else if (data.operation === 'chapter') value = content();
    else if (data.operation === 'evaluate') value = script(data.params.code, data.params.result || '');
    else throw new Error('未知书源操作');
    if (JSON.stringify(state).length > 2 * 1024 * 1024) throw new Error('书源状态超过 2 MB');
    return {value: value, state: state};
  };
})();
