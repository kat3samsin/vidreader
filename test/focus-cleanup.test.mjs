import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEANUP_VERSION, parseCleanupResponse } from '../focus-cleanup.mjs';

test('preserves an exact speaker label and its paragraph boundary', () => {
  assert.equal(CLEANUP_VERSION, 4);
  const source = [
    { id: 0, content: 'Matt Mullenweg:', speaker: true },
    { id: 1, content: 'hello everybody' },
  ];
  const cleaned = parseCleanupResponse(JSON.stringify({ lines: [
    { id: 0, text: 'Matt Mullenweg:', paragraphStart: false },
    { id: 1, text: 'Hello, everybody.', paragraphStart: false },
  ] }), source);
  assert.deepEqual(cleaned, [
    { id: 0, text: 'Matt Mullenweg:', paragraphStart: true, speaker: true },
    { id: 1, text: 'Hello, everybody.', paragraphStart: false },
  ]);
});

test('rejects changed labels and words moved between lines', () => {
  const source = [
    { id: 0, content: 'Susan Hobbs:', speaker: true },
    { id: 1, content: 'Thank you everyone' },
    { id: 2, content: 'Welcome back' },
  ];
  assert.throws(() => parseCleanupResponse(JSON.stringify({ lines: [
    { id: 0, text: 'Susan Hobbs', paragraphStart: true },
    { id: 1, text: 'Thank you everyone', paragraphStart: false },
    { id: 2, text: 'Welcome back', paragraphStart: false },
  ] }), source), /speaker label/);
  assert.throws(() => parseCleanupResponse(JSON.stringify({ lines: [
    { id: 0, text: 'Susan Hobbs:', paragraphStart: true },
    { id: 1, text: 'Thank you', paragraphStart: false },
    { id: 2, text: 'everyone Welcome back', paragraphStart: false },
  ] }), source), /moved or changed words/);
});
