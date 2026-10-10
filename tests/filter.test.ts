import { describe, expect, it } from 'vitest';
import realData from '../src/data/exercises.json';
import {
  EMPTY_FILTER,
  facets,
  filterExercises,
  filterFromParams,
  filterToParams,
  tokenize,
  type FilterState,
} from '../src/lib/filter.ts';
import type { Exercise } from '../src/types.ts';
import { makeExercise } from './helpers.ts';

const exercises: Exercise[] = [
  makeExercise({ id: 'Barbell_Bench_Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], equipment: 'barbell' }),
  makeExercise({ id: 'Close-Grip_Push-Up', name: 'Close-Grip Push-Up', primaryMuscles: ['triceps'], secondaryMuscles: ['chest'] }),
  makeExercise({ id: 'Dumbbell_Curl', primaryMuscles: ['biceps'], equipment: 'dumbbell' }),
  makeExercise({ id: 'Pectoral_Stretch', primaryMuscles: ['chest'], category: 'stretching' }),
  makeExercise({ id: 'Push-Up', name: 'Push-Up', primaryMuscles: ['chest'] }),
  makeExercise({ id: 'Crème_Brûlée_Squat', name: 'Crème Brûlée Squat', primaryMuscles: ['quadriceps'], equipment: 'dumbbell' }),
];

const f = (partial: Partial<FilterState>): FilterState => ({ ...EMPTY_FILTER, ...partial });
const ids = (list: Exercise[]) => list.map((e) => e.id);

describe('tokenize', () => {
  it('lowercases, strips accents and splits on punctuation', () => {
    expect(tokenize('  Crème-Brûlée  SQUAT/3 ')).toEqual(['creme', 'brulee', 'squat', '3']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('filterExercises', () => {
  it('returns everything, in order, for an empty filter', () => {
    expect(ids(filterExercises(exercises, EMPTY_FILTER))).toEqual(ids(exercises));
  });

  it('filters by primary muscle only', () => {
    // Close-Grip Push-Up works chest as a secondary muscle, so it is not included.
    expect(ids(filterExercises(exercises, f({ muscle: 'chest' })))).toEqual(['Barbell_Bench_Press', 'Pectoral_Stretch', 'Push-Up']);
  });

  it('filters by equipment', () => {
    expect(ids(filterExercises(exercises, f({ equipment: 'dumbbell' })))).toEqual(['Dumbbell_Curl', 'Crème_Brûlée_Squat']);
  });

  it('combines muscle, equipment and search', () => {
    expect(ids(filterExercises(exercises, f({ muscle: 'chest', equipment: 'body only', query: 'push' })))).toEqual(['Push-Up']);
  });

  it('matches every search token (AND)', () => {
    expect(ids(filterExercises(exercises, f({ query: 'push grip' })))).toEqual(['Close-Grip_Push-Up']);
    expect(ids(filterExercises(exercises, f({ query: 'push nothing' })))).toEqual([]);
  });

  it('matches hyphenated names written without separators', () => {
    expect(ids(filterExercises(exercises, f({ query: 'pushup' })))).toContain('Push-Up');
  });

  it('ignores accents and case', () => {
    expect(ids(filterExercises(exercises, f({ query: 'CREME brulee' })))).toEqual(['Crème_Brûlée_Squat']);
  });

  it('ranks name-prefix matches, then name matches, then muscle/equipment matches', () => {
    expect(ids(filterExercises(exercises, f({ query: 'push' })))).toEqual(['Push-Up', 'Close-Grip_Push-Up']);
    // "chest" matches names and muscles; the name match comes first.
    expect(ids(filterExercises(exercises, f({ query: 'pectoral' })))).toEqual(['Pectoral_Stretch']);
    expect(ids(filterExercises(exercises, f({ query: 'chest' })))).toEqual([
      'Barbell_Bench_Press',
      'Close-Grip_Push-Up',
      'Pectoral_Stretch',
      'Push-Up',
    ]);
  });

  it('searches equipment and category words', () => {
    expect(ids(filterExercises(exercises, f({ query: 'barbell' })))).toEqual(['Barbell_Bench_Press']);
    expect(ids(filterExercises(exercises, f({ query: 'stretching' })))).toEqual(['Pectoral_Stretch']);
  });

  it('filters by routine inclusion status', () => {
    const excluded = new Set(['Push-Up', 'Dumbbell_Curl']);
    expect(ids(filterExercises(exercises, f({ status: 'excluded' }), excluded))).toEqual(['Dumbbell_Curl', 'Push-Up']);
    expect(filterExercises(exercises, f({ status: 'included' }), excluded)).toHaveLength(exercises.length - 2);
    expect(filterExercises(exercises, f({ status: 'all' }), excluded)).toHaveLength(exercises.length);
  });

  it('treats whitespace-only queries as empty', () => {
    expect(filterExercises(exercises, f({ query: '   ' }))).toHaveLength(exercises.length);
  });

  it('does not mutate its input', () => {
    const copy = exercises.slice();
    filterExercises(exercises, f({ query: 'push' }));
    expect(exercises).toEqual(copy);
  });
});

describe('facets', () => {
  it('counts primary muscles and equipment, sorted alphabetically', () => {
    const { muscles, equipment } = facets(exercises);
    expect(muscles).toEqual([
      { value: 'biceps', count: 1 },
      { value: 'chest', count: 3 },
      { value: 'quadriceps', count: 1 },
      { value: 'triceps', count: 1 },
    ]);
    expect(equipment).toEqual([
      { value: 'barbell', count: 1 },
      { value: 'body only', count: 3 },
      { value: 'dumbbell', count: 2 },
    ]);
  });
});

describe('URL params', () => {
  it('round-trips a filter', () => {
    const state = f({ query: 'bench press', muscle: 'chest', equipment: 'barbell', status: 'excluded' });
    expect(filterFromParams(filterToParams(state))).toEqual(state);
  });

  it('omits defaults', () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe('');
  });

  it('ignores unknown status values', () => {
    expect(filterFromParams(new URLSearchParams('show=bogus')).status).toBe('all');
  });
});

describe('with the vendored dataset', () => {
  const data = realData as Exercise[];

  it('every muscle filter result has that primary muscle, and facets add up', () => {
    for (const { value, count } of facets(data).muscles) {
      const result = filterExercises(data, f({ muscle: value }));
      expect(result).toHaveLength(count);
      expect(result.every((e) => e.primaryMuscles.includes(value))).toBe(true);
    }
  });

  it('every equipment filter result uses that equipment', () => {
    for (const { value, count } of facets(data).equipment) {
      const result = filterExercises(data, f({ equipment: value }));
      expect(result).toHaveLength(count);
      expect(result.every((e) => e.equipment === value)).toBe(true);
    }
  });

  it('finds well-known exercises by name', () => {
    expect(filterExercises(data, f({ query: 'barbell squat' }))[0].name).toMatch(/^Barbell Squat/);
    expect(filterExercises(data, f({ query: 'pushups' })).length).toBeGreaterThan(0);
  });
});
