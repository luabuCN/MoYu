'use strict';
const path = require('node:path');
const signing = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarization = signing && Boolean(
  (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) ||
  (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER)
);

module.exports = {
  appId: 'local.moyu.browser',
  productName: '沫鱼',
  electronDist: ({platformName, arch}) => platformName === process.platform && arch === process.arch
    ? path.join(__dirname, 'node_modules', 'electron', 'dist') : null,
  directories: {output: 'release', buildResources: 'build'},
  asar: true,
  asarUnpack: ['native/*.exe'],
  npmRebuild: false,
  extraMetadata: {moyuDistribution: 'installed'},
  // An explicit list keeps books, browser profiles, old releases and screenshots out.
  files: [
    '*.cjs', 'package.json', 'reader-shortcuts.json', 'legado-runtime.js',
    'renderer-dist/**/*', 'web-scrollbars.css', 'ui/**/*', 'assets/brand/**/*',
    'READER.md', 'LICENSE', 'THIRD-PARTY-NOTICES.txt',
    '!electron-builder.config.cjs', '!**/*.log',
  ],
  extraResources: [{from: 'examples', to: 'examples'}, {from: 'licenses', to: 'licenses'}, {from: 'LICENSE', to: 'LICENSE.txt'}],
  publish: null,
  win: {
    target: [{target: 'nsis', arch: ['x64']}],
    icon: 'assets/brand/app.ico',
    files: ['native/outside-click-monitor.exe'],
    artifactName: 'MoYu-${version}-windows-${arch}-setup.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '沫鱼',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
  mac: {
    target: [{target: 'dmg', arch: ['arm64', 'x64']}],
    category: 'public.app-category.productivity',
    icon: 'assets/brand/app.png',
    artifactName: 'MoYu-${version}-macos-${arch}.${ext}',
    identity: signing ? undefined : '-',
    hardenedRuntime: signing,
    notarize: notarization,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  dmg: {title: '沫鱼 ${version}'},
};
