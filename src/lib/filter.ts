import type { Exercise } from '../types.ts';

export type StatusFilter = 'all' | 'included' | 'excluded';

export interface FilterState {
  query: string;
  /** Primary muscle group; empty string means any. */
  muscle: string;
  /** Equipment; empty string means any. */
  equipment: string;
  /** Whether to show exercises included in or excluded from routines. */
  status: StatusFilter;
}

export const EMPTY_FILTER: FilterState = { query: '', muscle: '', equipment: '', status: 'all' };

/** Lowercase, strip accents, split on anything that isn't a letter or digit. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

interface SearchIndex {
  name: string;
  /** Name plus muscles, equipment and category; includes a no-space copy of the name so "pushup" finds "Push-Up". */
  all: string;
}

const indexCache = new WeakMap<Exercise, SearchIndex>();

function searchIndex(ex: Exercise): SearchIndex {
  let idx = indexCache.get(ex);
  if (!idx) {
    const nameTokens = tokenize(ex.name);
    const name = nameTokens.join(' ');
    const rest = tokenize([...ex.primaryMuscles, ...ex.secondaryMuscles, ex.equipment, ex.category].join(' '));
    idx = { name, all: [name, nameTokens.join(''), ...rest].join(' ') };
    indexCache.set(ex, idx);
  }
  return idx;
}

/**
 * Apply the filter. Search is an AND of substring matches over each token.
 * Results keep the input order (alphabetical), except that exercises whose name
 * starts with the query come first, then those whose name contains every token,
 * then muscle/equipment-only matches.
 */
export function filterExercises(
  exercises: readonly Exercise[],
  filter: FilterState,
  excluded: ReadonlySet<string> = new Set(),
): Exercise[] {
  const tokens = tokenize(filter.query);
  const phrase = tokens.join(' ');
  const scored: Array<{ ex: Exercise; score: number; i: number }> = [];

  exercises.forEach((ex, i) => {
    if (filter.muscle && !ex.primaryMuscles.includes(filter.muscle)) return;
    if (filter.equipment && ex.equipment !== filter.equipment) return;
    if (filter.status === 'included' && excluded.has(ex.id)) return;
    if (filter.status === 'excluded' && !excluded.has(ex.id)) return;
    let score = 0;
    if (tokens.length) {
      const idx = searchIndex(ex);
      if (!tokens.every((t) => idx.all.includes(t))) return;
      score = idx.name.startsWith(phrase) ? 0 : tokens.every((t) => idx.name.includes(t)) ? 1 : 2;
    }
    scored.push({ ex, score, i });
  });

  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.map((s) => s.ex);
}

export interface FacetOption {
  value: string;
  count: number;
}

function countBy(values: Iterable<string>): FacetOption[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, 'en'));
}

/** Dropdown options with how many exercises have each value. */
export function facets(exercises: readonly Exercise[]): { muscles: FacetOption[]; equipment: FacetOption[] } {
  return {
    muscles: countBy(exercises.flatMap((ex) => ex.primaryMuscles)),
    equipment: countBy(exercises.map((ex) => ex.equipment)),
  };
}

const STATUSES: readonly StatusFilter[] = ['all', 'included', 'excluded'];

export function filterFromParams(params: URLSearchParams): FilterState {
  const status = params.get('show') as StatusFilter | null;
  return {
    query: params.get('q') ?? '',
    muscle: params.get('muscle') ?? '',
    equipment: params.get('equipment') ?? '',
    status: status && STATUSES.includes(status) ? status : 'all',
  };
}

/** Inverse of filterFromParams; omits defaults so the URL stays short. */
export function filterToParams(filter: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.query.trim()) params.set('q', filter.query.trim());
  if (filter.muscle) params.set('muscle', filter.muscle);
  if (filter.equipment) params.set('equipment', filter.equipment);
  if (filter.status !== 'all') params.set('show', filter.status);
  return params;
}
