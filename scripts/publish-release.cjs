'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {fromEnvironment} = require('./release-metadata.cjs');
const {version} = require('../package.json');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'release');
const repository = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Missing repository');
if (!process.env.GH_TOKEN) throw new Error('Missing GH_TOKEN');
const metadata = fromEnvironment();
const names = [`MoYu-${version}-windows-x64-setup.exe`, `MoYu-${version}-macos-arm64.dmg`, `MoYu-${version}-macos-x64.dmg`].sort();
for (const name of names) {
  if (!fs.existsSync(path.join(output, name)) || fs.statSync(path.join(output, name)).size < 1024) throw new Error(`安装包缺失：${name}`);
}
const checksum = names.map(name => `${createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')}  ${name}`).join('\n') + '\n';
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), checksum);
fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify({version, commit: process.env.GITHUB_SHA,
  workflow: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`}, null, 2) + '\n');
const notes = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'moyu-release-notes.md');
fs.writeFileSync(notes, [
  '忙里冒个泡。', '',
  '| 平台 | 下载文件 |', '| --- | --- |',
  ...names.map(name => `| ${name.includes('windows') ? 'Windows x64 安装程序' : name.includes('arm64') ? 'Mac Apple Silicon' : 'Mac Intel'} | \`${name}\` |`),
  '', `提交：${process.env.GITHUB_SHA}`, '',
  '安装与功能介绍见 [README](https://github.com/' + repository + '/blob/' + process.env.GITHUB_SHA + '/README.md)。',
  'SHA256SUMS.txt 用于校验下载文件。签名和公证状态请查看本次构建日志；未配置证书的构建属于未经公证的开发预览包。', '',
].join('\n'));
function gh(args, capture = false) {
  const result = spawnSync('gh', [...args, '--repo', repository], {cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit'});
  if (result.error) throw result.error;
  if (!capture && result.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed`);
  return result;
}
if (gh(['release', 'view', metadata.tag], true).status !== 0) {
  gh(['release', 'create', metadata.tag, '--draft', '--target', process.env.GITHUB_SHA, '--title', metadata.title, '--notes-file', notes, '--latest=false']);
}
gh(['release', 'upload', metadata.tag, ...names.map(name => path.join(output, name)), path.join(output, 'SHA256SUMS.txt'), path.join(output, 'build-info.json'), '--clobber']);
gh(['release', 'edit', metadata.tag, '--title', metadata.title, '--notes-file', notes, '--draft=false', `--prerelease=${metadata.prerelease}`, `--latest=${!metadata.prerelease}`]);
