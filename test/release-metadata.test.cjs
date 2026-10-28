'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {releaseMetadata} = require('../scripts/release-metadata.cjs');
const input = {sha: 'a'.repeat(40), runNumber: 12, version: '1.6.0'};
test('branch pushes create distinct preview releases without replacing stable releases', () => {
  const first = releaseMetadata({...input, ref: 'refs/heads/main'});
  assert.equal(first.prerelease, true);
  assert.notEqual(first.tag, releaseMetadata({...input, runNumber: 13, ref: 'refs/heads/main'}).tag);
});
test('stable release tags must match the packaged version', () => {
  assert.deepEqual(releaseMetadata({...input, ref: 'refs/tags/v1.6.0'}), {tag: 'v1.6.0', title: '沫鱼 v1.6.0', prerelease: false});
  assert.throws(() => releaseMetadata({...input, ref: 'refs/tags/v1.7.0'}), /package.json/);
  assert.equal(releaseMetadata({...input, version: '1.7.0-beta.1', ref: 'refs/tags/v1.7.0-beta.1'}).prerelease, true);
});
