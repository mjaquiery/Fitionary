import { describe, expect, it } from 'vitest';
import realData from '../src/data/exercises.json';
import {
  DEFAULT_ROUTINE_OPTIONS,
  MAIN_CATEGORIES,
  exerciseSeconds,
  generateRoutine,
  routineSeconds,
  type GenerateContext,
  type RoutineOptions,
} from '../src/lib/routine.ts';
import type { Exercise } from '../src/types.ts';
import { makeExercise } from './helpers.ts';

const data = realData as Exercise[];
const byId = new Map(data.map((e) => [e.id, e]));
const ctx = (overrides: Partial<GenerateContext> = {}): GenerateContext => ({
  excluded: new Set(),
  repsFor: (ex) => ex.defaultReps,
  seed: 42,
  ...overrides,
});
const opts = (overrides: Partial<RoutineOptions> = {}): RoutineOptions => ({ ...DEFAULT_ROUTINE_OPTIONS, ...overrides });
const exercisesOf = (items: { id: string }[]) => items.map((i) => byId.get(i.id)!);

describe('generateRoutine with the vendored dataset', () => {
  it.each([10, 20, 30, 45, 60, 90])('lands roughly on %i minutes', (minutes) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = generateRoutine(data, opts({ minutes, equipment: ['dumbbell', 'barbell'] }), ctx({ seed }));
      expect(r.warnings).toEqual([]);
      expect(r.plannedSeconds).toBe(routineSeconds(r.items, byId));
      // Within ~2.5 minutes or 15% of the target, whichever is larger.
      const tolerance = Math.max(150, minutes * 60 * 0.15);
      expect(Math.abs(r.plannedSeconds - minutes * 60)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('only uses available equipment (bodyweight always allowed)', () => {
    const r = generateRoutine(data, opts({ minutes: 60, equipment: ['kettlebells'] }), ctx());
    expect(exercisesOf(r.items).every((e) => ['kettlebells', 'body only'].includes(e.equipment))).toBe(true);
  });

  it('never includes excluded exercises', () => {
    const first = generateRoutine(data, opts(), ctx());
    const excluded = new Set(first.items.map((i) => i.id));
    const second = generateRoutine(data, opts(), ctx({ excluded }));
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.items.some((i) => excluded.has(i.id))).toBe(false);
  });

  it('respects max level', () => {
    const r = generateRoutine(data, opts({ minutes: 60, maxLevel: 'beginner' }), ctx());
    expect(exercisesOf(r.items).every((e) => e.level === 'beginner')).toBe(true);
  });

  it('restricts the main block to chosen categories and focus muscles', () => {
    const r = generateRoutine(
      data,
      opts({ minutes: 45, equipment: ['dumbbell'], categories: ['strength'], focusMuscles: ['biceps', 'triceps'] }),
      ctx(),
    );
    const main = exercisesOf(r.items.filter((i) => i.block === 'main'));
    expect(main.length).toBeGreaterThan(2);
    expect(main.every((e) => e.category === 'strength')).toBe(true);
    expect(main.every((e) => e.primaryMuscles.some((m) => m === 'biceps' || m === 'triceps'))).toBe(true);
  });

  it('puts stretches in warm-up and cool-down blocks, in order', () => {
    const r = generateRoutine(data, opts({ minutes: 40 }), ctx());
    const blocks = r.items.map((i) => i.block);
    expect(blocks[0]).toBe('warmup');
    expect(blocks.at(-1)).toBe('cooldown');
    expect(blocks).toEqual([...blocks].sort((a, b) => ['warmup', 'main', 'cooldown'].indexOf(a) - ['warmup', 'main', 'cooldown'].indexOf(b)));
    for (const item of r.items) {
      expect(byId.get(item.id)!.category === 'stretching').toBe(item.block !== 'main');
    }
    // No exercise appears twice.
    expect(new Set(r.items.map((i) => i.id)).size).toBe(r.items.length);
  });

  it('can skip warm-up and cool-down', () => {
    const r = generateRoutine(data, opts({ warmupCooldown: false }), ctx());
    expect(r.items.every((i) => i.block === 'main')).toBe(true);
  });

  it('spreads the main block across muscle groups', () => {
    const r = generateRoutine(data, opts({ minutes: 60, equipment: ['dumbbell', 'barbell', 'cable'] }), ctx());
    const muscles = exercisesOf(r.items.filter((i) => i.block === 'main')).map((e) => e.primaryMuscles[0]);
    expect(new Set(muscles).size).toBeGreaterThanOrEqual(Math.min(muscles.length, 8));
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = generateRoutine(data, opts(), ctx({ seed: 7 }));
    const b = generateRoutine(data, opts(), ctx({ seed: 7 }));
    const c = generateRoutine(data, opts(), ctx({ seed: 8 }));
    expect(a.items).toEqual(b.items);
    expect(a.items).not.toEqual(c.items);
  });

  it('uses the sets/reps from repsFor (user overrides)', () => {
    const r = generateRoutine(data, opts(), ctx({ repsFor: () => ({ sets: 2, reps: '15' }) }));
    expect(r.items.every((i) => i.sets === 2 && i.reps === '15')).toBe(true);
  });

  it('covers every main category without errors', () => {
    for (const category of MAIN_CATEGORIES) {
      const r = generateRoutine(data, opts({ minutes: 60, categories: [category], equipment: ['other', 'machine', 'barbell'], maxLevel: 'expert' }), ctx());
      expect(r.items.filter((i) => i.block === 'main').length).toBeGreaterThan(0);
    }
  });
});

describe('generateRoutine edge cases', () => {
  it('warns and returns nothing when no exercise matches', () => {
    const r = generateRoutine(data, opts({ equipment: [], categories: ['cardio'], maxLevel: 'beginner', focusMuscles: ['neck'] }), ctx());
    expect(r.items).toEqual([]);
    expect(r.warnings[0]).toMatch(/No exercises match/);
  });

  it('returns at least one exercise when the budget is smaller than any exercise', () => {
    const long = makeExercise({ id: 'Long', defaultReps: { sets: 1, reps: '20 min' }, category: 'cardio' });
    const r = generateRoutine([long], opts({ minutes: 5, categories: ['cardio'], warmupCooldown: false }), ctx());
    expect(r.items.map((i) => i.id)).toEqual(['Long']);
    expect(r.plannedSeconds).toBe(exerciseSeconds(long, 1, '20 min'));
  });

  it('warns when there is not enough material for the requested time', () => {
    const few = [makeExercise({ id: 'A' }), makeExercise({ id: 'B', primaryMuscles: ['lats'] })];
    const r = generateRoutine(few, opts({ minutes: 60, warmupCooldown: false }), ctx());
    expect(r.items).toHaveLength(2);
    expect(r.warnings.some((w) => /Only about/.test(w))).toBe(true);
  });

  it('warns when warm-up is wanted but no stretches are available', () => {
    const r = generateRoutine([makeExercise({ id: 'A' })], opts({ minutes: 5 }), ctx());
    expect(r.warnings.some((w) => /No stretches/.test(w))).toBe(true);
  });
});
