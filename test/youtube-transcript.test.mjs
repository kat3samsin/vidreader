import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcript } from '../server.mjs';

const videoId = 'abcdefghijk';
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nWelcome back.\n\n00:00:08.000 --> 00:00:11.000\nThanks for watching.\n';
const expected = [
  { time: '00:00.000', content: 'Welcome back.' },
  { time: '00:08.000', content: 'Thanks for watching.' },
];

async function cacheFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vidreader-transcript-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('rejects unsupported video IDs before starting a caption download', async () => {
  for (const videoId of ['provider:123', 'https://videos.example/example-session', '../abcdefghijk']) {
    await assert.rejects(transcript(videoId, {
      execFileImpl: async () => assert.fail('Invalid video IDs must not start a download'),
    }), { message: 'Invalid video ID.' });
  }
});

test('reads usable English captions without contacting YouTube', async t => {
  const cacheDirectory = await cacheFor(t);
  await writeFile(join(cacheDirectory, `${videoId}.en-US.vtt`), 'WEBVTT\n\n');
  await writeFile(join(cacheDirectory, `${videoId}.en.vtt`), vtt);
  const lines = await transcript(videoId, {
    cacheDirectory,
    execFileImpl: async () => assert.fail('Cached captions must not trigger a download'),
  });
  assert.deepEqual(lines, expected);
});

test('keeps completed captions when a later subtitle variant gets a 429', async t => {
  const cacheDirectory = await cacheFor(t);
  const lines = await transcript(videoId, {
    cacheDirectory,
    execFileImpl: async () => {
      await writeFile(join(cacheDirectory, `${videoId}.en-US.vtt`), vtt);
      throw new Error("Unable to download video subtitles for 'en-en-US': HTTP Error 429: Too Many Requests");
    },
  });
  assert.deepEqual(lines, expected);
});

test('downloads captions when cached files are empty, unfinished, or for a different language or video', async t => {
  const cacheDirectory = await cacheFor(t);
  for (const [name, content] of [
    [`${videoId}.en-US.vtt`, ''],
    [`${videoId}.en.vtt.part`, vtt],
    [`${videoId}.fr.vtt`, vtt],
    ['aaaaaaaaaaa.en.vtt', vtt],
  ]) await writeFile(join(cacheDirectory, name), content);
  let downloads = 0;
  const lines = await transcript(videoId, {
    cacheDirectory,
    execFileImpl: async () => {
      downloads++;
      await writeFile(join(cacheDirectory, `${videoId}.en-orig.vtt`), vtt);
    },
  });
  assert.equal(downloads, 1);
  assert.deepEqual(lines, expected);
});

test('reports a caption rate limit when no usable file was downloaded', async t => {
  const cacheDirectory = await cacheFor(t);
  await assert.rejects(transcript(videoId, {
    cacheDirectory,
    execFileImpl: async () => {
      throw Object.assign(new Error('Command failed: /private/yt-dlp'), { stderr: 'HTTP Error 429: Too Many Requests' });
    },
  }), { message: 'YouTube is temporarily limiting caption downloads. Try again later.' });
});

test('distinguishes a failed download from missing English captions', async t => {
  const cacheDirectory = await cacheFor(t);
  await assert.rejects(transcript(videoId, {
    cacheDirectory,
    execFileImpl: async () => { throw new Error('Command failed: /private/yt-dlp'); },
  }), { message: 'Could not download captions from YouTube. Try again later.' });
  await assert.rejects(transcript(videoId, {
    cacheDirectory,
    execFileImpl: async () => {},
  }), { message: 'No English captions are available for this video.' });
});

test('downloads original English without requesting the rate-limited translation', async t => {
  const cacheDirectory = await cacheFor(t);
  let downloads = 0;
  const lines = await transcript(videoId, {
    cacheDirectory,
    execFileImpl: async (_file, args) => {
      downloads++;
      if (args[args.indexOf('--sub-langs') + 1] !== 'en.*-orig') {
        throw new Error('HTTP Error 429: Too Many Requests');
      }
      await writeFile(join(cacheDirectory, `${videoId}.en-orig.vtt`), vtt);
    },
  });
  assert.equal(downloads, 1);
  assert.deepEqual(lines, expected);
});

test('uses uploaded regional English subtitles when original auto captions are absent', async t => {
  const cacheDirectory = await cacheFor(t);
  let downloads = 0;
  const lines = await transcript(videoId, {
    cacheDirectory,
    execFileImpl: async (_file, args) => {
      downloads++;
      if (!args.includes('--write-subs')) return;
      assert.ok(!args.includes('--write-auto-subs'));
      await writeFile(join(cacheDirectory, `${videoId}.en-GB.vtt`), vtt);
    },
  });
  assert.equal(downloads, 2);
  assert.deepEqual(lines, expected);
});

test('waits before requesting one English translation when native English tracks are absent', async t => {
  const cacheDirectory = await cacheFor(t);
  let downloads = 0;
  const lines = await transcript(videoId, {
    cacheDirectory,
    execFileImpl: async (_file, args, options) => {
      downloads++;
      if (downloads < 3) return;
      assert.equal(args[args.indexOf('--sub-langs') + 1], 'en');
      assert.equal(args[args.indexOf('--sleep-subtitles') + 1], '60');
      assert.ok(options.timeout > 60_000);
      await writeFile(join(cacheDirectory, `${videoId}.en.vtt`), vtt);
    },
  });
  assert.equal(downloads, 3);
  assert.deepEqual(lines, expected);
});
