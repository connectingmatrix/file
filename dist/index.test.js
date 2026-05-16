import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from './index.js';
test('file package owns mime processing and zip extract', async () => { const ctx = { userId: 'u1' }; assert.equal(File.detectMimeType('a.zip'), 'application/zip'); const zipped = await File.zip([{ path: 'src/a.txt', content: 'hello' }]); const files = await File.unzip(zipped); assert.equal(files[0].path, 'src/a.txt'); const f = await File.upload({ fileName: 'a.txt', content: 'hello' }, ctx); const p = await File.process(f.path, 'memory', ctx); assert.equal(p.processor, 'text'); assert.equal(File.health().details?.ownsZipAndMimeProcessing, true); });
