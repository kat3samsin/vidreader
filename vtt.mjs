const decode = value => value
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

function stripTags(value) {
  const parts = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start < 0) break;
    const end = value.indexOf('>', start + 1);
    if (end < 0) break;
    parts.push(value.slice(cursor, end === start + 1 ? end + 1 : start));
    cursor = end + 1;
  }
  parts.push(value.slice(cursor));
  return parts.join('');
}

function overlappingWords(previous, current) {
  if (!previous.length) return 0;
  const prefixes = new Array(current.length).fill(0);
  for (let index = 1, length = 0; index < current.length; index++) {
    while (length && current[index] !== current[length]) length = prefixes[length - 1];
    if (current[index] === current[length]) length++;
    prefixes[index] = length;
  }
  let overlap = 0;
  for (const word of previous) {
    while (overlap && (overlap === current.length || word !== current[overlap])) overlap = prefixes[overlap - 1];
    if (word === current[overlap]) overlap++;
  }
  return overlap;
}

export function parseVtt(vtt) {
  const cues = vtt.replace(/^WEBVTT[\s\S]*?\n\n/, '').split(/\n\n+/).map(block => {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) return null;
    const time = lines[index].split('-->')[0].trim().replace(/^00:/, '');
    const content = decode(stripTags(lines.slice(index + 1).join(' '))).normalize('NFC').replace(/\s+/g, ' ').trim();
    return content ? { time, content } : null;
  }).filter(Boolean);
  const segments = [];
  let previousWords = [];
  for (const cue of cues) {
    const words = cue.content.split(' ');
    const normalizedWords = words.map(word => word.toLowerCase());
    const overlap = overlappingWords(previousWords, normalizedWords);
    const content = words.slice(overlap).join(' ');
    previousWords = normalizedWords;
    if (!content) continue;
    const seconds = cue.time.split(':').reduce((total, value) => total * 60 + Number(value), 0);
    const last = segments.at(-1);
    if (last && seconds - last.seconds < 7) last.content += ` ${content}`;
    else segments.push({ time: cue.time, seconds, content });
  }
  return segments.map(({ time, content }) => ({ time, content }));
}
