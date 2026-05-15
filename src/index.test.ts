import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from './index.js';

test('zips and unzips files', async () => {
  const archive = await File.zip([{ path: 'a.txt', content: 'hello' }]);
  const files = await File.unzip(archive);
  assert.equal(files[0].path, 'a.txt');
  assert.equal(files[0].content, 'hello');
});
