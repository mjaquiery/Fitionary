import { BODYWEIGHT, IMAGE_BASE } from '../src/constants.ts';
import type { DefaultReps, Exercise } from '../src/types.ts';

export { BODYWEIGHT, IMAGE_BASE };

/** Shape of one record in Free Exercise DB's dist/exercises.json (fields may be null or missing). */
export interface RawExercise {
  id?: unknown;
  name?: unknown;
  force?: unknown;
  level?: unknown;
  mechanic?: unknown;
  equipment?: unknown;
  primaryMuscles?: unknown;
  secondaryMuscles?: unknown;
  instructions?: unknown;
  category?: unknown;
  images?: unknown;
}

/**
 * Suggested sets/reps by category, then force. Mirrors the table in README.md;
 * keep the two in sync. `default` applies when the force has no specific entry
 * (including a null force).
 */
export const REP_RULES: Record<string, Partial<Record<string, DefaultReps>> & { default: DefaultReps }> = {
  strength: { default: { sets: 3, reps: '8-12' }, static: { sets: 3, reps: '30s hold' } },
  powerlifting: { default: { sets: 5, reps: '3-5' } },
  'olympic weightlifting': { default: { sets: 5, reps: '2-3' } },
  strongman: {
    default: { sets: 3, reps: '3-5' },
    static: { sets: 3, reps: '30s hold' },
    // Upstream's null-force strongman moves are carries/walks (Farmer's Walk, Yoke Walk, …).
    none: { sets: 3, reps: '30s carry' },
  },
  plyometrics: { default: { sets: 3, reps: '5-8' }, static: { sets: 3, reps: '20s hold' } },
  stretching: { default: { sets: 2, reps: '30s hold' } },
  cardio: { default: { sets: 1, reps: '10 min' } },
};

export const FALLBACK_REPS: DefaultReps = { sets: 3, reps: '8-12' };

export function defaultRepsFor(category: string, force: string | null): DefaultReps {
  const rule = REP_RULES[category];
  if (!rule) return { ...FALLBACK_REPS };
  const byForce = rule[force ?? 'none'];
  return { ...(byForce ?? rule.default) };
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanLower(value: unknown): string {
  return cleanString(value).toLowerCase();
}

/** Trimmed, lowercased, de-duplicated, empty entries removed; order preserved. */
function cleanList(value: unknown, lower: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = lower ? cleanLower(item) : cleanString(item);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export class NormalizeError extends Error {}

/**
 * Convert one upstream record to the app schema. Throws NormalizeError when
 * the record lacks an id or name (those can't be displayed or linked to).
 */
export function normalizeExercise(raw: RawExercise): Exercise {
  const id = cleanString(raw.id);
  const name = cleanString(raw.name);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new NormalizeError(`Invalid or missing id: ${JSON.stringify(raw.id)}`);
  }
  if (!name) throw new NormalizeError(`Exercise ${id} has no name`);

  const category = cleanLower(raw.category) || 'strength';
  const force = cleanLower(raw.force) || null;
  const primaryMuscles = cleanList(raw.primaryMuscles, true);
  const secondaryMuscles = cleanList(raw.secondaryMuscles, true).filter((m) => !primaryMuscles.includes(m));

  const images = cleanList(raw.images, false)
    .map((p) => p.replace(/^\/+/, ''))
    // Reject anything that could escape public/exercises/ when copied.
    .filter((p) => !p.split('/').includes('..') && /\.(jpe?g|png|webp|gif)$/i.test(p))
    .map((p) => IMAGE_BASE + p);

  return {
    id,
    name,
    primaryMuscles,
    secondaryMuscles,
    equipment: cleanLower(raw.equipment) || BODYWEIGHT,
    level: cleanLower(raw.level) || 'beginner',
    category,
    instructions: cleanList(raw.instructions, false),
    images,
    defaultReps: defaultRepsFor(category, force),
  };
}

export interface NormalizeResult {
  exercises: Exercise[];
  /** Human-readable reasons for records that were dropped. */
  skipped: string[];
}

/** Normalize a whole upstream file: drops invalid records and duplicate ids, sorts by name. */
export function normalizeAll(raw: unknown): NormalizeResult {
  if (!Array.isArray(raw)) throw new NormalizeError('Expected exercises.json to contain an array');
  const seen = new Set<string>();
  const exercises: Exercise[] = [];
  const skipped: string[] = [];
  for (const record of raw) {
    if (!record || typeof record !== 'object') {
      skipped.push('Non-object record');
      continue;
    }
    try {
      const ex = normalizeExercise(record as RawExercise);
      if (seen.has(ex.id)) {
        skipped.push(`Duplicate id ${ex.id}`);
        continue;
      }
      seen.add(ex.id);
      exercises.push(ex);
    } catch (err) {
      if (!(err instanceof NormalizeError)) throw err;
      skipped.push(err.message);
    }
  }
  exercises.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  return { exercises, skipped };
}

/** Map a normalized image path back to its location relative to the upstream exercises/ folder. */
export function upstreamImagePath(imagePath: string): string {
  if (!imagePath.startsWith(IMAGE_BASE)) throw new Error(`Unexpected image path: ${imagePath}`);
  return imagePath.slice(IMAGE_BASE.length);
}
