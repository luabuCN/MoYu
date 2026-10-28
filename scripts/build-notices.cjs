'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const sections = ['Third-party notices for 沫鱼 (MoYu)\n\nThe reader uses epub.js (BSD-2-Clause), JSZip (MIT), DOMPurify (Apache-2.0 OR MPL-2.0), JSON5 (MIT), iconv-lite (MIT), QuickJS/quickjs-emscripten (MIT), JSONPath Plus (MIT), Cheerio (MIT), xpath (MIT), and xmldom (MIT).\nThe novel source engine and its compatibility host are independently implemented. eReader is a design/format reference; its code is not included.\n\nThe following notices include production dependencies shipped in the renderer bundle and main process.'];
for (const [relative, info] of Object.entries(lock.packages)) {
  if (!relative || info.dev) continue;
  const directory = path.join(root, relative);
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const notices = fs.readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
  sections.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || 'See notice below')}\n${notices.map(name => `\n--- ${name} ---\n${fs.readFileSync(path.join(directory, name), 'utf8')}`).join('\n')}`);
}
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), sections.join('\n'), 'utf8');
console.log('已整理阅读器与界面的第三方许可证声明');
