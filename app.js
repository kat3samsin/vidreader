let videos = [];
let channelVideos = [];
let directVideos = [];
let channels = [];
let activeChannel = 'all';
let loadingFeeds = false;
let selected;
let activeFilter = 'all';
let transcript = [];
let transcriptRequest = 0;
let transcriptState = 'idle';
let transcriptError = '';
let focusCleanupRequest = 0;
let focusCleanupState = { videoId: null, status: 'idle', error: '' };
let videoStart = 0;
const savedReaderMode = localStorage.getItem('watchpaper-reader-mode');
let readerMode = ['distill', 'focus', 'raw'].includes(savedReaderMode) ? savedReaderMode : 'focus';
let videoOpen = localStorage.getItem('watchpaper-video-open') === '1';
let videoExpanded = localStorage.getItem('watchpaper-video-expanded') === '1';
let youtubeApiPromise;
let dockedPlayer;
let dockedFrame;
let dockedPlayerReady;
let videoSeekRequest = 0;
const list = document.querySelector('#video-list');
const reader = document.querySelector('#reader');
const channelLine = document.querySelector('#channel-line');
const rail = document.querySelector('#channel-rail');
const channelPicker = document.querySelector('#channel-picker');
const channelSearch = document.querySelector('#channel-search');
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function formatDistillation(value) {
  let output = '';
  let listType = null;
  let sectionOpen = false;
  let fence = null;
  let quote = [];
  let paragraph = [];
  let code = [];
  const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>');
  const closeList = () => { if (listType) { output += `</${listType}>`; listType = null; } };
  const closeParagraph = () => { if (paragraph.length) { output += `<p>${inline(paragraph.join(' '))}</p>`; paragraph = []; } };
  const closeQuote = () => { if (quote.length) { output += `<blockquote>${inline(quote.join(' '))}</blockquote>`; quote = []; } };
  const closeBlocks = () => { closeParagraph(); closeQuote(); closeList(); };
  const closeCode = () => { output += `<pre class="code"><code>${escape(code.join('\n'))}</code></pre>`; code = []; fence = null; };
  const tableCells = line => {
    const cells = [];
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\' && i + 1 < line.length) { cell += line[i] + line[++i]; continue; }
      if (line[i] === '|') { cells.push(cell); cell = ''; }
      else cell += line[i];
    }
    cells.push(cell);
    if (!cells[0].trim()) cells.shift();
    if (cells.length && !cells.at(-1).trim()) cells.pop();
    return cells.map(cell => cell.trim().replace(/\\\|/g, '|'));
  };
  const lines = value.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    const fenced = line.match(/^(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
    if (fence) {
      if (fenced && fenced[1][0] === fence[0] && fenced[1].length >= fence.length && !fenced[2]) closeCode();
      else code.push(rawLine);
      continue;
    }
    if (fenced) { closeBlocks(); fence = fenced[1]; code = []; continue; }
    if (!line) { closeBlocks(); continue; }
    const headers = line.includes('|') ? tableCells(line) : [];
    const separators = tableCells((lines[index + 1] || '').trim());
    if (headers.length && separators.length === headers.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
      closeBlocks();
      const alignments = separators.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
      const cells = (values, tag) => headers.map((_, column) => `<${tag} class="table-align-${alignments[column]}"${tag === 'th' ? ' scope="col"' : ''}>${inline(values[column] || '')}</${tag}>`).join('');
      output += `<div class="table-scroll" role="region" aria-label="Summary table" tabindex="0"><table><thead><tr>${cells(headers, 'th')}</tr></thead><tbody>`;
      index++;
      while (index + 1 < lines.length && lines[index + 1].trim().includes('|')) {
        output += `<tr>${cells(tableCells(lines[++index].trim()), 'td')}</tr>`;
      }
      output += '</tbody></table></div>';
      continue;
    }
    if (/^([-*_])\s*(\1\s*){2,}$/.test(line)) { closeBlocks(); output += '<hr />'; continue; }
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/) || line.match(/^\*\*(.+?)\*\*:?$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    const blockquote = line.match(/^>\s?(.*)$/);
    if (heading) {
      closeBlocks();
      if (sectionOpen) output += '</section>';
      output += `<section class="distillation-section"><h4>${inline(heading[1])}</h4>`;
      sectionOpen = true;
    } else if (ordered || bullet) {
      closeParagraph();
      closeQuote();
      const nextType = ordered ? 'ol' : 'ul';
      if (listType && listType !== nextType) closeList();
      if (!listType) { output += `<${nextType}>`; listType = nextType; }
      output += `<li>${inline((ordered || bullet)[1])}</li>`;
    } else if (blockquote) {
      closeParagraph();
      closeList();
      quote.push(blockquote[1]);
    } else if (listType) {
      output = output.replace(/<\/li>$/, () => ` ${inline(line)}</li>`);
    } else {
      closeQuote();
      paragraph.push(line);
    }
  }
  if (fence) closeCode();
  closeBlocks();
  return output + (sectionOpen ? '</section>' : '');
}
const timestampSeconds = time => Math.floor(time.split(':').reduce((total, value) => total * 60 + Number(value), 0));
const validVideoId = id => typeof id === 'string' && /^[\w-]{11}$/.test(id);
const state = key => new Set(JSON.parse(localStorage.getItem(key) || '[]').filter(validVideoId));
const saveState = (key, values) => localStorage.setItem(key, JSON.stringify([...values]));
function storedVideoMap(key) {
  const stored = JSON.parse(localStorage.getItem(key) || '{}');
  return Object.fromEntries(Object.entries(stored).filter(([id]) => validVideoId(id)));
}
const distillations = () => storedVideoMap('watchpaper-distillations');
function saveDistillation(id, summary) {
  const all = distillations();
  all[id] = { summary, date: new Date().toISOString() };
  const ids = Object.keys(all).sort((a, b) => new Date(all[a].date) - new Date(all[b].date));
  for (const stale of ids.slice(0, Math.max(0, ids.length - 50))) delete all[stale];
  try { localStorage.setItem('watchpaper-distillations', JSON.stringify(all)); } catch {}
}

const focusCleanupVersion = 4;
function focusCleanups() {
  try { return storedVideoMap('watchpaper-focus-cleanups-v1'); } catch { return {}; }
}
function saveFocusCleanup(id, lines, sourceFingerprint) {
  const all = focusCleanups();
  const saved = {
    lines,
    sourceFingerprint,
    cleanupVersion: focusCleanupVersion,
    provider: localStorage.getItem('watchpaper-summary-provider') || '',
    model: localStorage.getItem('watchpaper-summary-model') || '',
    date: new Date().toISOString(),
  };
  all[id] = saved;
  const ids = Object.keys(all).sort((a, b) => new Date(all[a].date) - new Date(all[b].date));
  for (const stale of ids.slice(0, Math.max(0, ids.length - 10))) delete all[stale];
  try {
    localStorage.setItem('watchpaper-focus-cleanups-v1', JSON.stringify(all));
    return saved;
  } catch {
    return null;
  }
}

function storedChannels() {
  const stored = JSON.parse(localStorage.getItem('watchpaper-channels') || 'null');
  if (stored) return stored;
  // Migrate the original single-channel key so existing readers keep their feed.
  const legacy = localStorage.getItem('watchpaper-channel');
  return legacy ? [{ source: legacy }] : [];
}
const saveChannels = () => localStorage.setItem('watchpaper-channels', JSON.stringify(channels.map(({ source, channelId, name }) => ({ source, channelId, name }))));
const channelKey = channel => channel.channelId || channel.source;
const saveDirectVideos = () => localStorage.setItem('watchpaper-direct-videos', JSON.stringify(directVideos));

function isYouTubeVideo(video) {
  if (!video || !validVideoId(video.id) || video.provider && video.provider !== 'youtube') return false;
  try {
    const url = new URL(video.url);
    return url.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
      && !url.username && !url.password && !url.port && url.pathname === '/watch' && url.searchParams.get('v') === video.id;
  } catch {
    return false;
  }
}

function storedDirectVideos() {
  return JSON.parse(localStorage.getItem('watchpaper-direct-videos') || '[]').filter(isYouTubeVideo);
}

function parseSubscriptionCsv(input) {
  const rows = [];
  let row = [], value = '', quoted = false;
  const source = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(value);
      value = '';
      if (char !== ',') {
        rows.push(row);
        row = [];
        if (char === '\r' && source[i + 1] === '\n') i++;
      }
    } else value += char;
  }
  if (quoted) throw new Error('This CSV has an unfinished quoted field. Export subscriptions.csv again.');
  if (value || row.length) { row.push(value); rows.push(row); }
  const channels = new Map();
  for (const fields of rows) {
    const id = fields[0]?.trim();
    if (!/^UC[\w-]{22}$/.test(id || '')) continue;
    channels.set(id, { source: id, channelId: id, name: fields[2]?.trim() || id });
  }
  if (!channels.size) throw new Error('No YouTube channels found. Choose subscriptions.csv from your Google Takeout export.');
  return [...channels.values()];
}

async function fetchChannel(channel, offset = 0) {
  const response = await fetch(`/api/channel?source=${encodeURIComponent(channel.source)}${offset ? `&offset=${offset}` : ''}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  channel.channelId = payload.channelId;
  channel.name = payload.videos[0]?.channel || channel.name || channel.source;
  channel.error = null;
  channel.hasMore = payload.hasMore;
  return payload.videos.map(video => ({ ...video, channelId: payload.channelId }));
}

const byNewest = (a, b) => new Date(b.published || b.addedAt || 0) - new Date(a.published || a.addedAt || 0);
function composeVideos() {
  const hidden = state('watchpaper-hidden');
  videos = [...new Map([...directVideos, ...channelVideos].map(video => [video.id, video])).values()]
    .filter(video => !hidden.has(video.id))
    .sort(byNewest);
}

async function loadChannels() {
  if (!channels.length) {
    channelVideos = [];
    composeVideos();
    render();
    if (!selected && videos[0]) selectVideo(videos[0].id, false);
    else renderReader();
    return;
  }
  loadingFeeds = true;
  render();
  const results = [];
  // Fetch one feed at a time so a large subscription import stays within API capacity.
  for (const channel of channels) {
    try { results.push({ status: 'fulfilled', value: await fetchChannel(channel) }); }
    catch (reason) { results.push({ status: 'rejected', reason }); }
  }
  loadingFeeds = false;
  channelVideos = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    channels[index].error = result.reason.message;
    return [];
  });
  composeVideos();
  saveChannels();
  render();
  if (!selected && videos[0]) selectVideo(videos[0].id, false);
  else renderReader();
}

function filteredVideos() {
  const read = state('watchpaper-read');
  const saved = state('watchpaper-saved');
  const query = document.querySelector('#search').value.toLowerCase();
  return videos.filter(video => (activeChannel === 'all' || video.channelId === activeChannel)
    && (activeFilter === 'all' || activeFilter === 'unread' && !read.has(video.id) || activeFilter === 'saved' && saved.has(video.id))
    && `${video.title} ${video.channel}`.toLowerCase().includes(query));
}

function updateFilters() {
  const read = state('watchpaper-read');
  const saved = state('watchpaper-saved');
  const scope = videos.filter(video => activeChannel === 'all' || video.channelId === activeChannel);
  const counts = { all: scope.length, unread: scope.filter(video => !read.has(video.id)).length, saved: scope.filter(video => saved.has(video.id)).length };
  document.querySelectorAll('.filter').forEach(button => {
    const filter = button.dataset.filter;
    button.classList.toggle('is-active', filter === activeFilter);
    button.querySelector('span').textContent = counts[filter];
  });
}

function renderChannels() {
  const read = state('watchpaper-read');
  const query = channelSearch.value.trim().toLowerCase();
  const unreadIn = id => videos.filter(video => (id === 'all' || video.channelId === id) && !read.has(video.id)).length;
  const row = (key, label, badge, isError) => `<button class="channel${key === activeChannel ? ' is-active' : ''}${isError ? ' is-error' : ''}" data-channel="${escape(key)}"><span class="channel-name">${escape(label)}</span><span>${escape(badge)}</span></button>`;
  const visibleChannels = channels.filter(channel => `${channel.name || ''} ${channel.source}`.toLowerCase().includes(query));
  const active = channels.find(channel => channelKey(channel) === activeChannel);
  document.querySelector('#channel-picker-value').textContent = active?.name || active?.source || 'All channels';
  rail.innerHTML = (query ? '' : row('all', 'All channels', channels.length ? String(unreadIn('all')) : '—'))
    + visibleChannels.map(channel => row(channelKey(channel), channel.name || channel.source, channel.error ? 'error' : channel.channelId ? String(unreadIn(channel.channelId)) : '…', Boolean(channel.error))).join('')
    + (query && !visibleChannels.length ? '<p class="channel-empty">No channels match.</p>' : '');
  rail.querySelectorAll('.channel').forEach(button => button.onclick = () => {
    activeChannel = button.dataset.channel;
    channelPicker.open = false;
    channelSearch.value = '';
    render();
  });
}

function renderChannelLine(visibleCount) {
  const channel = channels.find(entry => channelKey(entry) === activeChannel);
  const total = videos.filter(video => activeChannel === 'all' || video.channelId === activeChannel).length;
  const countLine = `${visibleCount} of ${total}`;
  if (channel) {
    channelLine.innerHTML = `<span class="meta${channel.error ? ' is-error' : ''}">${escape(channel.error || countLine)}</span><button id="remove-channel" type="button">Remove channel</button>`;
    document.querySelector('#remove-channel').onclick = () => removeChannel(channel);
    return;
  }
  channelLine.innerHTML = `<span class="meta">${escape(countLine)}</span>`;
}

function loadMoreControl() {
  const query = document.querySelector('#search').value.trim();
  const channel = channels.find(entry => channelKey(entry) === activeChannel);
  if (!channel || activeFilter !== 'all' || query || !channel.hasMore && !channel.loadingMore && !channel.loadMoreError) return '';
  if (channel.loadMoreError) return `<div class="load-more-status" role="status"><span>${escape(channel.loadMoreError)}</span><button id="load-more" type="button">Try again</button></div>`;
  return `<button class="load-more" id="load-more" type="button"${channel.loadingMore ? ' disabled aria-busy="true"' : ''}>${channel.loadingMore ? 'Loading more videos…' : 'Load 10 more videos'}</button>`;
}

function emptyList() {
  const query = document.querySelector('#search').value.trim();
  if (loadingFeeds) return '<p class="list-empty"><strong>Loading channels…</strong>Fetching the latest videos from each feed.</p>';
  if (query) return `<p class="list-empty"><strong>No titles match “${escape(query)}”.</strong>Search covers titles and channel names, not transcript text.</p>`;
  if (!videos.length) return '<p class="list-empty"><strong>No videos yet.</strong>Paste a video link or add a channel to fill this index.</p>';
  if (activeFilter === 'unread') return '<p class="list-empty"><strong>Nothing unread.</strong>You have read everything in the current feed.</p>';
  if (activeFilter === 'saved') return '<p class="list-empty"><strong>Nothing saved.</strong>Save a video from the reader to keep it here.</p>';
  return '<p class="list-empty"><strong>Nothing in this view.</strong></p>';
}

function render() {
  updateFilters();
  renderChannels();
  const read = state('watchpaper-read');
  const visible = filteredVideos();
  renderChannelLine(visible.length);
  const unreadCount = videos.filter(video => !read.has(video.id)).length;
  document.querySelector('#queue-drawer-count').textContent = `${unreadCount} unread`;
  list.innerHTML = (visible.map(video => {
    const unread = !read.has(video.id);
    const active = video.id === selected?.id;
    const date = video.published
      ? new Date(video.published).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : video.addedAt
        ? `added ${new Date(video.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        : 'date unavailable';
    const thumbnail = `<img src="https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg" alt="" width="88" height="50" loading="lazy" />`;
    const status = active
      ? '<span class="entry-reading">reading</span>'
      : unread
        ? '<span class="entry-status is-unread" aria-hidden="true"></span><span class="visually-hidden">Unread. </span>'
        : '';
    return `<button class="entry${active ? ' is-active' : ''}" data-id="${escape(video.id)}"${active ? ' aria-current="true"' : ''}><span class="entry-thumb">${thumbnail}</span><span class="entry-body"><span class="entry-title">${escape(video.title)}</span><span class="meta">${status}${escape(video.channel)} · ${date}</span></span></button>`;
  }).join('') || emptyList()) + loadMoreControl();
  list.querySelectorAll('.entry').forEach(button => button.onclick = () => selectVideo(button.dataset.id));
  list.querySelectorAll('.entry-thumb img').forEach(image => image.addEventListener('error', () => { image.hidden = true; }, { once: true }));
  const loadMore = document.querySelector('#load-more');
  if (loadMore) loadMore.onclick = () => loadMoreVideos(channels.find(entry => channelKey(entry) === activeChannel));
}

function readerDate(video) {
  if (video.published) return new Date(video.published).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (video.addedAt) return `added ${new Date(video.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return 'date unavailable';
}

function focusSourceLines() {
  return transcript
    .map(line => ({
      content: line.content.normalize('NFC').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim(),
      speaker: line.speaker === true,
      time: typeof line.time === 'string' ? line.time : '',
    }))
    .filter(line => line.content)
    .map((line, id) => ({ id, content: line.content, time: line.time, ...(line.speaker ? { speaker: true } : {}) }));
}

function focusFingerprint(lines) {
  let hash = 2166136261;
  const source = lines.map(line => `${line.id}:${line.speaker === true ? 'speaker:' : ''}${line.content}`).join('\n');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v${focusCleanupVersion}:${lines.length}:${(hash >>> 0).toString(16)}`;
}

function paragraphizeFocusText(value) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const sentences = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)].map(part => part.segment.trim()).filter(Boolean)
    : (text.match(/[^.!?]+(?:[.!?]+[”’"']?|$)/g) || [text]).map(sentence => sentence.trim()).filter(Boolean);
  const paragraphs = [];
  let paragraph = '';
  for (const sentence of sentences) {
    const candidate = `${paragraph}${paragraph ? ' ' : ''}${sentence}`;
    if (paragraph && paragraph.length >= 320 && candidate.length > 560) {
      paragraphs.push(paragraph);
      paragraph = sentence;
    } else {
      paragraph = candidate;
    }
  }
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs;
}

function focusParagraphs(lines = focusSourceLines()) {
  const sources = new Map(focusSourceLines().map(line => [line.id, line]));
  const blocks = [];
  let block = { text: '', cues: [] };
  const flush = () => { if (block.text) blocks.push(block); block = { text: '', cues: [] }; };
  for (const line of lines) {
    const text = String(line.text ?? line.content ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const speakerChange = line.speaker === true || /^(?:>>|[\p{L}\p{M}][\p{L}\p{M}\p{N} .&'’()\-]{0,60}:)\s/u.test(text);
    if (block.text && (line.paragraphStart || speakerChange)) flush();
    if (/^\[[^\]]{1,80}\]$/.test(text)) {
      flush();
      blocks.push({ text, cues: [{ start: 0, id: line.id }] });
      continue;
    }
    const separator = block.text ? ' ' : '';
    block.cues.push({ start: block.text.length + separator.length, id: line.id });
    block.text += separator + text;
  }
  flush();
  return blocks.flatMap(block => {
    let offset = 0;
    let cue = 0;
    return paragraphizeFocusText(block.text).map(text => {
      while (cue + 1 < block.cues.length && block.cues[cue + 1].start <= offset) cue++;
      const time = sources.get(block.cues[cue].id)?.time || '';
      offset += text.length + 1;
      return { text, time };
    });
  });
}

function timestampButton(value) {
  const time = typeof value === 'string' ? value.replace(/\.\d+$/, '') : '';
  if (!time) return '';
  return `<button class="timestamp" type="button" data-seek="${timestampSeconds(value)}" aria-label="Jump video to ${escape(time)}">${escape(time)}</button>`;
}

function cachedFocusCleanup(videoId, sourceFingerprint) {
  const cached = focusCleanups()[videoId];
  if (!cached || cached.cleanupVersion !== focusCleanupVersion || cached.sourceFingerprint !== sourceFingerprint || !Array.isArray(cached.lines)) return null;
  return cached;
}

function resetFocusCleanupState() {
  focusCleanupRequest += 1;
  focusCleanupState = { videoId: null, status: 'idle', error: '' };
}

function videoPanelMarkup() {
  if (!videoOpen) return '';
  const start = videoStart ? `&start=${Math.floor(videoStart)}` : '';
  const source = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(selected.id)}?playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${start}`;
  return `<aside class="video-dock" aria-label="Video player"><div class="video-card"><div class="video-frame"><iframe id="video-frame" src="${source}" title="${escape(`Video: ${selected.title}`)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div><div class="video-toolbar"><a href="${escape(selected.url)}" target="_blank" rel="noreferrer" aria-label="Open on YouTube" title="Open on YouTube">${videoControlIcon('open')}</a><button id="resize-video" type="button" aria-pressed="${videoExpanded}" aria-label="${videoExpanded ? 'Small preview' : 'Enlarge video'}" title="${videoExpanded ? 'Small preview' : 'Enlarge video'}">${videoControlIcon(videoExpanded ? 'shrink' : 'expand')}</button><button id="hide-video" type="button" aria-label="Hide video" title="Hide video">${videoControlIcon('hide')}</button></div></div><p class="video-hint" role="status" hidden></p></aside>`;
}

function videoControlIcon(name) {
  const paths = {
    open: '<path d="M15 3h6v6M10 14 21 3"/><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    shrink: '<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
    hide: '<path d="m6 6 12 12M6 18 18 6"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
    videoOff: '<path d="m3 3 18 18M10 5h9a2 2 0 0 1 2 2v10M17 19H5a2 2 0 0 1-2-2V7"/>',
    save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    saved: '<path fill="currentColor" d="M6 3h12v18l-6-4-6 4z"/>',
    remove: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  };
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function renderReader() {
  dockedPlayer?.destroy();
  dockedPlayer = dockedFrame = dockedPlayerReady = undefined;
  document.body.classList.toggle('is-reading', Boolean(selected));
  if (!selected) {
    reader.innerHTML = '<div class="reader-empty"><h2>Nothing open yet.</h2><p>Pick a video from your queue, or paste a YouTube link above to start reading.</p></div>';
    return;
  }
  const saved = state('watchpaper-saved').has(selected.id);
  const modes = ['distill', 'focus', 'raw'];
  const labels = { distill: 'Distill', focus: 'Focus', raw: 'Raw' };
  const modeButtons = modes.map(mode => `<button id="mode-${mode}" class="mode-option${readerMode === mode ? ' is-active' : ''}" type="button" role="tab" aria-selected="${readerMode === mode}" aria-controls="reader-mode-content" tabindex="${readerMode === mode ? '0' : '-1'}" data-mode="${mode}">${labels[mode]}</button>`).join('');
  const open = videoOpen;
  const sourceAction = `<button id="toggle-video" class="reader-control is-accent" type="button" aria-pressed="${open}" aria-label="${open ? 'Hide video' : 'Show video'}" title="${open ? 'Hide video' : 'Show video'}">${videoControlIcon(open ? 'videoOff' : 'video')}</button>`;
  reader.innerHTML = `<header class="reader-head"><p class="reader-kicker">${escape(selected.channel)} · ${escape(readerDate(selected))}</p><h2>${escape(selected.title)}</h2><div class="reader-actions"><div class="mode-switch" role="tablist" aria-label="Reading mode">${modeButtons}</div><div class="reader-tools" role="group" aria-label="Reading actions">${sourceAction}<button id="save-video" class="reader-control is-primary" type="button" aria-pressed="${saved}" aria-label="${saved ? 'Remove from saved' : 'Save for later'}" title="${saved ? 'Remove from saved' : 'Save for later'}">${videoControlIcon(saved ? 'saved' : 'save')}</button><button id="remove-video" class="reader-control" type="button" aria-label="Remove from queue" title="Remove from queue">${videoControlIcon('remove')}</button></div></div></header><div class="reader-content${videoExpanded ? ' is-video-expanded' : ''}"><div class="reader-copy" id="reader-mode-content" role="tabpanel" tabindex="0" aria-labelledby="mode-${readerMode}"></div>${videoPanelMarkup()}</div>`;
  document.querySelectorAll('.mode-option').forEach(button => {
    button.onclick = () => setReaderMode(button.dataset.mode);
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = modes.indexOf(button.dataset.mode);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length;
      setReaderMode(modes[next]);
    };
  });
  const toggleVideo = document.querySelector('#toggle-video');
  if (toggleVideo) toggleVideo.onclick = toggleVideoDock;
  document.querySelector('#save-video').onclick = toggleSaved;
  document.querySelector('#remove-video').onclick = removeVideo;
  const hideVideo = document.querySelector('#hide-video');
  if (hideVideo) hideVideo.onclick = toggleVideoDock;
  const resizeVideo = document.querySelector('#resize-video');
  if (resizeVideo) resizeVideo.onclick = toggleVideoSize;
  renderModeContent();
}

function setReaderMode(mode) {
  if (!['distill', 'focus', 'raw'].includes(mode) || mode === readerMode) return;
  readerMode = mode;
  localStorage.setItem('watchpaper-reader-mode', mode);
  refreshReader();
  document.querySelector(`#mode-${mode}`)?.focus({ preventScroll: true });
}

function toggleVideoSize() {
  videoExpanded = !videoExpanded;
  localStorage.setItem('watchpaper-video-expanded', videoExpanded ? '1' : '0');
  document.querySelector('.reader-content').classList.toggle('is-video-expanded', videoExpanded);
  const button = document.querySelector('#resize-video');
  button.innerHTML = videoControlIcon(videoExpanded ? 'shrink' : 'expand');
  button.setAttribute('aria-label', videoExpanded ? 'Small preview' : 'Enlarge video');
  button.title = videoExpanded ? 'Small preview' : 'Enlarge video';
  button.setAttribute('aria-pressed', String(videoExpanded));
}

function toggleVideoDock() {
  videoOpen = !videoOpen;
  if (!videoOpen) videoStart = 0;
  localStorage.setItem('watchpaper-video-open', videoOpen ? '1' : '0');
  refreshReader();
}

function youtubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  youtubeApiPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('YouTube did not respond.')); }, 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(window.YT); };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('YouTube could not be loaded.')); };
    document.head.append(script);
  }).catch(error => { youtubeApiPromise = undefined; throw error; });
  return youtubeApiPromise;
}

async function readyVideoPlayer(frame) {
  const api = await youtubeAPI();
  if (!frame.isConnected) throw new Error('The video changed.');
  if (frame === dockedFrame && dockedPlayerReady) return dockedPlayerReady;
  dockedFrame = frame;
  dockedPlayerReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The player did not respond.')), 15000);
    dockedPlayer = new api.Player(frame, { events: {
      onReady: event => { clearTimeout(timer); resolve(event.target); },
      onError: () => { clearTimeout(timer); reject(new Error('The video is unavailable.')); },
    } });
  });
  return dockedPlayerReady;
}

async function seekDockedVideo(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const request = ++videoSeekRequest;
  const videoId = selected.id;
  videoStart = seconds;
  if (!videoOpen) {
    videoOpen = true;
    localStorage.setItem('watchpaper-video-open', '1');
    refreshReader();
  }
  const frame = document.querySelector('#video-frame');
  try {
    const player = await readyVideoPlayer(frame);
    if (request !== videoSeekRequest || selected?.id !== videoId || frame !== document.querySelector('#video-frame')) return;
    player.seekTo(seconds, true);
    player.playVideo();
  } catch {
    if (request !== videoSeekRequest || selected?.id !== videoId) return;
    const hint = document.querySelector('.video-hint');
    if (hint) { hint.hidden = false; hint.textContent = 'Could not jump to that time. Open the video on YouTube.'; hint.classList.add('is-error'); }
  }
}

function renderModeContent() {
  const target = document.querySelector('#reader-mode-content');
  if (!target || !selected) return;
  const loading = transcriptState === 'loading';
  const failed = transcriptState === 'error';
  if (readerMode === 'distill') {
    const cached = distillations()[selected.id];
    const digestCopy = cached
      ? formatDistillation(cached.summary)
      : failed
        ? `<p>${escape(transcriptError || 'No transcript is available, so there is nothing to distill.')}</p>`
        : '<p>Summary, insights, and action items — generated only when you ask.</p>';
    const digestMeta = cached
      ? `Distilled ${new Date(cached.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · stored in this browser.`
      : loading
        ? 'Fetching captions…'
        : 'Nothing is sent until you choose an AI action.';
    target.innerHTML = `<section class="digest"><header class="block-head"><h3>Distillation</h3><button id="summarize-video" class="text-action" type="button"${transcript.length ? '' : ' disabled'}>${cached ? 'Distill again' : 'Distill with AI'}</button></header><div class="digest-copy" id="digest-copy">${digestCopy}</div><p class="mode-meta" role="status">${escape(digestMeta)}</p></section>`;
    const distill = document.querySelector('#summarize-video');
    if (distill) distill.onclick = summarizeVideo;
    return;
  }
  if (readerMode === 'focus') {
    const sourceLines = focusSourceLines();
    const sourceFingerprint = focusFingerprint(sourceLines);
    const cached = selected ? cachedFocusCleanup(selected.id, sourceFingerprint) : null;
    const cleanup = focusCleanupState.videoId === selected.id ? focusCleanupState : { status: 'idle', error: '' };
    const cleaned = Array.isArray(cleanup.lines) ? cleanup : cached;
    const cleaning = cleanup.status === 'loading';
    const cleanupFailed = cleanup.status === 'error';
    const paragraphs = focusParagraphs(cleaned?.lines || sourceLines);
    const actionLabel = cleaning ? 'Cleaning…' : cleanupFailed ? 'Retry' : cleaned ? 'Clean again' : 'Clean with AI';
    const action = `<button id="clean-focus" class="text-action" type="button"${!sourceLines.length || cleaning ? ' disabled' : ''}>${actionLabel}</button>`;
    const notice = cleaning
      ? '<p class="mode-state" role="status">Cleaning punctuation and paragraph breaks… The full transcript stays visible.</p>'
      : cleanupFailed
        ? `<p class="mode-state is-error" role="status">${escape(cleaned ? `Could not refresh this cleanup. ${cleanup.error} Showing the current cleaned version.` : `${cleanup.error} Showing the local version.`)}</p>`
        : '';
    const body = loading
      ? '<p class="mode-state" role="status">Fetching captions… the first load of a video can take a minute.</p>'
      : failed
        ? `<p class="mode-state is-error" role="status">${escape(transcriptError)}</p>`
        : paragraphs.length
          ? `<div class="focus-copy">${paragraphs.map(paragraph => `<p>${timestampButton(paragraph.time)}<span>${escape(paragraph.text)}</span></p>`).join('')}</div>`
          : '<p class="mode-state">No transcript is available.</p>';
    const meta = cleaned
      ? `AI-cleaned ${new Date(cleaned.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${cleaned.stored === false ? 'available until reload; this browser could not store it.' : 'stored in this browser.'}`
      : 'AI cleanup changes punctuation, capitalisation, and paragraph breaks only.';
    target.innerHTML = `<section class="focus-mode"><header class="block-head"><h3>Focus</h3><span class="mode-meta">full transcript · paragraph timestamps</span>${action}</header>${notice}${body}<p class="mode-meta focus-meta">${escape(meta)} Raw captions stay unchanged.</p></section>`;
    const clean = document.querySelector('#clean-focus');
    if (clean) clean.onclick = cleanFocusTranscript;
    target.querySelectorAll('[data-seek]').forEach(button => button.onclick = () => seekDockedVideo(Number(button.dataset.seek)));
    return;
  }
  const rows = transcript.map(line => {
    const timestamp = timestampButton(line.time);
    return `<p${timestamp ? '' : ' class="has-no-time"'}>${timestamp}<span>${escape(line.content)}</span></p>`;
  }).join('');
  const body = loading
    ? '<p class="mode-state" role="status">Fetching captions… the first load of a video can take a minute.</p>'
    : failed
      ? `<p class="mode-state is-error" role="status">${escape(transcriptError)}</p>`
      : rows || '<p class="mode-state">No transcript is available.</p>';
  const hasTimestamps = transcript.some(line => typeof line.time === 'string' && line.time);
  target.innerHTML = `<section class="raw-mode"><header class="block-head"><h3>Raw transcript</h3><span class="mode-meta">${transcript.length ? `${transcript.length} lines · ${hasTimestamps ? 'timestamps jump the video' : 'source transcript'}` : ''}</span></header><div class="transcript">${body}</div></section>`;
  target.querySelectorAll('[data-seek]').forEach(button => button.onclick = () => seekDockedVideo(Number(button.dataset.seek)));
}

function renderTranscript() {
  renderModeContent();
}

function selectVideo(id, scroll = true) {
  const mobile = matchMedia('(max-width: 59.999rem)').matches;
  if (mobile) document.querySelector('#queue-drawer').open = false;
  if (selected?.id === id) {
    if (mobile && scroll) reader.scrollIntoView({ behavior: 'auto', block: 'start' });
    return;
  }
  selected = videos.find(video => video.id === id);
  transcript = [];
  transcriptState = 'idle';
  transcriptError = '';
  resetFocusCleanupState();
  videoStart = 0;
  const read = state('watchpaper-read');
  read.add(id);
  saveState('watchpaper-read', read);
  render();
  renderReader();
  reader.scrollTop = 0;
  loadTranscript();
  if (scroll && matchMedia('(max-width: 60rem)').matches) reader.scrollIntoView({ behavior: 'auto', block: 'start' });
}

// Re-rendering replaces the reader's markup, which would throw an in-progress
// read back to the top. Hold the reader's place across in-place updates.
function refreshReader() {
  const top = reader.scrollTop;
  renderReader();
  reader.scrollTop = top;
}

function toggleSaved() {
  const saved = state('watchpaper-saved');
  saved.has(selected.id) ? saved.delete(selected.id) : saved.add(selected.id);
  saveState('watchpaper-saved', saved);
  render();
  refreshReader();
}

let undoTimer;
function showUndo(message, undo) {
  const region = document.querySelector('#toast-region');
  clearTimeout(undoTimer);
  region.hidden = false;
  region.innerHTML = `<div class="toast"><span>${escape(message)}</span><button id="undo-remove">Undo</button></div>`;
  document.querySelector('#undo-remove').onclick = () => {
    clearTimeout(undoTimer);
    region.hidden = true;
    region.innerHTML = '';
    undo();
  };
  undoTimer = setTimeout(() => {
    region.hidden = true;
    region.innerHTML = '';
  }, 8000);
}

function removeVideo() {
  const video = selected;
  const wasDirect = directVideos.some(entry => entry.id === video.id);
  transcriptRequest += 1;
  directVideos = directVideos.filter(entry => entry.id !== video.id);
  saveDirectVideos();
  const hidden = state('watchpaper-hidden');
  if (channelVideos.some(entry => entry.id === video.id)) hidden.add(video.id);
  saveState('watchpaper-hidden', hidden);
  selected = undefined;
  transcript = [];
  transcriptState = 'idle';
  transcriptError = '';
  resetFocusCleanupState();
  videoStart = 0;
  composeVideos();
  render();
  renderReader();
  showUndo('Removed from the queue.', () => {
    if (wasDirect && !directVideos.some(entry => entry.id === video.id)) directVideos.unshift(video);
    hidden.delete(video.id);
    saveDirectVideos();
    saveState('watchpaper-hidden', hidden);
    composeVideos();
    render();
    selectVideo(video.id, false);
  });
}

function removeChannel(channel) {
  transcriptRequest += 1;
  channels = channels.filter(entry => entry !== channel);
  channelVideos = channelVideos.filter(video => video.channelId !== channel.channelId);
  composeVideos();
  saveChannels();
  localStorage.removeItem('watchpaper-channel');
  if (activeChannel === channelKey(channel)) activeChannel = 'all';
  if (selected && !videos.some(video => video.id === selected.id)) {
    selected = undefined;
    transcript = [];
    transcriptState = 'idle';
    transcriptError = '';
    resetFocusCleanupState();
    videoStart = 0;
  }
  render();
  renderReader();
}

async function loadMoreVideos(channel) {
  if (!channel || channel.loadingMore) return;
  channel.loadingMore = true;
  channel.loadMoreError = null;
  render();
  try {
    const offset = channelVideos.filter(video => video.channelId === channel.channelId).length;
    const added = await fetchChannel(channel, offset);
    if (!channels.includes(channel)) return;
    channelVideos = [...new Map([...channelVideos, ...added].map(video => [video.id, video])).values()];
    composeVideos();
  } catch (error) {
    channel.loadMoreError = error.message;
  }
  channel.loadingMore = false;
  render();
}

async function loadTranscript() {
  const request = ++transcriptRequest;
  transcriptState = 'loading';
  transcriptError = '';
  renderTranscript();
  try {
    const response = await fetch(`/api/transcript?videoId=${selected.id}`);
    const payload = await response.json();
    if (request !== transcriptRequest) return;
    if (!response.ok) throw new Error(payload.error);
    transcript = payload.lines;
    transcriptState = 'ready';
    renderTranscript();
  } catch (error) {
    if (request !== transcriptRequest) return;
    transcript = [];
    transcriptState = 'error';
    transcriptError = error.message;
    renderTranscript();
  }
}

const summaryDialog = document.querySelector('#summary-dialog');
const readingPrefs = {
  theme: ['watchpaper-theme', 'theme'],
  font: ['watchpaper-reader-font', 'readerFont'],
  alignment: ['watchpaper-reader-align', 'readerAlign'],
};
const readerSizeRange = { min: 14, max: 36, fallback: 17 };
const readerWidthSteps = ['48', '58', '68', '78', '88', 'full'];
function currentReaderSize() {
  const value = Number(document.documentElement.dataset.readerSize);
  if (!Number.isFinite(value)) return readerSizeRange.fallback;
  return Math.max(readerSizeRange.min, Math.min(readerSizeRange.max, Math.round(value)));
}
function syncReaderSizeStepper() {
  const size = currentReaderSize();
  document.querySelector('#reader-size-value').textContent = `${size} px`;
  document.querySelector('#reader-size-down').disabled = size === readerSizeRange.min;
  document.querySelector('#reader-size-up').disabled = size === readerSizeRange.max;
}
function stepReaderSize(direction) {
  const next = Math.max(readerSizeRange.min, Math.min(readerSizeRange.max, currentReaderSize() + direction));
  document.documentElement.dataset.readerSize = String(next);
  document.documentElement.style.setProperty('--reader-size', `${next}px`);
  localStorage.setItem('watchpaper-reader-size', String(next));
  syncReaderSizeStepper();
}
function currentReaderWidth() {
  const value = document.documentElement.dataset.readerWidth;
  return readerWidthSteps.includes(value) ? value : 'full';
}
function syncReaderWidthStepper() {
  const width = currentReaderWidth();
  const index = readerWidthSteps.indexOf(width);
  document.querySelector('#reader-width-value').textContent = width === 'full' ? 'Full width' : `${width} ch`;
  document.querySelector('#reader-width-down').disabled = index === 0;
  document.querySelector('#reader-width-up').disabled = index === readerWidthSteps.length - 1;
}
function stepReaderWidth(direction) {
  const current = readerWidthSteps.indexOf(currentReaderWidth());
  const index = Math.max(0, Math.min(readerWidthSteps.length - 1, current + direction));
  const next = readerWidthSteps[index];
  document.documentElement.dataset.readerWidth = next;
  document.documentElement.style.setProperty('--reader-width', next === 'full' ? 'none' : `${next}ch`);
  localStorage.setItem('watchpaper-reader-width', next);
  syncReaderWidthStepper();
}
function syncReadingSettings() {
  summaryDialog.querySelectorAll('input[type="radio"]').forEach(input => {
    const preference = readingPrefs[input.name];
    if (preference) input.checked = document.documentElement.dataset[preference[1]] === input.value;
  });
  syncReaderSizeStepper();
  syncReaderWidthStepper();
}
summaryDialog.addEventListener('change', event => {
  const preference = readingPrefs[event.target.name];
  if (!preference) return;
  const [key, attribute] = preference;
  document.documentElement.dataset[attribute] = event.target.value;
  localStorage.setItem(key, event.target.value);
});
document.querySelector('#reader-size-down').onclick = () => stepReaderSize(-1);
document.querySelector('#reader-size-up').onclick = () => stepReaderSize(1);
document.querySelector('#reader-width-down').onclick = () => stepReaderWidth(-1);
document.querySelector('#reader-width-up').onclick = () => stepReaderWidth(1);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
  if (localStorage.getItem('watchpaper-theme')) return;
  document.documentElement.dataset.theme = event.matches ? 'night' : 'paper';
  syncReadingSettings();
});
const summaryModels = {
  chatgpt: [],
  codex: [['gpt-5.6-luna', 'GPT-5.6 Luna'], ['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6', 'GPT-5.6']],
  'claude-session': [['claude-sonnet-4-5', 'Claude Sonnet 4.5'], ['claude-opus-4-5', 'Claude Opus 4.5']],
  anthropic: [['claude-sonnet-4-5', 'Claude Sonnet 4.5'], ['claude-opus-4-5', 'Claude Opus 4.5']],
  openai: [['gpt-5.6-luna', 'GPT-5.6 Luna'], ['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6', 'GPT-5.6']],
};
function renderModelOptions(provider, selectedModel = '') {
  const models = summaryModels[provider] || [];
  if (!models.length) {
    document.querySelector('#summary-model').innerHTML = '<option value="">Sign in to load models</option>';
    document.querySelector('#custom-model-wrap').hidden = true;
    return;
  }
  if (provider === 'chatgpt' && !models.some(([id]) => id === selectedModel)) selectedModel = '';
  const known = models.some(([id]) => id === selectedModel);
  document.querySelector('#summary-model').innerHTML = models.map(([id, label]) => `<option value="${escape(id)}">${escape(label)}</option>`).join('') + (provider === 'chatgpt' ? '' : '<option value="custom">Custom model…</option>');
  document.querySelector('#summary-model').value = known || !selectedModel ? models[0][0] : 'custom';
  document.querySelector('#custom-summary-model').value = known ? '' : selectedModel;
  document.querySelector('#custom-model-wrap').hidden = document.querySelector('#summary-model').value !== 'custom';
}
function storedApiKey(provider) {
  return ['openai', 'anthropic'].includes(provider)
    ? sessionStorage.getItem(`watchpaper-summary-key-${provider}`) || ''
    : '';
}
function openSummarySettings(panel = 'reading') {
  syncReadingSettings();
  const provider = localStorage.getItem('watchpaper-summary-provider') || 'chatgpt';
  document.querySelector('#summary-provider').value = provider;
  document.querySelector('#summary-key').value = storedApiKey(provider);
  document.querySelector('#summary-prompt').value = localStorage.getItem('watchpaper-summary-prompt') || '';
  renderModelOptions(provider, localStorage.getItem('watchpaper-summary-model') || '');
  updateProviderControls();
  showSettingsPanel(panel === 'ai' ? 'ai' : 'reading');
  summaryDialog.showModal();
  summaryDialog.scrollTop = 0;
  document.querySelector(panel === 'ai' ? '#settings-tab-ai' : '#settings-tab-reading').focus?.({ preventScroll: true });
}
document.querySelector('#summary-settings').onclick = () => openSummarySettings();
document.querySelector('#save-summary-settings').onclick = () => {
  const provider = document.querySelector('#summary-provider').value;
  localStorage.setItem('watchpaper-summary-provider', provider);
  const model = document.querySelector('#summary-model').value === 'custom' ? document.querySelector('#custom-summary-model').value.trim() : document.querySelector('#summary-model').value;
  localStorage.setItem('watchpaper-summary-model', model);
  localStorage.setItem('watchpaper-summary-prompt', document.querySelector('#summary-prompt').value.trim());
  if (['openai', 'anthropic'].includes(provider)) {
    sessionStorage.setItem(`watchpaper-summary-key-${provider}`, document.querySelector('#summary-key').value.trim());
  }
};
document.querySelector('#summary-provider').onchange = event => {
  renderModelOptions(event.target.value);
  document.querySelector('#summary-key').value = storedApiKey(event.target.value);
  updateProviderControls();
};
document.querySelector('#summary-model').onchange = event => { document.querySelector('#custom-model-wrap').hidden = event.target.value !== 'custom'; };
function showSettingsPanel(name, focus = false) {
  for (const panel of ['reading', 'ai']) {
    const active = panel === name;
    const button = document.querySelector(`#settings-tab-${panel}`);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    document.querySelector(`#settings-panel-${panel}`).hidden = !active;
    if (active && focus) button.focus();
  }
  summaryDialog.scrollTop = 0;
}
for (const name of ['reading', 'ai']) {
  const button = document.querySelector(`#settings-tab-${name}`);
  button.onclick = () => showSettingsPanel(name);
  button.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showSettingsPanel(event.key === 'Home' ? 'reading' : event.key === 'End' ? 'ai' : name === 'reading' ? 'ai' : 'reading', true);
  };
}
function updateProviderControls() {
  const provider = document.querySelector('#summary-provider').value;
  document.querySelector('#chatgpt-account').hidden = provider !== 'chatgpt';
  document.querySelector('#summary-key-wrap').hidden = !['openai', 'anthropic'].includes(provider);
  if (provider === 'chatgpt') refreshChatGPT();
}
async function chatgptRequest(path, method = 'GET') {
  const response = await fetch(`/api/chatgpt/${path}`, method === 'POST'
    ? { method, headers: { 'content-type': 'application/json' }, body: '{}' } : undefined);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Could not connect to ChatGPT.');
  return payload;
}
function showChatGPTSession(session) {
  const connecting = session.status === 'connecting';
  const connected = session.status === 'connected';
  document.querySelector('#chatgpt-status').textContent = session.error || (connecting
    ? 'Complete sign-in in your browser.' : session.sharing
      ? `Using ChatGPT plan${session.name ? ` · ${session.name}` : ''}`
      : connected ? 'Signed in. Reconnect to allow ChatGPT plan usage.' : 'Sign in to use your ChatGPT plan.');
  document.querySelector('#chatgpt-connect').hidden = connecting || session.sharing;
  document.querySelector('#chatgpt-cancel').hidden = !connecting;
  document.querySelector('#chatgpt-disconnect').hidden = !connected && session.status !== 'reauth_required';
}
async function refreshChatGPT() {
  try {
    const session = await chatgptRequest('session');
    showChatGPTSession(session);
    summaryModels.chatgpt = session.sharing
      ? (await chatgptRequest('models')).models.map(({ id, name }) => [id, name]) : [];
    if (document.querySelector('#summary-provider').value === 'chatgpt') {
      renderModelOptions('chatgpt', localStorage.getItem('watchpaper-summary-model') || '');
    }
  } catch (error) { document.querySelector('#chatgpt-status').textContent = error.message; }
}
document.querySelector('#chatgpt-connect').onclick = async () => {
  showChatGPTSession({ status: 'connecting' });
  let failure;
  try { await chatgptRequest('sign-in', 'POST'); }
  catch (error) { failure = error.message; }
  await refreshChatGPT();
  if (failure) document.querySelector('#chatgpt-status').textContent = failure;
};
document.querySelector('#chatgpt-cancel').onclick = async () => {
  try { await chatgptRequest('cancel', 'POST'); await refreshChatGPT(); }
  catch (error) { document.querySelector('#chatgpt-status').textContent = error.message; }
};
document.querySelector('#chatgpt-disconnect').onclick = async () => {
  try { await chatgptRequest('disconnect', 'POST'); await refreshChatGPT(); }
  catch (error) { document.querySelector('#chatgpt-status').textContent = error.message; }
};
async function summarizeVideo() {
  const provider = localStorage.getItem('watchpaper-summary-provider') || 'chatgpt';
  const apiKey = storedApiKey(provider);
  if (!provider || !['codex', 'claude-session', 'chatgpt'].includes(provider) && !apiKey) return openSummarySettings('ai');
  if (!transcript.length) return;
  const video = selected;
  const summary = document.querySelector('#digest-copy');
  const button = document.querySelector('#summarize-video');
  button.disabled = true;
  button.textContent = 'Distilling…';
  summary.innerHTML = '<p>Distilling the transcript…</p>';
  try {
    const response = await fetch('/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, apiKey, model: localStorage.getItem('watchpaper-summary-model'), prompt: localStorage.getItem('watchpaper-summary-prompt') || '', transcript: transcript.map(line => line.time ? `[${line.time}] ${line.content}` : line.content).join('\n') }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    saveDistillation(video.id, payload.summary);
    if (selected?.id !== video.id) return;
    renderModeContent();
  } catch (error) {
    if (selected?.id !== video.id) return;
    const currentSummary = document.querySelector('#digest-copy');
    const currentButton = document.querySelector('#summarize-video');
    if (!currentSummary || !currentButton) return;
    currentSummary.innerHTML = `<p>${escape(error.message)}</p>`;
    currentButton.disabled = false;
    currentButton.textContent = distillations()[video.id] ? 'Distill again' : 'Distill with AI';
  }
}

async function cleanFocusTranscript() {
  const provider = localStorage.getItem('watchpaper-summary-provider') || 'chatgpt';
  const apiKey = storedApiKey(provider);
  if (!provider || !['codex', 'claude-session', 'chatgpt'].includes(provider) && !apiKey) return openSummarySettings('ai');
  const sourceLines = focusSourceLines();
  if (!selected || !sourceLines.length) return;
  const video = selected;
  const sourceFingerprint = focusFingerprint(sourceLines);
  const request = ++focusCleanupRequest;
  const previousCleanup = focusCleanupState.videoId === video.id ? focusCleanupState : {};
  focusCleanupState = { ...previousCleanup, videoId: video.id, status: 'loading', error: '' };
  renderModeContent();
  try {
    const response = await fetch('/api/focus-cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider,
        apiKey,
        model: localStorage.getItem('watchpaper-summary-model'),
        lines: sourceLines.map(({ time, ...line }) => line),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    if (payload.cleanupVersion !== focusCleanupVersion || !Array.isArray(payload.lines) || payload.lines.length !== sourceLines.length) {
      throw new Error('AI cleanup did not return the full transcript.');
    }
    if (request !== focusCleanupRequest || selected?.id !== video.id || focusFingerprint(focusSourceLines()) !== sourceFingerprint) return;
    const saved = saveFocusCleanup(video.id, payload.lines, sourceFingerprint);
    focusCleanupState = {
      videoId: video.id,
      status: 'success',
      error: '',
      lines: payload.lines,
      date: saved?.date || new Date().toISOString(),
      stored: Boolean(saved),
    };
    renderModeContent();
  } catch (error) {
    if (request !== focusCleanupRequest || selected?.id !== video.id) return;
    focusCleanupState = { ...focusCleanupState, videoId: video.id, status: 'error', error: error.message || 'AI cleanup failed.' };
    renderModeContent();
  }
}

const videoForm = document.querySelector('#video-form');
const videoInput = document.querySelector('#video-url');
const videoHelper = document.querySelector('#video-helper');
videoForm.addEventListener('submit', async event => {
  event.preventDefault();
  const source = videoInput.value.trim();
  const submit = document.querySelector('#read-video');
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  submit.textContent = 'Reading link…';
  videoInput.removeAttribute('aria-invalid');
  videoHelper.textContent = 'Checking the video and opening its captions…';
  videoHelper.classList.remove('is-error');
  try {
    const response = await fetch(`/api/video?source=${encodeURIComponent(source)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    const hidden = state('watchpaper-hidden');
    if (hidden.delete(payload.id)) {
      saveState('watchpaper-hidden', hidden);
      composeVideos();
    }
    let video = videos.find(entry => entry.id === payload.id);
    if (!video) {
      video = { ...payload, addedAt: new Date().toISOString() };
      directVideos.unshift(video);
      saveDirectVideos();
      composeVideos();
    }
    activeChannel = 'all';
    activeFilter = 'all';
    document.querySelector('#search').value = '';
    videoInput.value = '';
    render();
    selectVideo(video.id);
    videoHelper.textContent = videoHelper.dataset.default;
  } catch (error) {
    videoHelper.textContent = error.message;
    videoHelper.classList.add('is-error');
    videoInput.setAttribute('aria-invalid', 'true');
    videoInput.focus();
  }
  submit.disabled = false;
  submit.removeAttribute('aria-busy');
  submit.textContent = 'Read video';
});
videoInput.addEventListener('input', () => {
  if (!videoInput.hasAttribute('aria-invalid')) return;
  videoInput.removeAttribute('aria-invalid');
  videoHelper.textContent = videoHelper.dataset.default;
  videoHelper.classList.remove('is-error');
});

const dialog = document.querySelector('#channel-dialog');
const channelHelper = dialog.querySelector('.helper');
const channelInput = document.querySelector('#channel-url');
document.querySelector('#add-channel').onclick = () => {
  channelHelper.textContent = channelHelper.dataset.default;
  channelHelper.classList.remove('is-error');
  channelInput.removeAttribute('aria-invalid');
  dialog.showModal();
  channelInput.focus();
};
dialog.querySelector('form').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const source = channelInput.value.trim();
  const submit = dialog.querySelector('.submit');
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  submit.textContent = 'Fetching feed…';
  channelInput.removeAttribute('aria-invalid');
  channelHelper.textContent = 'Checking the channel and fetching its latest videos…';
  channelHelper.classList.remove('is-error');
  try {
    const channel = { source };
    const added = await fetchChannel(channel);
    if (channels.some(entry => entry.channelId === channel.channelId)) throw new Error(`${channel.name} is already in your list.`);
    channels.push(channel);
    channelVideos = [...channelVideos, ...added];
    composeVideos();
    saveChannels();
    dialog.close();
    channelInput.value = '';
    activeChannel = channelKey(channel);
    render();
    if (!selected && videos[0]) selectVideo(videos[0].id, false);
    else renderReader();
  } catch (error) {
    channelHelper.textContent = error.message;
    channelHelper.classList.add('is-error');
    channelInput.setAttribute('aria-invalid', 'true');
    channelInput.focus();
  }
  submit.disabled = false;
  submit.removeAttribute('aria-busy');
  submit.textContent = 'Add channel';
});
const subscriptionFile = document.querySelector('#subscriptions-file');
const subscriptionImport = document.querySelector('#import-subscriptions');
const subscriptionStatus = document.querySelector('#subscriptions-status');
let pendingSubscriptions = [];
subscriptionFile.onchange = async () => {
  pendingSubscriptions = [];
  subscriptionImport.disabled = true;
  subscriptionStatus.classList.remove('is-error');
  const file = subscriptionFile.files[0];
  if (!file) { subscriptionStatus.textContent = ''; return; }
  try {
    if (file.size > 2_000_000) throw new Error('Choose the subscriptions CSV, up to 2 MB, rather than the full Takeout archive.');
    pendingSubscriptions = parseSubscriptionCsv(await file.text());
    const existing = pendingSubscriptions.filter(channel => channels.some(entry => channelKey(entry) === channel.channelId)).length;
    subscriptionStatus.textContent = `${pendingSubscriptions.length} channels found. ${existing} already followed.`;
    subscriptionImport.disabled = existing === pendingSubscriptions.length;
  } catch (error) {
    subscriptionStatus.textContent = error.message;
    subscriptionStatus.classList.add('is-error');
  }
};
subscriptionImport.onclick = async () => {
  if (loadingFeeds) {
    subscriptionStatus.textContent = 'Wait for the current channels to finish loading, then import.';
    return;
  }
  const added = pendingSubscriptions.filter(channel => !channels.some(entry => channelKey(entry) === channel.channelId));
  if (!added.length) return;
  channels.push(...added);
  saveChannels();
  pendingSubscriptions = [];
  subscriptionFile.value = '';
  subscriptionImport.disabled = true;
  subscriptionStatus.textContent = '';
  activeChannel = 'all';
  dialog.close();
  await loadChannels();
};

channelInput.addEventListener('input', () => {
  if (!channelInput.hasAttribute('aria-invalid')) return;
  channelInput.removeAttribute('aria-invalid');
  channelHelper.textContent = channelHelper.dataset.default;
  channelHelper.classList.remove('is-error');
});
document.querySelectorAll('.filter').forEach(button => button.onclick = () => { activeFilter = button.dataset.filter; render(); });
document.querySelector('#search').oninput = render;
channelSearch.oninput = renderChannels;
channelPicker.addEventListener('toggle', () => {
  const openedFromSummary = document.activeElement === channelPicker.querySelector('.channel-picker-summary');
  channelPicker.querySelector('.channel-picker-disclose').textContent = channelPicker.open ? 'Close' : 'Choose';
  if (channelPicker.open && openedFromSummary) channelSearch.focus();
});
const wideQueue = matchMedia('(min-width: 60rem)');
document.querySelector('#queue-drawer').open = wideQueue.matches;
wideQueue.addEventListener('change', event => { document.querySelector('#queue-drawer').open = event.matches; });
channels = storedChannels();
directVideos = storedDirectVideos();
composeVideos();
render();
renderReader();
loadChannels();

[dialog, summaryDialog].forEach(modal => modal.addEventListener('click', event => {
  if (event.target === modal) modal.close();
}));
[dialog, summaryDialog].forEach(modal => modal.addEventListener('cancel', event => {
  event.preventDefault();
  modal.close();
}));
[dialog, summaryDialog].forEach(modal => modal.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  modal.close();
}));
