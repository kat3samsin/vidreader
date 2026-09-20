const decode = value => value
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

export function parseVtt(vtt) {
  const cues = vtt.replace(/^WEBVTT[\s\S]*?\n\n/, '').split(/\n\n+/).map(block => {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) return null;
    const time = lines[index].split('-->')[0].trim().replace(/^00:/, '');
    const content = decode(lines.slice(index + 1).join(' ').replace(/<[^>]+>/g, '')).normalize('NFC').replace(/\s+/g, ' ').trim();
    return content ? { time, content } : null;
  }).filter(Boolean);
  const segments = [];
  let previousWords = [];
  for (const cue of cues) {
    const words = cue.content.split(' ');
    let overlap = Math.min(previousWords.length, words.length);
    while (overlap && previousWords.slice(-overlap).join(' ').toLowerCase() !== words.slice(0, overlap).join(' ').toLowerCase()) overlap--;
    const content = words.slice(overlap).join(' ');
    previousWords = words;
    if (!content) continue;
    const seconds = cue.time.split(':').reduce((total, value) => total * 60 + Number(value), 0);
    const last = segments.at(-1);
    if (last && seconds - last.seconds < 7) last.content += ` ${content}`;
    else segments.push({ time: cue.time, seconds, content });
  }
  return segments.map(({ time, content }) => ({ time, content }));
}
