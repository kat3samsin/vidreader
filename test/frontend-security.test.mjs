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
    videoExpanded: false,
    location: { origin: 'http://127.0.0.1:4173' },
    videoStart: 12.9,
    selected: { id: 'abcdefghijk', title: 'Example video', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
  });
  vm.runInContext(app.slice(app.indexOf('const escape ='), app.indexOf('const timestampSeconds')), context);
  vm.runInContext(app.slice(app.indexOf('function videoPanelMarkup()'), app.indexOf('function renderReader()')), context);
  const html = context.videoPanelMarkup();
  assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk\?playsinline=1&rel=0&enablejsapi=1&origin=http%3A%2F%2F127\.0\.0\.1%3A4173&start=12"/);
  assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.match(html, /aria-label="Open on YouTube"/);
  context.videoOpen = false;
  assert.equal(context.videoPanelMarkup(), '');
});

test('keeps API keys with their provider when saving settings and using either AI action', async () => {
  const localValues = new Map([['watchpaper-summary-provider', 'openai']]);
  const sessionValues = new Map([['watchpaper-summary-key', 'synthetic-legacy-key']]);
  const storage = values => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', hidden: false, setAttribute() {} });
    return nodes.get(selector);
  };
  const requests = [];
  const lines = [{ id: 0, content: 'Synthetic transcript.' }];
  const context = vm.createContext({
    document: { querySelector: node }, localStorage: storage(localValues), sessionStorage: storage(sessionValues),
    summaryDialog: { showModal() {}, querySelector() { return null; } }, syncReadingSettings() {},
    selected: { id: 'abcdefghijk' }, transcript: lines, focusCleanupVersion: 4, focusCleanupRequest: 0,
    focusCleanupState: { videoId: null }, focusSourceLines: () => lines, focusFingerprint: () => 'synthetic-fingerprint',
    renderModeContent() {}, refreshReader() {}, saveDistillation() {}, saveFocusCleanup() {},
    fetch: async (url, options) => {
      requests.push({ url, ...JSON.parse(options.body) });
      return { ok: true, json: async () => ({ summary: 'Synthetic summary.', lines, cleanupVersion: 4 }) };
    },
  });
  vm.runInContext(app.slice(app.indexOf('const summaryModels ='), app.indexOf('const videoForm =')), context);
  const save = () => node('#save-summary-settings').onclick();
  const choose = provider => {
    node('#summary-provider').value = provider;
    node('#summary-provider').onchange({ target: node('#summary-provider') });
  };
  const useBothActions = async () => {
    await context.summarizeVideo();
    await context.cleanFocusTranscript();
  };

  context.openSummarySettings();
  assert.equal(node('#summary-key').value, '');
  await useBothActions();
  assert.equal(requests.length, 0, 'an old key without a recorded owner is never sent');

  node('#summary-key').value = 'synthetic-openai-key';
  save();
  await useBothActions();
  assert.deepEqual(requests.map(({ provider, apiKey }) => ({ provider, apiKey })), [
    { provider: 'openai', apiKey: 'synthetic-openai-key' },
    { provider: 'openai', apiKey: 'synthetic-openai-key' },
  ]);

  choose('anthropic');
  assert.equal(node('#summary-key').value, '');
  save();
  await useBothActions();
  assert.equal(requests.length, 2, 'switching providers cannot reuse the previous provider key');

  node('#summary-key').value = 'synthetic-anthropic-key';
  save();
  await useBothActions();
  assert.deepEqual(requests.slice(2).map(({ provider, apiKey }) => ({ provider, apiKey })), [
    { provider: 'anthropic', apiKey: 'synthetic-anthropic-key' },
    { provider: 'anthropic', apiKey: 'synthetic-anthropic-key' },
  ]);
  choose('openai');
  assert.equal(node('#summary-key').value, 'synthetic-openai-key');
  choose('codex');
  assert.equal(node('#summary-key').value, '');
  save();
  await useBothActions();
  assert.ok(requests.slice(4).every(({ provider, apiKey }) => provider === 'codex' && apiKey === ''));
  assert.ok([...localValues.values()].every(value => !value.includes('synthetic-')), 'keys stay out of localStorage');
});

test('escapes ChatGPT model labels and selects an available model instead of a stale provider model', () => {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', hidden: false, setAttribute() {} });
    return nodes.get(selector);
  };
  const context = vm.createContext({ document: { querySelector: node } });
  const escapeStart = app.indexOf('const escape =');
  vm.runInContext(app.slice(escapeStart, app.indexOf('\n', escapeStart)), context);
  vm.runInContext(app.slice(app.indexOf('const summaryModels ='), app.indexOf('function storedApiKey')), context);
  vm.runInContext(`summaryModels.chatgpt = [['available-model', '<img src=x onerror=alert(1)>']]; renderModelOptions('chatgpt', 'old-provider-model');`, context);
  assert.equal(node('#summary-model').value, 'available-model');
  assert.ok(!node('#summary-model').innerHTML.includes('<img'));
  assert.ok(node('#summary-model').innerHTML.includes('&lt;img'));
  assert.ok(!node('#summary-model').innerHTML.includes('value="custom"'));
});

test('timestamp clicks seek and play the existing iframe without rebuilding it', async () => {
  const frame = { isConnected: true };
  const calls = [];
  let players = 0;
  const context = vm.createContext({
    window: { YT: { Player: function (target, { events }) {
      assert.equal(target, frame);
      players++;
      this.seekTo = (...args) => calls.push(['seek', ...args]);
      this.playVideo = () => calls.push(['play']);
      queueMicrotask(() => events.onReady({ target: this }));
    } } },
    document: { querySelector: selector => selector === '#video-frame' ? frame : null },
    videoOpen: true, videoStart: 0, videoSeekRequest: 0,
    dockedPlayer: undefined, dockedFrame: undefined, dockedPlayerReady: undefined,
    selected: { id: 'abcdefghijk' }, setTimeout, clearTimeout,
    refreshReader() { assert.fail('Seeking an open video must not rebuild its iframe'); },
  });
  vm.runInContext(app.slice(app.indexOf('function youtubeAPI()'), app.indexOf('function renderModeContent()')), context);
  await context.seekDockedVideo(12);
  await context.seekDockedVideo(30);
  assert.equal(players, 1);
  assert.deepEqual(calls, [['seek', 12, true], ['play'], ['seek', 30, true], ['play']]);
});

test('Focus paragraph timestamps follow their first source cue after paragraph splitting', () => {
  const context = vm.createContext({ transcript: [
    { content: ' ', time: '00:00.000' },
    { content: `${'First '.repeat(60)}sentence.`, time: '00:05.000' },
    { content: `${'Second '.repeat(60)}sentence.`, time: '00:40.000' },
  ] });
  vm.runInContext(app.slice(app.indexOf('function focusSourceLines()'), app.indexOf('function cachedFocusCleanup')), context);
  const paragraphs = context.focusParagraphs();
  assert.deepEqual(Array.from(paragraphs, p => p.time), ['00:05.000', '00:40.000']);
  const cleaned = context.focusParagraphs([
    { id: 0, text: 'A cleaned opening.', paragraphStart: true },
    { id: 1, text: 'A cleaned second paragraph.', paragraphStart: true },
  ]);
  assert.deepEqual(Array.from(cleaned, p => p.time), ['00:05.000', '00:40.000']);
});

test('loads the newest page for every channel instead of passing its array index as an offset', async () => {
  const offsets = [];
  const scope = vm.createContext({
    channels: [{ source: '@first' }, { source: '@second' }, { source: '@third' }],
    selected: { id: 'abcdefghijk' },
    videos: [],
    fetchChannel: async (channel, offset = 0) => {
      offsets.push(offset);
      return [{ id: channel.source }];
    },
    composeVideos() {}, render() {}, renderReader() {}, saveChannels() {},
  });
  vm.runInContext(app.slice(app.indexOf('async function loadChannels()'), app.indexOf('function filteredVideos()')), scope);
  await scope.loadChannels();
  assert.deepEqual(offsets, [0, 0, 0]);
  assert.equal(vm.runInContext('channelVideos.length', scope), 3);
});

test('remembers video size across selections, hiding the player, and reloads', () => {
  const stored = new Map();
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const node = { classList: { toggle() {} }, setAttribute() {}, scrollIntoView() {} };
  const scope = vm.createContext({
    localStorage,
    document: { querySelector: () => node },
    matchMedia: () => ({ matches: false }),
    reader: node,
    videoControlIcon: () => '',
    state: () => new Set(), saveState() {}, render() {}, renderReader() {},
    resetFocusCleanupState() {}, loadTranscript() {}, refreshReader() {},
  });
  const initial = app.slice(0, app.indexOf('const list ='));
  vm.runInContext(initial, scope);
  vm.runInContext(app.slice(app.indexOf('function toggleVideoSize()'), app.indexOf('function youtubeAPI()')), scope);
  vm.runInContext(app.slice(app.indexOf('function selectVideo('), app.indexOf('// Re-rendering replaces')), scope);
  scope.toggleVideoSize();
  assert.equal(stored.get('watchpaper-video-expanded'), '1');
  vm.runInContext("videos = [{ id: 'first' }, { id: 'second' }];", scope);
  scope.selectVideo('first');
  scope.selectVideo('second');
  scope.toggleVideoDock();
  scope.toggleVideoDock();
  assert.equal(vm.runInContext('videoExpanded', scope), true);
  const reloaded = vm.createContext({ localStorage });
  vm.runInContext(initial, reloaded);
  assert.equal(vm.runInContext('videoExpanded', reloaded), true);
  scope.toggleVideoSize();
  assert.equal(stored.get('watchpaper-video-expanded'), '0');
});

test('imports Takeout subscriptions with quoted names, BOM, duplicates, and canonical channel IDs', () => {
  const scope = vm.createContext({});
  vm.runInContext(app.slice(app.indexOf('function parseSubscriptionCsv('), app.indexOf('async function fetchChannel(')), scope);
  const first = 'UC1234567890123456789012';
  const second = 'UCabcdefghijklmnopqrstuv';
  const csv = `\uFEFFChannel Id,Channel Url,Channel Title\r\n${first},https://www.youtube.com/channel/${first},"A channel, with commas"\r\n${second},https://example.com,"A ""quoted""\nname"\r\n${first},ignored,Latest name\r\nnot-a-channel,https://attacker.example,Ignore me\r\n`;
  assert.deepEqual(JSON.parse(JSON.stringify(scope.parseSubscriptionCsv(csv))), [
    { source: first, channelId: first, name: 'Latest name' },
    { source: second, channelId: second, name: 'A "quoted"\nname' },
  ]);
  assert.throws(() => scope.parseSubscriptionCsv('Channel Id,Channel Url,Channel Title\n'), /No YouTube channels/);
  assert.throws(() => scope.parseSubscriptionCsv('"unfinished'), /unfinished quoted field/);
});

test('subscription import skips followed channels and saves new channels before fetching feeds', async () => {
  const existing = { source: 'UC1234567890123456789012', channelId: 'UC1234567890123456789012', name: 'Existing' };
  const added = { source: 'UCabcdefghijklmnopqrstuv', channelId: 'UCabcdefghijklmnopqrstuv', name: 'New' };
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, value: '', textContent: '', classList: { remove() {}, add() {} } });
    return nodes.get(id);
  };
  const events = [];
  const scope = vm.createContext({
    document: { querySelector: node },
    channels: [existing], loadingFeeds: false,
    channelKey: channel => channel.channelId,
    saveChannels() { events.push('saved'); },
    dialog: { close() { events.push('closed'); } },
    async loadChannels() { events.push('fetch'); },
  });
  vm.runInContext(app.slice(app.indexOf('const subscriptionFile ='), app.indexOf("channelInput.addEventListener('input'")), scope);
  vm.runInContext(`pendingSubscriptions = ${JSON.stringify([existing, added])};`, scope);
  await node('#import-subscriptions').onclick();
  assert.equal(scope.channels.length, 2);
  assert.equal(scope.channels[1].channelId, added.channelId);
  assert.deepEqual(events, ['saved', 'closed', 'fetch']);
});

test('finishing a distillation updates the text without rebuilding or stopping the player', async () => {
  const video = { id: 'abcdefghijk' };
  const nodes = { '#digest-copy': {}, '#summarize-video': {} };
  const saved = [];
  let textUpdates = 0;
  const scope = vm.createContext({
    selected: video,
    transcript: [{ time: '00:01', content: 'A transcript.' }],
    localStorage: { getItem: () => null },
    storedApiKey: () => '',
    document: { querySelector: selector => nodes[selector] },
    fetch: async () => ({ ok: true, json: async () => ({ summary: 'The finished summary.' }) }),
    saveDistillation: (id, summary) => saved.push({ id, summary }),
    renderModeContent() { textUpdates++; },
    refreshReader() { assert.fail('Finishing a summary must preserve the video player'); },
  });
  vm.runInContext(app.slice(app.indexOf('async function summarizeVideo()'), app.indexOf('async function cleanFocusTranscript()')), scope);
  await scope.summarizeVideo();
  assert.equal(textUpdates, 1);
  assert.deepEqual(saved, [{ id: video.id, summary: 'The finished summary.' }]);
});

test('renders Markdown tables with aligned headers and inline formatting between paragraphs', () => {
  const html = formatDistillation([
    'Before the table.',
    '',
    '| Event | Check I can attach |',
    '| :--- | ---: |',
    '| After a file edit | Run the **linter**. |',
    '| Before completion | Run `tests`. |',
    '',
    'After the table.',
  ].join('\n'));
  assert.match(html, /^<p>Before the table\.<\/p><div class="table-scroll"/);
  assert.match(html, /<th class="table-align-left" scope="col">Event<\/th>/);
  assert.match(html, /<th class="table-align-right" scope="col">Check I can attach<\/th>/);
  assert.match(html, /<td class="table-align-right">Run the <strong>linter<\/strong>\.<\/td>/);
  assert.match(html, /<code>tests<\/code>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.match(html, /<\/table><\/div><p>After the table\.<\/p>$/);
});

test('table cells handle escaped pipes and missing values without rendering untrusted HTML', () => {
  const html = formatDistillation('Name | Value\n:---: | ---\nA \\| B | <img src=x onerror=alert(1)>\nOnly one |');
  assert.match(html, /<th class="table-align-center" scope="col">Name<\/th>/);
  assert.match(html, /A \| B/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img\b/);
  assert.match(html, /<td class="table-align-left"><\/td>/);
  assert.doesNotMatch(formatDistillation('A | B\nordinary | prose'), /<table>/);
  assert.doesNotMatch(formatDistillation('```\nA | B\n--- | ---\n```'), /<table>/);
});
