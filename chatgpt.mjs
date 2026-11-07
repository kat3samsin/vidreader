import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createChatGPT } from '@siwc/local';

// The SDK encrypts its private local files; the encryption key stays in the OS vault.
export function credentialEncryption(entryFor) {
  let keyPromise;
  const key = (create = false) => keyPromise ??= (async () => {
    const entry = await entryFor();
    let saved = await entry.getPassword();
    if (saved === null && !create) throw new Error('The credential encryption key is missing.');
    if (saved === null) {
      saved = randomBytes(32).toString('base64');
      await entry.setPassword(saved);
    }
    const bytes = Buffer.from(saved, 'base64');
    if (bytes.length !== 32) throw new Error('Invalid credential encryption key.');
    return bytes;
  })().catch(error => { keyPromise = undefined; throw error; });
  return {
    id: 'vidreader-os-vault-v1',
    async isAvailable() { try { await (await entryFor()).getPassword(); return true; } catch { return false; } },
    async encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', await key(true), iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    async decrypt(ciphertext) {
      const data = Buffer.from(ciphertext);
      const decipher = createDecipheriv('aes-256-gcm', await key(), data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

export function createChatGPTConnection(client) {
  const session = async () => {
    const value = await client.getSession();
    return {
      status: value.status,
      sharing: value.sharing,
      name: value.identity?.name || value.identity?.email || '',
      ...(value.error ? { error: value.error.message } : {}),
    };
  };
  return {
    session,
    async signIn(signal) { await client.signIn({ signal }); return session(); },
    cancel() { client.cancelSignIn(); },
    async disconnect() { await client.disconnect(); return session(); },
    async models(signal) {
      const value = await session();
      if (!value.sharing) return [];
      return (await client.listModels({ signal })).map(({ slug, displayName }) => ({ id: slug, name: displayName }));
    },
    async generate({ model, instructions, input, signal }) {
      const models = await this.models(signal);
      const selected = model || models[0]?.id;
      if (!selected || !models.some(item => item.id === selected)) throw new Error('Sign in with ChatGPT, enable plan usage, and choose an available model.');
      const result = await client.streamResponse({ model: selected, instructions, input, signal });
      if (!result.text.trim()) throw new Error('ChatGPT returned no text. Try again.');
      return result.text;
    },
  };
}

let client;
export const chatgptConnection = createChatGPTConnection({
  async getSession() { return (await runtime()).getSession(); },
  async signIn(options) { return (await runtime()).signIn(options); },
  cancelSignIn() { client?.cancelSignIn(); },
  async disconnect() { return (await runtime()).disconnect(); },
  async listModels(options) { return (await runtime()).listModels(options); },
  async streamResponse(options) { return (await runtime()).streamResponse(options); },
});
async function runtime() {
  client ??= createChatGPT({
    appName: 'VidReader', appId: 'vidreader', redirectPort: 0, sendHostId: true,
    credentialEncryption: credentialEncryption(async () => {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return new AsyncEntry('VidReader', 'chatgpt-encryption-key', { linux: { store: 'secret-service' } });
    }),
  });
  return client;
}
