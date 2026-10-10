import { clampSets } from './lib/reps.ts';
import { DEFAULT_ROUTINE_OPTIONS, LEVELS, MAX_MINUTES, MIN_MINUTES, type RoutineOptions } from './lib/routine.ts';
import { isRunning, isSession, pause, type Session } from './lib/session.ts';
import { isStringArray, load, remove, save } from './lib/storage.ts';
import type { DefaultReps, Exercise } from './types.ts';

type StoreEvent = 'excluded' | 'reps' | 'session';

const isRepsMap = (v: unknown): v is Record<string, DefaultReps> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.values(v).every((r) => r && typeof r === 'object' && typeof r.sets === 'number' && typeof r.reps === 'string');

const isRoutineOptions = (v: unknown): v is RoutineOptions => {
  const o = v as RoutineOptions;
  return (
    !!o &&
    typeof o.minutes === 'number' &&
    isStringArray(o.equipment) &&
    typeof o.maxLevel === 'string' &&
    isStringArray(o.categories) &&
    isStringArray(o.focusMuscles) &&
    typeof o.warmupCooldown === 'boolean'
  );
};

interface SavedSession {
  session: Session;
  savedAt: number;
}
const isSavedSession = (v: unknown): v is SavedSession =>
  !!v && typeof v === 'object' && isSession((v as SavedSession).session) && typeof (v as SavedSession).savedAt === 'number';

/** App state that outlives a page view. Everything user-specific persists to localStorage. */
class Store {
  exercises: Exercise[] = [];
  byId = new Map<string, Exercise>();
  readonly excluded = new Set<string>(load('excluded', [], isStringArray));
  private reps: Record<string, DefaultReps> = load('reps', {}, isRepsMap);
  private listeners = new Map<StoreEvent, Set<(detail?: string) => void>>();
  session: Session | null = null;

  init(exercises: Exercise[]): void {
    this.exercises = exercises;
    this.byId = new Map(exercises.map((e) => [e.id, e]));
    // Forget ids that no longer exist after a data update.
    for (const id of this.excluded) if (!this.byId.has(id)) this.excluded.delete(id);

    const saved = load<SavedSession | null>('session', null, isSavedSession);
    if (saved && saved.session.items.every((i) => this.byId.has(i.id))) {
      // A session that was running when the page closed resumes paused, at the last save.
      this.session = isRunning(saved.session) ? pause(saved.session, saved.savedAt) : saved.session;
    }
  }

  on(event: StoreEvent, fn: (detail?: string) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn);
    this.listeners.set(event, set);
    return () => set.delete(fn);
  }

  private emit(event: StoreEvent, detail?: string): void {
    this.listeners.get(event)?.forEach((fn) => fn(detail));
  }

  isExcluded(id: string): boolean {
    return this.excluded.has(id);
  }

  setExcluded(ids: readonly string[], excluded: boolean): void {
    for (const id of ids) {
      if (excluded) this.excluded.add(id);
      else this.excluded.delete(id);
    }
    save('excluded', [...this.excluded]);
    for (const id of ids) this.emit('excluded', id);
  }

  repsFor(ex: Exercise): DefaultReps {
    return this.reps[ex.id] ?? ex.defaultReps;
  }

  hasCustomReps(id: string): boolean {
    return id in this.reps;
  }

  /** Save a user override, or pass null to go back to the suggested default. */
  setReps(ex: Exercise, reps: DefaultReps | null): void {
    const cleaned = reps && { sets: clampSets(reps.sets), reps: reps.reps.trim().slice(0, 40) || ex.defaultReps.reps };
    if (!cleaned || (cleaned.sets === ex.defaultReps.sets && cleaned.reps === ex.defaultReps.reps)) {
      delete this.reps[ex.id];
    } else {
      this.reps[ex.id] = cleaned;
    }
    save('reps', this.reps);
    this.emit('reps', ex.id);
  }

  get routineOptions(): RoutineOptions {
    const o = load('routine-options', DEFAULT_ROUTINE_OPTIONS, isRoutineOptions);
    return {
      ...o,
      minutes: Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, o.minutes)),
      maxLevel: (LEVELS as readonly string[]).includes(o.maxLevel) ? o.maxLevel : DEFAULT_ROUTINE_OPTIONS.maxLevel,
    };
  }

  set routineOptions(options: RoutineOptions) {
    save('routine-options', options);
  }

  get sound(): boolean {
    return load('sound', true, (v): v is boolean => typeof v === 'boolean');
  }

  set sound(on: boolean) {
    save('sound', on);
  }

  setSession(session: Session | null, now = Date.now()): void {
    this.session = session;
    if (session) save('session', { session, savedAt: now } satisfies SavedSession);
    else remove('session');
    this.emit('session');
  }

  /** Persist the running session's timestamp without notifying listeners. */
  touchSession(now = Date.now()): void {
    if (this.session) save('session', { session: this.session, savedAt: now } satisfies SavedSession);
  }
}

export const store = new Store();
