import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('const escape ='), app.indexOf('const timestampSeconds')), context);
const formatDistillation = value => context.formatDistillation(value);

test('renders replacement tokens in AI list continuations as literal text', () => {
  const continuation = "$` $& $' $$";
  const lines = ['- Item', ...Array(16).fill(continuation)];
  assert.equal(formatDistillation(lines.join('\n')), `<ul><li>Item${` $\` $&amp; $&#39; $$`.repeat(16)}</li></ul>`);
});

test('escapes untrusted AI HTML while preserving supported formatting', () => {
  const input = [
    '# <script>alert(1)</script>',
    '**Bold** and `<img src=x onerror=alert(1)>`',
    '',
    '- <svg onload=alert(1)>',
    '<a href="javascript:alert(1)">link</a>',
    '',
    '```html',
    '</code><iframe srcdoc="<script>alert(1)</script>">',
    '```',
  ].join('\n');
  const html = formatDistillation(input);
  assert.doesNotMatch(html, /<(?:script|img|svg|a|iframe)\b/i);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<code>&lt;img src=x onerror=alert\(1\)&gt;<\/code>/);
  assert.match(html, /&lt;a href=&quot;javascript:alert\(1\)&quot;&gt;link&lt;\/a&gt;/);
  assert.match(html, /<pre class="code"><code>&lt;\/code&gt;&lt;iframe/);
});

function savedStateReader(values) {
  const stored = new Map(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
  const initial = new Map(stored);
  const context = vm.createContext({
    URL,
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
  });
  vm.runInContext(app.slice(app.indexOf('const timestampSeconds'), app.indexOf('async function fetchChannel')), context);
  const reader = vm.runInContext('({ storedDirectVideos, state, distillations, focusCleanups })', context);
  return { reader, stored, initial };
}

test('loads only saved YouTube videos and caches without changing legacy browser data', () => {
  const youtube = { id: 'abcdefghijk', title: 'Example video', channel: 'Example channel', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  const unsupported = { id: 'private:12345', provider: 'private', title: 'Private video', url: 'https://private.example/video/' };
  const summary = { summary: 'YouTube summary', date: '2026-09-14' };
  const cleanup = { lines: [{ id: 0, content: 'YouTube transcript.' }] };
  const { reader, stored, initial } = savedStateReader({
    'watchpaper-direct-videos': [unsupported, youtube, { ...youtube, id: 'malformed' }, { ...youtube, provider: 'private' }, { ...youtube, url: unsupported.url }],
    'watchpaper-read': [youtube.id, unsupported.id],
    'watchpaper-saved': [youtube.id, unsupported.id],
    'watchpaper-hidden': [unsupported.id],
    'watchpaper-distillations': { [youtube.id]: summary, [unsupported.id]: { summary: 'Private summary' } },
    'watchpaper-focus-cleanups-v1': { [youtube.id]: cleanup, [unsupported.id]: { lines: [{ content: 'Private transcript' }] } },
    'watchpaper-theme': 'dark',
    'watchpaper-reader-mode': 'focus',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(reader.storedDirectVideos())), [youtube]);
  assert.deepEqual([...reader.state('watchpaper-read')], [youtube.id]);
  assert.deepEqual([...reader.state('watchpaper-saved')], [youtube.id]);
  assert.deepEqual([...reader.state('watchpaper-hidden')], []);
  assert.deepEqual(JSON.parse(JSON.stringify(reader.distillations())), { [youtube.id]: summary });
  assert.deepEqual(JSON.parse(JSON.stringify(reader.focusCleanups())), { [youtube.id]: cleanup });
  assert.deepEqual(stored, initial);
});

test('saved YouTube items must use a matching HTTPS watch URL', () => {
  const video = { id: 'abcdefghijk', title: 'Example video', channel: 'Example channel' };
  const urls = [
    'https://www.youtube.com/watch?v=abcdefghijk',
    'https://youtube.com/watch?v=abcdefghijk',
    'https://m.youtube.com/watch?v=abcdefghijk',
    'http://www.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com/watch?v=lmnopqrstuv',
    'https://youtube.com.private.example/watch?v=abcdefghijk',
    'https://user:password@www.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com:8443/watch?v=abcdefghijk',
    'javascript:alert(1)',
  ];
  const { reader } = savedStateReader({ 'watchpaper-direct-videos': urls.map(url => ({ ...video, url })) });
  assert.deepEqual(Array.from(reader.storedDirectVideos(), video => video.url), urls.slice(0, 3));
});

test('renders YouTube playback with timestamp seeking and the required referrer policy', () => {
  const context = vm.createContext({
    videoOpen: true,
    videoStart: 12.9,
    selected: { id: 'abcdefghijk', title: 'Example video', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
  });
  vm.runInContext(app.slice(app.indexOf('const escape ='), app.indexOf('const timestampSeconds')), context);
  vm.runInContext(app.slice(app.indexOf('function videoPanelMarkup()'), app.indexOf('function renderReader()')), context);
  const html = context.videoPanelMarkup();
  assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk\?playsinline=1&rel=0&start=12"/);
  assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.match(html, />Open on YouTube<\/a>/);
  context.videoOpen = false;
  assert.equal(context.videoPanelMarkup(), '');
});
