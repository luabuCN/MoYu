'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {installApplication} = require('../scripts/install-application.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-package-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('moyu-package-'));
    fs.rmSync(root, {recursive: true, force: true});
  });
  const resources = path.join(root, 'resources');
  const installed = path.join(resources, 'app');
  const staging = path.join(resources, 'app-stage');
  const backup = path.join(resources, 'app-backup');
  for (const dir of [installed, staging]) fs.mkdirSync(path.join(dir, 'renderer-dist'), {recursive: true});
  fs.writeFileSync(path.join(installed, 'main.cjs'), 'old-main');
  fs.writeFileSync(path.join(installed, 'renderer-dist', 'index.html'), 'old-ui');
  fs.writeFileSync(path.join(installed, 'obsolete.cjs'), 'old-only');
  fs.writeFileSync(path.join(staging, 'main.cjs'), 'new-main');
  fs.writeFileSync(path.join(staging, 'renderer-dist', 'index.html'), 'new-ui');
  fs.writeFileSync(path.join(staging, 'new.cjs'), 'new-only');
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'books.json'), 'user-books');
  return {root, resources, installed, staging, backup};
}

function read(dir, file) { return fs.readFileSync(path.join(dir, file), 'utf8'); }
function locked() { return Object.assign(new Error('locked'), {code: 'EPERM'}); }

for (const lockDirectories of [false, true]) {
  test(`installs current files and preserves backup and data (directory locks: ${lockDirectories})`, t => {
    const paths = fixture(t);
    const io = {...fs, renameSync(from, to) {
      if (lockDirectories && from.startsWith(paths.installed) && fs.lstatSync(from).isDirectory()) throw locked();
      fs.renameSync(from, to);
    }};
    const result = installApplication({...paths, io});
    assert.equal(result.usedDirectoryFallback, lockDirectories);
    assert.equal(read(paths.installed, 'main.cjs'), 'new-main');
    assert.equal(read(paths.installed, 'renderer-dist/index.html'), 'new-ui');
    assert.equal(read(paths.installed, 'new.cjs'), 'new-only');
    assert.equal(fs.existsSync(path.join(paths.installed, 'obsolete.cjs')), false);
    assert.equal(read(paths.backup, 'renderer-dist/index.html'), 'old-ui');
    assert.equal(read(paths.backup, 'obsolete.cjs'), 'old-only');
    assert.equal(read(paths.root, 'data/books.json'), 'user-books');
  });
}

test('restores the old application when a staged file cannot be installed', t => {
  const paths = fixture(t);
  const io = {...fs, renameSync(from, to) {
    if (from === paths.installed || from === paths.staging) throw locked();
    if (from === path.join(paths.staging, 'renderer-dist', 'index.html')) throw locked();
    if (from === path.join(paths.staging, 'renderer-dist')) throw locked();
    fs.renameSync(from, to);
  }};
  assert.throws(() => installApplication({...paths, io}), /locked/);
  assert.equal(read(paths.installed, 'main.cjs'), 'old-main');
  assert.equal(read(paths.installed, 'renderer-dist/index.html'), 'old-ui');
  assert.equal(read(paths.installed, 'obsolete.cjs'), 'old-only');
  assert.equal(fs.existsSync(path.join(paths.installed, 'new.cjs')), false);
  assert.equal(read(paths.staging, 'main.cjs'), 'new-main');
  assert.equal(read(paths.root, 'data/books.json'), 'user-books');
});

test('rejects destinations outside release resources before moving files', t => {
  const paths = fixture(t);
  assert.throws(() => installApplication({...paths, backup: path.join(paths.root, 'data')}), /超出发布目录/);
  assert.equal(read(paths.installed, 'main.cjs'), 'old-main');
  assert.equal(read(paths.root, 'data/books.json'), 'user-books');
});
