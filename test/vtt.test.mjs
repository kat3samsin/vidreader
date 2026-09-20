import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVtt } from '../vtt.mjs';

const captions = cues => `WEBVTT\n\n${cues.map(([time, text]) => `00:${time} --> 01:00:00.000\n${text}`).join('\n\n')}\n`;

test('removes rolling caption overlap without losing repeated words or changing casing', () => {
  assert.deepEqual(parseVtt(captions([
    ['00:00.000', 'One two one two'],
    ['00:08.000', 'ONE two Three'],
    ['00:16.000', 'three'],
    ['00:24.000', 'four FIVE'],
    ['00:28.000', 'FIVE six'],
  ])), [
    { time: '00:00.000', content: 'One two one two' },
    { time: '00:08.000', content: 'Three' },
    { time: '00:24.000', content: 'four FIVE six' },
  ]);
});

test('preserves long captions with no shared words', () => {
  const first = Array(16000).fill('word').join(' ');
  const second = Array(16000).fill('different').join(' ');
  assert.deepEqual(parseVtt(captions([
    ['00:00.000', first],
    ['00:08.000', second],
  ])), [
    { time: '00:00.000', content: first },
    { time: '00:08.000', content: second },
  ]);
});

test('removes caption markup while preserving empty, escaped, and unfinished tags', () => {
  assert.deepEqual(parseVtt(captions([
    ['00:00.000', '<b>Hello</b> <> <<nested>> &lt;shown&gt; <unfinished'],
  ])), [{ time: '00:00.000', content: 'Hello <> > <shown> <unfinished' }]);
});

test('preserves long text with unmatched tag openers', () => {
  const content = '<'.repeat(100000);
  assert.deepEqual(parseVtt(captions([
    ['00:00.000', content],
  ])), [{ time: '00:00.000', content }]);
});
