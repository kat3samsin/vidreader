import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReaderServer } from '../server.mjs';

test('serves only the reader assets', async t => {
  const server = createReaderServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  for (const path of ['/', '/index.html', '/app.js', '/reader.css', '/tokens.css']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 200, path);
  }
  for (const path of ['/server.mjs', '/request-security.mjs', '/.env.local', '/.cache/private.vtt', '/.DS_Store', '/../server.mjs']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
});

test('serves the VidReader product name', async t => {
  const server = createReaderServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const html = await fetch(`http://127.0.0.1:${port}/`).then(response => response.text());

  assert.match(html, /<title>VidReader<\/title>/);
  assert.match(html, /aria-label="VidReader home"/);
  assert.match(html, />VidReader<\/span>/);
});

test('defaults new readers to Focus without overriding a saved mode', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const initializer = app.match(/const savedReaderMode = localStorage\.getItem\('watchpaper-reader-mode'\);\nlet readerMode = [^\n]+;/)?.[0];
  assert.ok(initializer);
  const modeFor = savedMode => Function('localStorage', `${initializer}\nreturn readerMode;`)({ getItem: () => savedMode });

  assert.equal(modeFor(null), 'focus');
  assert.equal(modeFor('invalid'), 'focus');
  for (const mode of ['distill', 'focus', 'raw']) assert.equal(modeFor(mode), mode);
});

test('rejects unsupported provider endpoints without redirecting', async t => {
  const server = createReaderServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/provider/embed?videoId=invalid`, { redirect: 'manual' });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('location'), null);
});
