import type { RoutineItem } from './routine.ts';

export type CardStatus = 'pending' | 'done' | 'skipped';

/**
 * State of a routine being played. Plain data (JSON-serializable) so it can be
 * saved to localStorage and resumed after a reload. All functions are pure.
 */
export interface Session {
  items: RoutineItem[];
  /** Planned length of each card in ms (parallel to items). */
  durationsMs: number[];
  /** Index of the card currently dealt; equals items.length when finished. */
  index: number;
  statuses: CardStatus[];
  /** Time actually spent on each card in ms. */
  spentMs: number[];
  /** Elapsed time on the current card, excluding the segment that is running now. */
  cardElapsedMs: number;
  /** Timestamp the current running segment began, or null when paused / not started. */
  runningSince: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export function createSession(items: RoutineItem[], durationsMs: number[]): Session {
  return {
    items,
    durationsMs,
    index: 0,
    statuses: items.map(() => 'pending'),
    spentMs: items.map(() => 0),
    cardElapsedMs: 0,
    runningSince: null,
    startedAt: null,
    finishedAt: null,
  };
}

export const isRunning = (s: Session) => s.runningSince !== null;
export const isFinished = (s: Session) => s.finishedAt !== null;

export function cardElapsed(s: Session, now: number): number {
  return s.cardElapsedMs + (s.runningSince !== null ? now - s.runningSince : 0);
}

export function start(s: Session, now: number): Session {
  if (isFinished(s) || isRunning(s) || s.items.length === 0) return s;
  return { ...s, runningSince: now, startedAt: s.startedAt ?? now };
}

export function pause(s: Session, now: number): Session {
  if (s.runningSince === null) return s;
  return { ...s, cardElapsedMs: cardElapsed(s, now), runningSince: null };
}

export const resume = start;

/** Finish the current card with `status` and deal the next. Keeps running if it was running. */
export function advance(s: Session, now: number, status: Exclude<CardStatus, 'pending'>): Session {
  if (isFinished(s)) return s;
  const statuses = s.statuses.slice();
  const spentMs = s.spentMs.slice();
  statuses[s.index] = status;
  spentMs[s.index] = cardElapsed(s, now);
  const index = s.index + 1;
  const done = index >= s.items.length;
  return {
    ...s,
    index,
    statuses,
    spentMs,
    cardElapsedMs: 0,
    runningSince: done || s.runningSince === null ? null : now,
    startedAt: s.startedAt ?? now,
    finishedAt: done ? now : null,
  };
}

/**
 * Auto-complete cards whose time has run out. If the tab was asleep, several
 * cards may complete at once; each is credited exactly its planned duration.
 */
export function tick(s: Session, now: number): Session {
  let cur = s;
  while (!isFinished(cur) && cur.runningSince !== null) {
    const duration = cur.durationsMs[cur.index];
    const elapsed = cardElapsed(cur, now);
    if (elapsed < duration) break;
    cur = advance(cur, now - (elapsed - duration), 'done');
  }
  return cur;
}

export interface SessionTotals {
  done: number;
  skipped: number;
  total: number;
  activeMs: number;
}

export function totals(s: Session): SessionTotals {
  return {
    done: s.statuses.filter((x) => x === 'done').length,
    skipped: s.statuses.filter((x) => x === 'skipped').length,
    total: s.items.length,
    activeMs: s.spentMs.reduce((a, b) => a + b, 0) + (isFinished(s) ? 0 : s.cardElapsedMs),
  };
}

/** Loose structural check for data restored from storage. */
export function isSession(v: unknown): v is Session {
  if (!v || typeof v !== 'object') return false;
  const s = v as Session;
  return (
    Array.isArray(s.items) &&
    Array.isArray(s.durationsMs) &&
    Array.isArray(s.statuses) &&
    Array.isArray(s.spentMs) &&
    s.items.length === s.durationsMs.length &&
    s.items.length === s.statuses.length &&
    typeof s.index === 'number' &&
    typeof s.cardElapsedMs === 'number'
  );
}
