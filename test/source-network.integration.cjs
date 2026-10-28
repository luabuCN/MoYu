'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {session} = require('electron');
const {chromiumFetch, readerUserAgent, requestPage, sourceImportUrl} = require('../reader.cjs');

exports.run = async ({record}) => {
  assert.equal(sourceImportUrl('https://shuyuan.yiove.com/book-sources?page=1&page_size=20'), 'https://shuyuan-api.yiove.com/import/book-sources/1-20');
  assert.equal(sourceImportUrl('https://shuyuan.yiove.com/book-sources?page=2&page_size=50'), 'https://shuyuan-api.yiove.com/import/book-sources/2-50');
  assert.equal(sourceImportUrl('https://shuyuan.yiove.com/book-sources/'), 'https://shuyuan-api.yiove.com/import/book-sources/1-20');
  for (const url of ['https://shuyuan-api.yiove.com/import/book-sources/2-20', 'https://example.com/sources.json', 'https://shuyuan.yiove.com.evil.invalid/book-sources?page=2']) assert.equal(sourceImportUrl(url), url);
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=9007199254740992', 'page_size=0', 'page_size=1001', 'page_size=abc']) assert.throws(() => sourceImportUrl('https://shuyuan.yiove.com/book-sources?' + query), /Yiove/);
  for (const url of ['invalid', 'file:///etc/passwd', 'https://user:pass@shuyuan.yiove.com/book-sources']) assert.throws(() => sourceImportUrl(url));
  record('Yiove list-page imports map to the official JSON endpoint, preserve pagination and validate input without rewriting unrelated hosts');
  const publicUrl = 'https://203.0.113.10/source';
  const quotedChallenge = '<title>Just a moment...</title><form id="challenge-form">cf-turnstile cf-chl-</form>';
  const config = {name: '引用验证检测规则的书源', baseUrl: 'https://example.com', search: {url: '/search'}, comment: quotedChallenge};
  for (const [body, type] of [[JSON.stringify([config]), 'application/json'], [JSON.stringify([config]), 'text/plain'], [JSON.stringify([config]), 'text/html'], [`const source = ${JSON.stringify(config)}; export default source;`, 'text/plain']]) {
    const result = await requestPage(publicUrl, {}, {fetch: async () => new Response(body, {headers: {'Content-Type': type}})});
    assert.equal(result.text, body, 'quoted challenge text in source configuration must remain importable');
  }
  for (const status of [200, 403]) {
    await assert.rejects(requestPage(publicUrl, {}, {fetch: async () => new Response('<!doctype html><html>' + quotedChallenge + '</html>', {status, headers: {'Content-Type': 'text/html'}})}), error => error.code === 'verification');
  }
  await assert.rejects(requestPage(publicUrl, {}, {fetch: async () => new Response('Forbidden', {status: 403})}), error => error.code === 'http' && error.status === 403);
  record('source JSON and static TS containing challenge strings import normally; real 200/403 challenges are identified without misclassifying plain HTTP 403');
  const received = [];
  const server = http.createServer((req, res) => {
    received.push(req.url);
    if (req.url === '/redirect') {
      res.writeHead(302, {Location: '/result', 'Set-Cookie': 'source_redirect=ok; Path=/; HttpOnly'});
      res.end(); return;
    }
    if (req.url === '/slow') return;
    if (req.url === '/large') { res.end(Buffer.alloc(8 * 1024 * 1024 + 1)); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({method: req.method, cookie: req.headers.cookie || '', userAgent: req.headers['user-agent'], body}));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ses = session.fromPartition(`moyu-source-network-${Date.now()}`);
  try {
    const defaultAgent = ses.getUserAgent();
    assert.match(defaultAgent, /沫鱼\//, 'regression must use the actual Chinese application name');
    assert.throws(() => new Headers({'User-Agent': defaultAgent}), /ByteString/);
    const userAgent = readerUserAgent(defaultAgent);
    ses.setUserAgent(userAgent);
    const agentResponse = await chromiumFetch(ses, origin + '/agent', {headers: {'User-Agent': ses.getUserAgent()}});
    const agentData = await agentResponse.json();
    assert.equal(agentData.userAgent, userAgent);
    assert.match(userAgent, /Mozilla\/.*Chrome\//);
    assert.doesNotMatch(userAgent, /[^\x20-\x7e]|Electron\/|(?:moyu-browser|shpeerlazy-browser)\//);
    record('source requests accept the real Chinese application name by removing its token from User-Agent');
    received.length = 0;
    const redirected = await chromiumFetch(ses, origin + '/redirect');
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get('location'), origin + '/result');
    assert.deepEqual(received, ['/redirect'], 'redirect target must wait for URL validation');
    const response = await chromiumFetch(ses, redirected.headers.get('location'));
    assert.match((await response.json()).cookie, /source_redirect=ok/);
    const posted = await chromiumFetch(ses, origin + '/form', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'keyword=%E8%A5%BF%E6%B8%B8%E8%AE%B0'});
    const form = await posted.json();
    assert.equal(form.method, 'POST');
    assert.equal(new URLSearchParams(form.body).get('keyword'), '西游记');
    record('source requests expose redirects before following, preserve session cookies and submit encoded search forms');

    const controller = new AbortController();
    const pending = chromiumFetch(ses, origin + '/slow', {signal: controller.signal});
    const rejection = assert.rejects(pending, /abort/i);
    controller.abort(); await rejection;
    await assert.rejects(chromiumFetch(ses, origin + '/large'), /8 MB/);
    record('source requests support cancellation and reject responses over 8 MB');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
};
