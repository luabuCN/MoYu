'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveDataDirectory} = require('../app-paths.cjs');

test('source and legacy portable editions keep their existing independent data folders', () => {
  const paths = {platform: 'win32', sourceRoot: 'E:\\study\\moyu', executablePath: 'E:\\study\\moyu\\dist\\沫鱼-win32-x64\\沫鱼.exe', appData: 'C:\\Users\\demo\\AppData\\Roaming'};
  assert.equal(resolveDataDirectory({...paths, isPackaged: false}), 'E:\\study\\moyu\\data\\browser');
  assert.equal(resolveDataDirectory({...paths, isPackaged: true}), 'E:\\study\\moyu\\dist\\沫鱼-win32-x64\\data\\browser');
});

test('Windows installer stores data in the user profile, independently of install location', () => {
  const paths = {platform: 'win32', isPackaged: true, distribution: 'installed', appData: 'C:\\Users\\demo\\AppData\\Roaming'};
  const expected = 'C:\\Users\\demo\\AppData\\Roaming\\MoYu\\data\\browser';
  for (const executablePath of ['C:\\Program Files\\MoYu\\沫鱼.exe', 'D:\\Apps\\沫鱼.exe']) {
    assert.equal(resolveDataDirectory({...paths, executablePath}), expected);
  }
});

test('macOS installer writes outside the signed application bundle and mounted DMG', () => {
  const paths = {platform: 'darwin', isPackaged: true, distribution: 'installed', appData: '/Users/demo/Library/Application Support'};
  const expected = '/Users/demo/Library/Application Support/MoYu/data/browser';
  for (const executablePath of ['/Applications/沫鱼.app/Contents/MacOS/沫鱼', '/Volumes/MoYu/沫鱼.app/Contents/MacOS/沫鱼']) {
    assert.equal(resolveDataDirectory({...paths, executablePath}), expected);
  }
});
