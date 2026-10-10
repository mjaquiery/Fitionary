import { describe, expect, it } from 'vitest';
import type { RoutineItem } from '../src/lib/routine.ts';
import { advance, createSession, start } from '../src/lib/session.ts';
import { decodeDeck, encodeDeck, shareUrl, summaryJson, summaryText } from '../src/lib/share.ts';
import { makeExercise } from './helpers.ts';

const items: RoutineItem[] = [
  { id: 'Cat_Stretch', sets: 2, reps: '30s hold', block: 'warmup' },
  { id: 'Push-Up', sets: 3, reps: '8–12 · slow ✓', block: 'main' },
  { id: 'Child_s_Pose', sets: 1, reps: '45s', block: 'cooldown' },
];
const known = new Set(items.map((i) => i.id));

describe('deck encoding', () => {
  it('round-trips, including non-ASCII reps', () => {
    const encoded = encodeDeck(items);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDeck(encoded, known)).toEqual(items);
  });

  it('drops unknown exercises and clamps sets', () => {
    const encoded = encodeDeck([...items, { id: 'Nope', sets: 3, reps: '5', block: 'main' }, { id: 'Push-Up', sets: 99, reps: '5', block: 'main' }]);
    const decoded = decodeDeck(encoded, known)!;
    expect(decoded.map((i) => i.id)).toEqual(['Cat_Stretch', 'Push-Up', 'Child_s_Pose', 'Push-Up']);
    expect(decoded.at(-1)!.sets).toBe(10);
  });

  it('returns null for garbage', () => {
    expect(decodeDeck('%%%not-base64', known)).toBeNull();
    expect(decodeDeck(btoa('{"a":1}'), known)).toBeNull();
    expect(decodeDeck(encodeDeck([]), known)).toBeNull();
  });

  it('builds a share URL', () => {
    expect(shareUrl('https://example.test', items)).toBe(`https://example.test/routine?deck=${encodeDeck(items)}`);
  });
});

describe('summaries', () => {
  const byId = new Map(
    [makeExercise({ id: 'Cat_Stretch', name: 'Cat Stretch' }), makeExercise({ id: 'Push-Up', name: 'Push-Up' })].map((e) => [e.id, e]),
  );
  let s = start(createSession(items, [60_000, 120_000, 60_000]), 0);
  s = advance(s, 60_000, 'done');
  s = advance(s, 90_000, 'skipped');
  s = advance(s, 150_000, 'done');

  it('formats plain text with status marks and the link', () => {
    expect(summaryText(s, byId, 'https://x.test/r')).toBe(
      [
        'Fitionary workout: 2 of 3 done, 1 skipped, 3 min active',
        '',
        '✓ 1. Cat Stretch (2 × 30s hold)',
        '↷ 2. Push-Up (3 × 8–12 · slow ✓)',
        '✓ 3. Child_s_Pose (1 × 45s)',
        '',
        'Try this routine: https://x.test/r',
      ].join('\n'),
    );
  });

  it('exports JSON with per-exercise status and time', () => {
    const json = JSON.parse(summaryJson(s, byId, 'https://x.test/r'));
    expect(json).toMatchObject({ completed: 2, skipped: 1, activeSeconds: 150 });
    expect(json.exercises[1]).toEqual({
      id: 'Push-Up',
      name: 'Push-Up',
      block: 'main',
      sets: 3,
      reps: '8–12 · slow ✓',
      status: 'skipped',
      seconds: 30,
    });
  });
});
