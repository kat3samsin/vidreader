import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialEncryption, createChatGPTConnection } from '../chatgpt.mjs';
import { createReaderServer } from '../server.mjs';

// Synthetic vault only; tests never read or write OS credentials.
test('encrypts credentials across restarts and rejects tampering or a missing vault key', async () => {
  let password = null;
  const entry = { async getPassword() { return password; }, async setPassword(value) { password = value; } };
  const first = credentialEncryption(async () => entry);
  const encrypted = await first.encrypt('synthetic-access-token');
  assert.ok(!Buffer.from(encrypted).includes(Buffer.from('synthetic-access-token')));
  const restarted = credentialEncryption(async () => entry);
  assert.equal(await restarted.decrypt(encrypted), 'synthetic-access-token');
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] ^= 1;
  await assert.rejects(restarted.decrypt(damaged));
  password = null;
  await assert.rejects(credentialEncryption(async () => entry).decrypt(encrypted));
  assert.equal(password, null, 'reading existing credentials cannot replace a missing key');
  assert.equal(await credentialEncryption(async () => { throw new Error('Locked'); }).isAvailable(), false);
});

test('returns only account display state and blocks generation without plan permission', async () => {
  let sharing = false;
  let calls = 0;
  const connection = createChatGPTConnection({
    async getSession() { return { status: 'connected', sharing, identity: { name: 'Reader' }, accessToken: 'synthetic-secret' }; },
    async listModels() { return [{ slug: 'available-model', displayName: 'Available model' }]; },
    async streamResponse(options) { calls++; assert.equal(options.model, 'available-model'); return { text: 'Summary' }; },
  });
  assert.deepEqual(await connection.session(), { status: 'connected', sharing: false, name: 'Reader' });
  await assert.rejects(connection.generate({ input: 'Example' }));
  assert.equal(calls, 0);
  sharing = true;
  await assert.rejects(connection.generate({ model: 'unavailable-model', input: 'Example' }));
  assert.equal(calls, 0);
  assert.equal(await connection.generate({ input: 'Example' }), 'Summary');
});

test('sign-in routes require same-origin JSON and cancel when the caller disconnects', { timeout: 5000 }, async t => {
  let signIns = 0;
  let cancelled;
  const cancellation = new Promise(resolve => { cancelled = resolve; });
  const server = createReaderServer({ chatgpt: {
    async session() { return { status: 'disconnected', sharing: false, name: '' }; },
    async signIn(signal) {
      signIns++;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled(); reject(new Error('Cancelled')); }, { once: true }));
    },
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/chatgpt/sign-in`)).status, 405);
  assert.equal((await fetch(`${origin}/api/chatgpt/sign-in`, { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal(signIns, 0);
  const controller = new AbortController();
  const request = fetch(`${origin}/api/chatgpt/sign-in`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}', signal: controller.signal }).catch(() => {});
  while (!signIns) await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await request;
  await cancellation;
  const response = await fetch(`${origin}/api/chatgpt/session`);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await response.json(), { status: 'disconnected', sharing: false, name: '' });
});
