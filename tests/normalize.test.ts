import { describe, expect, it } from 'vitest';
import {
  BODYWEIGHT,
  FALLBACK_REPS,
  NormalizeError,
  defaultRepsFor,
  normalizeAll,
  normalizeExercise,
  upstreamImagePath,
  type RawExercise,
} from '../scripts/normalize.ts';

/** The example record from the Free Exercise DB README. */
const README_EXAMPLE: RawExercise = {
  id: 'Alternate_Incline_Dumbbell_Curl',
  name: 'Alternate Incline Dumbbell Curl',
  force: 'pull',
  level: 'beginner',
  mechanic: 'isolation',
  equipment: 'dumbbell',
  primaryMuscles: ['biceps'],
  secondaryMuscles: ['forearms'],
  instructions: ['Sit down on an incline bench with a dumbbell in each hand being held at arms length.'],
  category: 'strength',
  images: ['Alternate_Incline_Dumbbell_Curl/0.jpg', 'Alternate_Incline_Dumbbell_Curl/1.jpg'],
};

describe('defaultRepsFor', () => {
  it.each([
    ['strength', 'push', 3, '8-12'],
    ['strength', 'pull', 3, '8-12'],
    ['strength', null, 3, '8-12'],
    ['strength', 'static', 3, '30s hold'],
    ['stretching', 'static', 2, '30s hold'],
    ['stretching', 'pull', 2, '30s hold'],
    ['powerlifting', 'push', 5, '3-5'],
    ['olympic weightlifting', 'pull', 5, '2-3'],
    ['strongman', 'pull', 3, '3-5'],
    ['strongman', 'static', 3, '30s hold'],
    ['strongman', null, 3, '30s carry'],
    ['plyometrics', 'push', 3, '5-8'],
    ['plyometrics', 'static', 3, '20s hold'],
    ['cardio', null, 1, '10 min'],
    ['cardio', 'push', 1, '10 min'],
  ] as const)('%s / %s → %i × %s', (category, force, sets, reps) => {
    expect(defaultRepsFor(category, force)).toEqual({ sets, reps });
  });

  it('falls back for unknown categories', () => {
    expect(defaultRepsFor('yoga', 'push')).toEqual(FALLBACK_REPS);
  });

  it('returns a fresh object each call', () => {
    const a = defaultRepsFor('strength', 'push');
    a.sets = 99;
    expect(defaultRepsFor('strength', 'push').sets).toBe(3);
  });
});

describe('normalizeExercise', () => {
  it('maps the README example to the app schema', () => {
    expect(normalizeExercise(README_EXAMPLE)).toEqual({
      id: 'Alternate_Incline_Dumbbell_Curl',
      name: 'Alternate Incline Dumbbell Curl',
      primaryMuscles: ['biceps'],
      secondaryMuscles: ['forearms'],
      equipment: 'dumbbell',
      level: 'beginner',
      category: 'strength',
      instructions: ['Sit down on an incline bench with a dumbbell in each hand being held at arms length.'],
      images: ['/exercises/Alternate_Incline_Dumbbell_Curl/0.jpg', '/exercises/Alternate_Incline_Dumbbell_Curl/1.jpg'],
      defaultReps: { sets: 3, reps: '8-12' },
    });
  });

  it('drops fields outside the schema', () => {
    const ex = normalizeExercise(README_EXAMPLE) as unknown as Record<string, unknown>;
    expect(Object.keys(ex).sort()).toEqual(
      ['category', 'defaultReps', 'equipment', 'id', 'images', 'instructions', 'level', 'name', 'primaryMuscles', 'secondaryMuscles'],
    );
  });

  it('treats null equipment as bodyweight', () => {
    expect(normalizeExercise({ ...README_EXAMPLE, equipment: null }).equipment).toBe(BODYWEIGHT);
  });

  it('cleans whitespace and case, and de-duplicates muscles', () => {
    const ex = normalizeExercise({
      ...README_EXAMPLE,
      name: '  Curl   Thing ',
      equipment: ' Dumbbell ',
      primaryMuscles: ['Biceps', ' biceps', ''],
      secondaryMuscles: ['FOREARMS', 'biceps', null],
      level: 'Beginner',
      category: 'Strength',
    });
    expect(ex.name).toBe('Curl Thing');
    expect(ex.equipment).toBe('dumbbell');
    expect(ex.primaryMuscles).toEqual(['biceps']);
    // Secondary muscles that repeat a primary one are removed.
    expect(ex.secondaryMuscles).toEqual(['forearms']);
    expect(ex.level).toBe('beginner');
    expect(ex.category).toBe('strength');
  });

  it('removes blank instruction steps and keeps order', () => {
    const ex = normalizeExercise({ ...README_EXAMPLE, instructions: ['  Step one. ', '', '   ', 'Step two.'] });
    expect(ex.instructions).toEqual(['Step one.', 'Step two.']);
  });

  it('handles missing arrays', () => {
    const ex = normalizeExercise({ id: 'X', name: 'X' });
    expect(ex).toMatchObject({
      primaryMuscles: [],
      secondaryMuscles: [],
      instructions: [],
      images: [],
      equipment: BODYWEIGHT,
      level: 'beginner',
      category: 'strength',
      defaultReps: { sets: 3, reps: '8-12' },
    });
  });

  it('rejects image paths that could escape the images folder or are not images', () => {
    const ex = normalizeExercise({
      ...README_EXAMPLE,
      images: ['../../etc/passwd.jpg', 'A/../../x.jpg', 'A/0.txt', '/A/1.jpg', 'A/2.JPG'],
    });
    expect(ex.images).toEqual(['/exercises/A/1.jpg', '/exercises/A/2.JPG']);
  });

  it('derives defaultReps from category and force', () => {
    expect(normalizeExercise({ ...README_EXAMPLE, category: 'stretching', force: 'static' }).defaultReps).toEqual({
      sets: 2,
      reps: '30s hold',
    });
  });

  it.each([
    [{ name: 'No id' }],
    [{ id: '', name: 'Empty id' }],
    [{ id: 'bad id/with slash', name: 'Bad' }],
    [{ id: 'No_Name' }],
    [{ id: 'Blank_Name', name: '   ' }],
  ])('throws NormalizeError for %j', (raw) => {
    expect(() => normalizeExercise(raw)).toThrow(NormalizeError);
  });
});

describe('normalizeAll', () => {
  it('rejects non-array input', () => {
    expect(() => normalizeAll({ exercises: [] })).toThrow(NormalizeError);
  });

  it('sorts by name, drops invalid records and duplicate ids', () => {
    const { exercises, skipped } = normalizeAll([
      { id: 'b', name: 'Bravo' },
      null,
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo again' },
      { name: 'No id' },
      'nonsense',
    ]);
    expect(exercises.map((e) => e.id)).toEqual(['a', 'b']);
    expect(exercises[1].name).toBe('Bravo');
    expect(skipped).toHaveLength(4);
    expect(skipped.some((s) => s.includes('Duplicate id b'))).toBe(true);
  });
});

describe('upstreamImagePath', () => {
  it('strips the site prefix', () => {
    expect(upstreamImagePath('/exercises/Air_Bike/0.jpg')).toBe('Air_Bike/0.jpg');
  });

  it('rejects other paths', () => {
    expect(() => upstreamImagePath('/elsewhere/a.jpg')).toThrow();
  });
});
