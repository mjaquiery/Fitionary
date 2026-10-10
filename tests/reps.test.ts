import { describe, expect, it } from 'vitest';
import { TIMING, clampSets, parseReps, phaseAt, planPhases, totalSeconds } from '../src/lib/reps.ts';

describe('parseReps', () => {
  it.each([
    ['8-12', { kind: 'reps', count: 10 }],
    ['3-5', { kind: 'reps', count: 4 }],
    ['5', { kind: 'reps', count: 5 }],
    ['8 to 12 reps', { kind: 'reps', count: 10 }],
    ['10–15', { kind: 'reps', count: 13 }],
    ['30s hold', { kind: 'time', seconds: 30 }],
    ['30s carry', { kind: 'time', seconds: 30 }],
    ['30-60s', { kind: 'time', seconds: 45 }],
    ['45 sec', { kind: 'time', seconds: 45 }],
    ['20 seconds', { kind: 'time', seconds: 20 }],
    ['10 min', { kind: 'time', seconds: 600 }],
    ['1.5 minutes', { kind: 'time', seconds: 90 }],
    ['AMRAP', { kind: 'reps', count: 10 }],
    ['', { kind: 'reps', count: 10 }],
    ['1000', { kind: 'reps', count: 100 }],
  ])('%j → %j', (input, expected) => {
    expect(parseReps(input)).toEqual(expected);
  });
});

describe('clampSets', () => {
  it('rounds and bounds sets to 1–10', () => {
    expect(clampSets(0)).toBe(1);
    expect(clampSets(2.6)).toBe(3);
    expect(clampSets(50)).toBe(10);
    expect(clampSets(Number.NaN)).toBe(1);
  });
});

describe('planPhases', () => {
  it('builds get-ready, sets and rests for a strength exercise', () => {
    const phases = planPhases(3, '8-12', 'strength');
    expect(phases.map((p) => [p.kind, p.label, p.seconds])).toEqual([
      ['ready', 'Get ready', TIMING.readySeconds],
      ['work', 'Set 1 of 3', 30],
      ['rest', 'Rest', 60],
      ['work', 'Set 2 of 3', 30],
      ['rest', 'Rest', 60],
      ['work', 'Set 3 of 3', 30],
    ]);
    expect(totalSeconds(phases)).toBe(15 + 90 + 120);
  });

  it('uses hold time for timed sets and short rests for stretches', () => {
    const phases = planPhases(2, '30s hold', 'stretching');
    expect(totalSeconds(phases)).toBe(15 + 30 + 10 + 30);
  });

  it('labels a single set "Go" and has no rests', () => {
    const phases = planPhases(1, '10 min', 'cardio');
    expect(phases.map((p) => p.label)).toEqual(['Get ready', 'Go']);
    expect(totalSeconds(phases)).toBe(615);
  });

  it('uses longer rests for heavy lifting', () => {
    expect(totalSeconds(planPhases(5, '3-5', 'powerlifting'))).toBe(15 + 5 * 16 + 4 * 120);
  });
});

describe('phaseAt', () => {
  const phases = planPhases(2, '10', 'strength'); // ready 15, work 30, rest 60, work 30

  it('finds the active phase and time left in it', () => {
    expect(phaseAt(phases, 0)).toMatchObject({ index: 0, remaining: 15 });
    expect(phaseAt(phases, 14.5)).toMatchObject({ index: 0, remaining: 0.5 });
    expect(phaseAt(phases, 15)).toMatchObject({ index: 1, remaining: 30 });
    expect(phaseAt(phases, 50)).toMatchObject({ index: 2, phase: { kind: 'rest' }, remaining: 55 });
    expect(phaseAt(phases, 130)).toMatchObject({ index: 3, remaining: 5 });
  });

  it('clamps to the last phase when time is up', () => {
    expect(phaseAt(phases, 999)).toMatchObject({ index: 3, remaining: 0 });
  });
});
