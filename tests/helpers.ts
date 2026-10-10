import type { Exercise } from '../src/types.ts';

export function makeExercise(overrides: Partial<Exercise> & Pick<Exercise, 'id'>): Exercise {
  return {
    name: overrides.id.replace(/_/g, ' '),
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'body only',
    level: 'beginner',
    category: 'strength',
    instructions: ['Do it.'],
    images: [`/exercises/${overrides.id}/0.jpg`],
    defaultReps: { sets: 3, reps: '8-12' },
    ...overrides,
  };
}
