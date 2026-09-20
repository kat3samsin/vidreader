import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createReaderServer } from '../server.mjs';
import { checkRequest } from '../request-security.mjs';

async function readerFor(t) {
  const server = createReaderServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const send = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(body);
  });
  return { send, origin, port };
}

test('rejects internal and non-channel URLs before making an outbound request', async t => {
  const { send } = await readerFor(t);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches += 1;
    throw new Error('Outbound requests are blocked in this test.');
  });
  for (const source of [
    'http://127.0.0.1:9/private',
    'https://youtube.com.evil.example/@fixture',
    'https://www.youtube.com@127.0.0.1/private',
    'https://www.youtube.com/redirect?q=http://127.0.0.1/private',
  ]) {
    assert.equal((await send(`/api/channel?source=${encodeURIComponent(source)}`)).status, 400, source);
  }
  assert.equal(fetches, 0);
});

test('resolves a YouTube handle with redirects disabled', async t => {
  const { send } = await readerFor(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response(calls.length === 1 ? '"channelId":"UC1234567890123456789012"' : '<feed></feed>');
  });
  assert.equal((await send('/api/channel?source=%40security-fixture')).status, 200);
  assert.equal(calls[0].url, 'https://www.youtube.com/@security-fixture');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].url, 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012');
});

test('blocks hostile hosts and origins before fetching video metadata', async t => {
  const { send, port } = await readerFor(t);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches += 1;
    return Response.json({ title: 'Example video', author_name: 'Example channel' });
  });
  for (const headers of [
    { host: `attacker.example:${port}` },
    { origin: 'https://attacker.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    assert.equal((await send('/api/video?source=abcdefghijk', { headers })).status, 403);
  }
  assert.equal(fetches, 0);
});

test('rejects unsupported video URLs and provider IDs before outbound work', async t => {
  const { send } = await readerFor(t);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches += 1;
    throw new Error('Outbound requests are blocked in this test.');
  });
  for (const source of ['https://videos.example/example-session', 'provider:123', 'https://youtube.com.evil.example/watch?v=abcdefghijk']) {
    const response = await send(`/api/video?source=${encodeURIComponent(source)}`);
    assert.equal(response.status, 400, source);
    assert.equal(JSON.parse(response.body).error, 'Paste a valid YouTube video link.');
  }
  for (const videoId of ['provider:123', 'https://videos.example/example-session', '../abcdefghijk']) {
    const response = await send(`/api/transcript?videoId=${encodeURIComponent(videoId)}`);
    assert.equal(response.status, 400, videoId);
    assert.equal(JSON.parse(response.body).error, 'Invalid video ID.');
  }
  assert.equal(fetches, 0);
});

test('requires same-origin JSON before invoking an AI provider', async t => {
  const { send, origin } = await readerFor(t);
  let providerCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    providerCalls += 1;
    return Response.json({ output_text: 'Synthetic summary' });
  });
  const body = JSON.stringify({ provider: 'openai', apiKey: 'synthetic-audit-key', transcript: 'Synthetic transcript' });
  assert.equal((await send('/api/summarize')).status, 405);
  for (const headers of [
    { origin: 'https://attacker.example', 'content-type': 'text/plain' },
    { 'content-type': 'application/json' },
    { origin, 'content-type': 'text/plain' },
  ]) {
    assert.equal((await send('/api/summarize', { method: 'POST', headers, body })).status, 403);
  }
  assert.equal(providerCalls, 0);
  const response = await send('/api/summarize', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body });
  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
});

test('serves the local reader and YouTube metadata without a login', async t => {
  const { send } = await readerFor(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    calls.push({ url: String(input), options });
    return Response.json({ title: 'Example video', author_name: 'Example channel' });
  });
  const page = await send('/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['www-authenticate'], undefined);
  const response = await send('/api/video?source=https%3A%2F%2Fyoutu.be%2Fabcdefghijk');
  assert.equal(response.status, 200);
  assert.equal(response.headers['www-authenticate'], undefined);
  assert.deepEqual(JSON.parse(response.body), {
    id: 'abcdefghijk', title: 'Example video', channel: 'Example channel',
    published: null, url: 'https://www.youtube.com/watch?v=abcdefghijk',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabcdefghijk&format=json');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('rejects network clients and accepts IPv4 and IPv6 loopback clients', () => {
  const req = {
    method: 'GET',
    url: '/api/video?source=abcdefghijk',
    headers: { host: '192.0.2.1:4173' },
    socket: { localAddress: '192.0.2.1', localPort: 4173, remoteAddress: '192.0.2.2' },
  };
  assert.equal(checkRequest(req).status, 403);
  req.headers.authorization = 'Bearer synthetic-test-credential';
  assert.equal(checkRequest(req).status, 403);
  for (const address of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    req.socket.remoteAddress = address;
    req.socket.localAddress = address;
    req.headers.host = address === '::1' ? '[::1]:4173' : '127.0.0.1:4173';
    assert.equal(checkRequest(req), null);
  }
});

test('limits active API work and accepts new work after requests finish', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { send } = await readerFor(t);
  let started;
  const allStarted = new Promise(resolve => { started = resolve; });
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches += 1;
    if (fetches === 4) started();
    if (fetches <= 4) await gate;
    return Response.json({ title: 'Example video', author_name: 'Example channel' });
  });
  const pending = Array.from({ length: 4 }, () => send('/api/video?source=abcdefghijk'));
  await allStarted;
  assert.equal((await send('/api/video?source=abcdefghijk')).status, 429);
  assert.equal(fetches, 4);
  release();
  assert.deepEqual((await Promise.all(pending)).map(response => response.status), [200, 200, 200, 200]);
  assert.equal((await send('/api/video?source=abcdefghijk')).status, 200);
});

test('rejects malformed request URLs without terminating the server', async t => {
  const { send } = await readerFor(t);
  assert.equal((await send('http://[')).status, 400);
  assert.equal((await send('/')).status, 200);
});
