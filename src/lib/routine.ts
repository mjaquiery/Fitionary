import { BODYWEIGHT } from '../constants.ts';
import type { DefaultReps, Exercise } from '../types.ts';
import { mulberry32, shuffle } from './random.ts';
import { planPhases, totalSeconds } from './reps.ts';

export const LEVELS = ['beginner', 'intermediate', 'expert'] as const;
export const MAIN_CATEGORIES = ['strength', 'plyometrics', 'powerlifting', 'olympic weightlifting', 'strongman', 'cardio'] as const;
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 120;

export interface RoutineOptions {
  minutes: number;
  /** Equipment the user has. Bodyweight exercises are always allowed. */
  equipment: string[];
  maxLevel: string;
  /** Categories allowed in the main block (stretching is handled by warm-up/cool-down). */
  categories: string[];
  /** Restrict the main block to these primary muscles; empty means any. */
  focusMuscles: string[];
  warmupCooldown: boolean;
}

export const DEFAULT_ROUTINE_OPTIONS: RoutineOptions = {
  minutes: 30,
  equipment: [BODYWEIGHT],
  maxLevel: 'intermediate',
  categories: ['strength', 'plyometrics'],
  focusMuscles: [],
  warmupCooldown: true,
};

export type Block = 'warmup' | 'main' | 'cooldown';

export interface RoutineItem {
  id: string;
  sets: number;
  reps: string;
  block: Block;
}

export interface GenerateContext {
  /** Exercise ids the user excluded from routines. */
  excluded: ReadonlySet<string>;
  /** Sets/reps to use for an exercise (the user's override or its default). */
  repsFor: (ex: Exercise) => DefaultReps;
  seed?: number;
}

export interface GenerateResult {
  items: RoutineItem[];
  plannedSeconds: number;
  warnings: string[];
}

export function exerciseSeconds(ex: Exercise, sets: number, reps: string): number {
  return totalSeconds(planPhases(sets, reps, ex.category));
}

export function routineSeconds(items: readonly RoutineItem[], byId: ReadonlyMap<string, Exercise>): number {
  return items.reduce((sum, item) => {
    const ex = byId.get(item.id);
    return ex ? sum + exerciseSeconds(ex, item.sets, item.reps) : sum;
  }, 0);
}

function levelRank(level: string): number {
  const i = (LEVELS as readonly string[]).indexOf(level);
  return i === -1 ? LEVELS.length - 1 : i;
}

/**
 * Greedy fill: take candidates in order, skipping any that would overshoot the
 * budget by more than half their own length. Keeps the total "roughly" on target.
 */
function fill<T>(candidates: readonly T[], budget: number, secondsOf: (c: T) => number): T[] {
  const picked: T[] = [];
  let total = 0;
  for (const c of candidates) {
    const s = secondsOf(c);
    if (total + s / 2 <= budget) {
      picked.push(c);
      total += s;
    }
  }
  return picked;
}

/** Interleave groups so consecutive picks hit different muscles. */
function roundRobin<T>(groups: readonly T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const g of groups) if (i < g.length) out.push(g[i]);
  return out;
}

export function generateRoutine(exercises: readonly Exercise[], options: RoutineOptions, ctx: GenerateContext): GenerateResult {
  const random = mulberry32(ctx.seed ?? Date.now());
  const warnings: string[] = [];
  const budget = Math.round(Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, options.minutes)) * 60);
  const equipment = new Set([BODYWEIGHT, ...options.equipment]);
  const maxRank = levelRank(options.maxLevel);
  const categories = new Set(options.categories);
  const focus = new Set(options.focusMuscles);

  const eligible = exercises.filter(
    (ex) => !ctx.excluded.has(ex.id) && equipment.has(ex.equipment) && levelRank(ex.level) <= maxRank,
  );
  const mainPool = eligible.filter(
    (ex) =>
      ex.category !== 'stretching' &&
      categories.has(ex.category) &&
      (focus.size === 0 || ex.primaryMuscles.some((m) => focus.has(m))),
  );
  const stretchPool = eligible.filter((ex) => ex.category === 'stretching');

  const seconds = (ex: Exercise) => {
    const r = ctx.repsFor(ex);
    return exerciseSeconds(ex, r.sets, r.reps);
  };
  const toItem = (block: Block) => (ex: Exercise): RoutineItem => {
    const r = ctx.repsFor(ex);
    return { id: ex.id, sets: r.sets, reps: r.reps, block };
  };

  if (mainPool.length === 0) {
    warnings.push('No exercises match your equipment, level, categories and focus muscles. Try widening the options.');
    return { items: [], plannedSeconds: 0, warnings };
  }

  const useStretches = options.warmupCooldown && stretchPool.length > 0;
  if (options.warmupCooldown && !useStretches) warnings.push('No stretches available for a warm-up or cool-down.');
  const stretchBudget = useStretches ? Math.min(600, Math.max(60, Math.round(budget * 0.1))) : 0;
  const mainBudget = budget - 2 * stretchBudget;

  // Main block: shuffle, group by primary muscle, interleave groups, then fill to time.
  const groups = new Map<string, Exercise[]>();
  for (const ex of shuffle(mainPool, random)) {
    const key = ex.primaryMuscles[0] ?? 'other';
    groups.set(key, [...(groups.get(key) ?? []), ex]);
  }
  let main = fill(roundRobin([...groups.values()]), mainBudget, seconds);
  if (main.length === 0) {
    // Budget smaller than any single exercise: still give the user one.
    main = [mainPool.reduce((a, b) => (seconds(b) < seconds(a) ? b : a))];
  }

  // Stretches: prefer ones that target muscles the main block works.
  let warmup: Exercise[] = [];
  let cooldown: Exercise[] = [];
  if (useStretches) {
    const worked = new Set(main.flatMap((ex) => [...ex.primaryMuscles, ...ex.secondaryMuscles]));
    const relevant = (ex: Exercise) => (ex.primaryMuscles.some((m) => worked.has(m)) ? 0 : 1);
    const stretches = shuffle(stretchPool, random).sort((a, b) => relevant(a) - relevant(b));
    warmup = fill(stretches, stretchBudget, seconds);
    const used = new Set(warmup.map((ex) => ex.id));
    cooldown = fill(stretches.filter((ex) => !used.has(ex.id)), stretchBudget, seconds);
  }

  const items = [...warmup.map(toItem('warmup')), ...main.map(toItem('main')), ...cooldown.map(toItem('cooldown'))];
  const plannedSeconds = [...warmup, ...main, ...cooldown].reduce((sum, ex) => sum + seconds(ex), 0);
  if (plannedSeconds < budget * 0.75) {
    warnings.push(`Only about ${Math.round(plannedSeconds / 60)} minutes of matching exercises are available.`);
  }
  return { items, plannedSeconds, warnings };
}
