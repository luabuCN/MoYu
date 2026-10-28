'use strict';
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dryRun = args[0] === '--dry-run';
if (dryRun) args.shift();
const message = args.join(' ').trim();
if (!message) { console.error('用法：npm run submit -- "feat: 本次修改说明"'); process.exit(1); }
function git(args, capture = false) {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout?.trim();
}
if (dryRun) {
  console.log('将执行：git add --all；git commit；git push。GitHub 随后构建并发布三个安装包。');
  console.log('提交说明：' + message);
  process.exit(0);
}
if (path.resolve(git(['rev-parse', '--show-toplevel'], true)) !== root) throw new Error('请先在项目根目录初始化 Git 并配置 origin，步骤见 docs/RELEASING.md');
const remote = git(['remote', 'get-url', 'origin'], true);
if (!/^(?:https:\/\/github\.com\/luabuCN\/MoYu(?:\.git)?|git@github\.com:luabuCN\/MoYu(?:\.git)?)$/.test(remote)) throw new Error('origin 与 luabuCN/MoYu 不一致，请先确认远程地址');
const branch = git(['symbolic-ref', '--short', 'HEAD'], true);
git(['add', '--all']);
const staged = git(['diff', '--cached', '--name-only', '-z'], true).split('\0').filter(Boolean);
if (staged.some(name => /^(?:data|browser|dist|release|node_modules|codex-research-obsolete|\.codex-research)\//.test(name) || /(?:^|\/)\.env(?:\.|$)|\.(?:p12|pfx|p8|key)$/i.test(name))) throw new Error('暂存区含运行资料或密钥，请先移出暂存区');
if (!staged.length) { console.log('没有需要提交的修改。'); process.exit(0); }
git(['commit', '-m', message]);
git(['push', '--set-upstream', 'origin', branch]);
