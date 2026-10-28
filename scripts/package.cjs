'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {installApplication} = require('./install-application.cjs');
const project = path.resolve(__dirname,'..');
const metadata = JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
const productName = metadata.productName;
const runtime = path.join(project,'node_modules','electron','dist');
if (!fs.existsSync(path.join(runtime,'electron.exe'))) throw new Error('请先运行 npm install 安装 Electron');
if (!fs.existsSync(path.join(project,'renderer-dist','index.html'))) throw new Error('请先运行 npm run build 构建 Vue 界面');
const output = path.join(project,'dist',`${productName}-win32-x64`);
function copyTree(from, to) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to,{recursive:true});
    for (const name of fs.readdirSync(from)) copyTree(path.join(from,name),path.join(to,name));
  } else fs.copyFileSync(from,to);
}
const source = path.join(output,'resources','app');
let previous;
// An explicit update backs up only application files and never touches data/.
if (fs.existsSync(output)) {
  if (!process.argv.includes('--update')) throw new Error(`输出目录已存在。更新代码并保留资料请运行 npm run package:update：${output}`);
  previous = JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
  if (![metadata.name, 'shpeerlazy-browser'].includes(previous.name)) throw new Error('目标不是本程序，停止更新');
  if (fs.readFileSync(path.join(output,'version'),'utf8').trim() !== fs.readFileSync(path.join(runtime,'version'),'utf8').trim()) throw new Error('Electron 运行时版本不同，请另建发布目录');
} else {
  fs.mkdirSync(output,{recursive:true});
  copyTree(runtime,output);
  fs.renameSync(path.join(output,'electron.exe'),path.join(output,`${productName}.exe`));
}
const resources = path.resolve(output,'resources');
const staging = path.join(resources,`app-stage-${Date.now()}`);
const backup = path.join(resources,`app-backup-${Date.now()}`);
// Every directory rename is confined to this release's resources directory.
for (const target of [source,staging,backup]) {
  const relative = path.relative(resources,path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('应用更新路径超出发布目录');
}
fs.mkdirSync(staging,{recursive:true});
for (const name of ['main.cjs','app-paths.cjs','core.cjs','reader.cjs','reader-shortcuts.cjs','reader-shortcuts.json','legado.cjs','legado-worker.cjs','legado-dom.cjs','legado-runtime.js','outside-click.cjs','media-control.cjs','native','preload.cjs','edge-preload.cjs','package.json','renderer-dist','web-scrollbars.css','ui','assets','READER.md','THIRD-PARTY-NOTICES.txt']) {
  copyTree(path.join(project,name),path.join(staging,name));
}
const packageLock = JSON.parse(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8'));
for (const [name, dependency] of Object.entries(packageLock.packages)) {
  if (name.startsWith('node_modules/') && !dependency.dev) copyTree(path.join(project, name), path.join(staging, name));
}
const installation = installApplication({resources, staging, installed: source, backup});
if (installation.usedDirectoryFallback) console.log('应用目录被占用，已通过逐项替换完成更新；旧应用文件已备份。');
fs.copyFileSync(path.join(project,'LICENSE'),path.join(output,'MOYU-LICENSE.txt'));
fs.copyFileSync(path.join(project,'licenses','SHPEERLAZY-LICENSE.txt'),path.join(output,'SHPEERLAZY-LICENSE.txt'));
fs.copyFileSync(path.join(project,'examples','中华典藏书源.json'),path.join(output,'中华典藏书源.json'));
fs.copyFileSync(path.join(project,'scripts','portable-launcher.vbs'),path.join(output,'start.vbs'));
fs.writeFileSync(path.join(output,'使用说明.txt'), [
  '沫鱼 · MoYu — 忙里冒个泡。',
  `双击 start.vbs 启动，可自动应用等待中的程序图标更新。也可直接运行 ${productName}.exe。`,
  '整个文件夹一起移动，请勿单独移动 exe。',
  '新版首页含横向分类、快捷站点与继续上次浏览入口。顶部书本图标打开 TXT / EPUB 阅读器。',
  '应用只在系统托盘保留图标，不显示任务栏按钮。',
  '网页链接、新窗口请求和书源验证统一在当前窗口打开，顶部工具栏可后退或返回阅读器。',
  '顶部“关闭网页”或 Ctrl+W 停止音视频并释放网页；阅读器保持打开，历史、收藏和登录状态保留。',
  '“收起时暂停媒体”开启时，隐藏、最小化或切换到其他面板立即静音并暂停各层网页播放器，返回网页后恢复。',
  '设置中可开启“鼠标移出收进托盘”：离开窗口超过 100 像素，停留 2 秒后收起；在窗口外点击立即收起。',
  '回到窗口或 100 像素缓冲区取消计时。收起后移回不会打开，点击托盘图标恢复。',
  '拖动、缩放、应用菜单和文件选择框操作期间暂停自动收起。',
  '“启用侧边收起”默认关闭，只控制手动侧边收起，不影响鼠标移出收进托盘。',
  'Ctrl+Shift+Space 显示/隐藏；也可点击系统托盘恢复。',
  '书源支持 JS、共享 jsLib、JSONPath、动态模板和常用 java 接口；脚本在 QuickJS 沙箱运行。',
  '可在阅读器的“书源管理”导入本文件夹中的“中华典藏书源.json”，搜索古典小说与名著。',
  '支持 eReader 静态 source.ts、CSS / XPath、正则替换和 GBK 搜索。下拉框切换书源自动重新搜索。',
  '阅读页“切换书源”先确认目录和正文再续读；搜索遇到人机验证自动跳过。',
  '阅读页底部“滚动 / 翻页”切换阅读方式；左右翻页时点正文左侧上一页、右侧下一页。底部箭头切换上、下章。',
  '阅读页的返回书架、书名、章节名、换源、书签和阅读设置统一放在底部一行展示，窄窗口收紧间距并省略长标题。',
  '阅读设置支持透明背景：隐藏上下工具栏，只保留黑色正文。Ctrl+Shift+T 切换透明，Esc 或点击托盘恢复。',
  '阅读设置的“快捷键”页可修改翻页、换章、滚动及透明切换键，Ctrl+, 打开阅读设置。',
  '收藏、书籍和登录数据保存在本文件夹 data\\browser。',
  '右上角 × 收起窗口，设置页或托盘菜单可彻底退出。',
  '',
].join('\r\n'), 'utf8');

async function finishRelease() {
  const executable = path.join(output,`${productName}.exe`);
  const pending = path.join(output,`${productName}.next.exe`);
  fs.copyFileSync(path.join(runtime,'electron.exe'),pending);
  const resourceEditor = path.resolve(path.dirname(require.resolve('rcedit')),'..','bin','rcedit-x64.exe');
  await promisify(execFile)(resourceEditor,[
    pending,'--set-icon',path.join(project,'assets','brand','app.ico'),
    '--set-version-string','ProductName',productName,
    '--set-version-string','FileDescription',productName,
    '--set-version-string','OriginalFilename',`${productName}.exe`,
    '--set-file-version',`${metadata.version}.0`,
    '--set-product-version',`${metadata.version}.0`,
  ],{windowsHide:true});
  try { fs.renameSync(pending,executable); }
  catch (error) {
    if (!['EPERM','EACCES','EBUSY'].includes(error.code)) throw error;
    console.log('程序正在使用，Windows 图标将在退出后下次通过启动入口打开时应用。');
  }
  console.log(`已生成免安装版：${output}`);
}
finishRelease().catch(error => { console.error(error); process.exitCode = 1; });
