'use strict';
const path = require('node:path');

// Installed apps must not write into Program Files or a signed macOS .app.
// The existing portable edition keeps its data beside the executable.
function resolveDataDirectory({isPackaged, distribution, sourceRoot, executablePath, appData, platform = process.platform}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!isPackaged) return paths.join(sourceRoot, 'data', 'browser');
  if (distribution === 'installed') return paths.join(appData, 'MoYu', 'data', 'browser');
  return paths.join(paths.dirname(executablePath), 'data', 'browser');
}

module.exports = {resolveDataDirectory};
