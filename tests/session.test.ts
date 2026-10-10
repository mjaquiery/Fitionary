import { describe, expect, it } from 'vitest';
import type { RoutineItem } from '../src/lib/routine.ts';
import {
  advance,
  cardElapsed,
  createSession,
  isFinished,
  isRunning,
  isSession,
  pause,
  resume,
  start,
  tick,
  totals,
} from '../src/lib/session.ts';

const items: RoutineItem[] = [
  { id: 'A', sets: 1, reps: '10', block: 'main' },
  { id: 'B', sets: 1, reps: '10', block: 'main' },
  { id: 'C', sets: 1, reps: '10', block: 'main' },
];
const durations = [10_000, 20_000, 30_000];
const fresh = () => createSession(items, durations);

describe('session timer', () => {
  it('starts paused with nothing elapsed', () => {
    const s = fresh();
    expect(isRunning(s)).toBe(false);
    expect(cardElapsed(s, 5000)).toBe(0);
    expect(s.statuses).toEqual(['pending', 'pending', 'pending']);
  });

  it('counts only running time across pause/resume', () => {
    let s = start(fresh(), 1000);
    s = pause(s, 4000); // 3 s
    expect(cardElapsed(s, 60_000)).toBe(3000);
    s = resume(s, 10_000);
    expect(cardElapsed(s, 12_000)).toBe(5000);
    expect(s.startedAt).toBe(1000);
  });

  it('pause and start are idempotent', () => {
    const s = start(fresh(), 0);
    expect(start(s, 500)).toBe(s);
    const p = pause(s, 1000);
    expect(pause(p, 2000)).toBe(p);
  });

  it('skip records status and time spent, and keeps running', () => {
    let s = start(fresh(), 0);
    s = advance(s, 4000, 'skipped');
    expect(s.index).toBe(1);
    expect(s.statuses[0]).toBe('skipped');
    expect(s.spentMs[0]).toBe(4000);
    expect(isRunning(s)).toBe(true);
    expect(cardElapsed(s, 5000)).toBe(1000);
  });

  it('skipping while paused stays paused', () => {
    let s = pause(start(fresh(), 0), 2000);
    s = advance(s, 9000, 'skipped');
    expect(isRunning(s)).toBe(false);
    expect(s.spentMs[0]).toBe(2000);
  });

  it('tick auto-completes a card when its time is up', () => {
    let s = start(fresh(), 0);
    s = tick(s, 9_999);
    expect(s.index).toBe(0);
    s = tick(s, 10_500);
    expect(s.index).toBe(1);
    expect(s.statuses[0]).toBe('done');
    expect(s.spentMs[0]).toBe(10_000);
    // The 500 ms overflow carries into the next card.
    expect(cardElapsed(s, 10_500)).toBe(500);
  });

  it('tick catches up across several cards after the tab sleeps', () => {
    let s = start(fresh(), 0);
    s = tick(s, 35_000); // A (10 s) and B (20 s) are over
    expect(s.index).toBe(2);
    expect(s.spentMs.slice(0, 2)).toEqual([10_000, 20_000]);
    expect(cardElapsed(s, 35_000)).toBe(5000);
    s = tick(s, 1_000_000);
    expect(isFinished(s)).toBe(true);
    expect(s.finishedAt).toBe(60_000);
    expect(s.spentMs).toEqual(durations);
  });

  it('tick does nothing while paused', () => {
    const s = pause(start(fresh(), 0), 1000);
    expect(tick(s, 999_999)).toBe(s);
  });

  it('finishes after the last card and reports totals', () => {
    let s = start(fresh(), 0);
    s = advance(s, 10_000, 'done');
    s = advance(s, 15_000, 'skipped');
    s = advance(s, 45_000, 'done');
    expect(isFinished(s)).toBe(true);
    expect(isRunning(s)).toBe(false);
    expect(advance(s, 50_000, 'done')).toBe(s);
    expect(totals(s)).toEqual({ done: 2, skipped: 1, total: 3, activeMs: 10_000 + 5_000 + 30_000 });
  });

  it('cannot start an empty routine', () => {
    const s = createSession([], []);
    expect(start(s, 0)).toBe(s);
  });
});

describe('isSession', () => {
  it('accepts a real session and rejects junk', () => {
    expect(isSession(JSON.parse(JSON.stringify(start(fresh(), 0))))).toBe(true);
    expect(isSession(null)).toBe(false);
    expect(isSession({ items: [] })).toBe(false);
    expect(isSession({ ...fresh(), durationsMs: [1] })).toBe(false);
  });
});
