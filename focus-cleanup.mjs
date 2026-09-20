export const CLEANUP_VERSION = 4;

const casedLexicalTokens = value => (value
  .normalize('NFC')
  .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [])
  .map(token => token.replace(/['’]/gu, ''));

const lexicalTokens = value => casedLexicalTokens(value).map(token => token.toLocaleLowerCase('en'));

const protectedTokens = value => value
  .normalize('NFC')
  .split(/\s+/u)
  .map(token => token.replace(/^["'“”‘’([{]+/u, '').replace(/["'“”‘’.,!?;:)\]}]+$/u, ''))
  .filter(token => /[\p{L}\p{N}]/u.test(token) && (
    /https?:\/\/|www\./iu.test(token)
    || /[@#$€£¥%°+*=<>|\\]/u.test(token)
    || /\d[.,:/+\-]\d/u.test(token)
    || /\p{L}&\p{L}/u.test(token)
  ))
  .map(token => token.toLocaleLowerCase('en'));

const sameTokens = (left, right) => left.length === right.length
  && left.every((token, index) => token === right[index]);

const preservesSourceCapitalization = (source, cleaned) => {
  const sourceTokens = casedLexicalTokens(source);
  const cleanedTokens = casedLexicalTokens(cleaned);
  return sourceTokens.length === cleanedTokens.length && sourceTokens.every((token, tokenIndex) => {
    const cleanedCharacters = [...cleanedTokens[tokenIndex]];
    return [...token].every((character, characterIndex) => !/\p{Lu}/u.test(character) || /\p{Lu}/u.test(cleanedCharacters[characterIndex] || ''));
  });
};

export function chunkTranscriptLines(lines, maxCharacters = 8000) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Load a transcript first.');
  const chunks = [];
  let chunk = [];
  let characters = 0;
  for (const line of lines) {
    const size = JSON.stringify(line).length + 1;
    if (chunk.length && characters + size > maxCharacters) {
      chunks.push(chunk);
      chunk = [];
      characters = 0;
    }
    chunk.push(line);
    characters += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function parseCleanupResponse(value, sourceLines) {
  const text = String(value || '').trim();
  const json = text.startsWith('```') && text.endsWith('```')
    ? text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : text;
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('AI cleanup returned malformed data.');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length !== sourceLines.length) {
    throw new Error('AI cleanup did not return the full transcript.');
  }
  const cleanedLines = sourceLines.map((source, index) => {
    const cleaned = payload.lines[index];
    if (!cleaned || cleaned.id !== source.id || typeof cleaned.text !== 'string' || typeof cleaned.paragraphStart !== 'boolean') {
      throw new Error('AI cleanup changed the transcript order.');
    }
    const cleanedText = cleaned.text.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!cleanedText) throw new Error('AI cleanup returned an empty transcript line.');
    if (!sameTokens(lexicalTokens(cleanedText), lexicalTokens(source.content))) {
      throw new Error('AI cleanup moved or changed words between transcript lines.');
    }
    if (!preservesSourceCapitalization(source.content, cleanedText)) {
      throw new Error('AI cleanup lowercased a name or existing capital letter.');
    }
    if (!sameTokens(protectedTokens(cleanedText), protectedTokens(source.content))) {
      throw new Error('AI cleanup changed a number or technical token in the transcript.');
    }
    if (source.speaker === true && cleanedText !== source.content) {
      throw new Error('AI cleanup changed a speaker label.');
    }
    return {
      id: source.id,
      text: cleanedText,
      paragraphStart: source.speaker === true ? true : cleaned.paragraphStart,
      ...(source.speaker === true ? { speaker: true } : {}),
    };
  });
  const sourceText = sourceLines.map(line => line.content).join(' ');
  const cleanedText = cleanedLines.map(line => line.text).join(' ');
  if (!sameTokens(lexicalTokens(cleanedText), lexicalTokens(sourceText))) {
    throw new Error('AI cleanup changed words in the transcript.');
  }
  if (!preservesSourceCapitalization(sourceText, cleanedText)) {
    throw new Error('AI cleanup lowercased a name or existing capital letter.');
  }
  if (!sameTokens(protectedTokens(cleanedText), protectedTokens(sourceText))) {
    throw new Error('AI cleanup changed a number or technical token in the transcript.');
  }
  return cleanedLines;
}
