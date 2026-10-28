'use strict';
const fs = require('node:fs');
const {version} = require('../package.json');

function releaseMetadata({ref, sha, runNumber, version: appVersion}) {
  if (!/^[a-f\d]{40}$/i.test(sha || '')) throw new Error('Missing or invalid commit SHA');
  if (!/^\d+$/.test(String(runNumber))) throw new Error('Missing workflow run number');
  if (ref?.startsWith('refs/tags/')) {
    if (ref !== `refs/tags/v${appVersion}`) throw new Error(`版本标签必须与 package.json 一致：v${appVersion}`);
    return {tag: `v${appVersion}`, title: `沫鱼 v${appVersion}`, prerelease: appVersion.includes('-')};
  }
  return {tag: `build-${runNumber}-${sha.slice(0, 8)}`, title: `沫鱼 ${appVersion} · ${sha.slice(0, 8)}`, prerelease: true};
}

function fromEnvironment() {
  return releaseMetadata({ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, runNumber: process.env.GITHUB_RUN_NUMBER, version});
}
if (require.main === module) {
  const metadata = fromEnvironment();
  console.log(JSON.stringify(metadata));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
}
module.exports = {releaseMetadata, fromEnvironment};
