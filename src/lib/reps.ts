export type ParsedReps = { kind: 'reps'; count: number } | { kind: 'time'; seconds: number };

const FALLBACK_REP_COUNT = 10;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Interpret a free-text reps value. Ranges use their midpoint.
 *   "8-12" → 10 reps · "5" → 5 reps · "30s hold" → 30 s · "30-60 sec" → 45 s · "10 min" → 600 s
 * Anything without a number falls back to 10 reps.
 */
export function parseReps(reps: string): ParsedReps {
  const text = reps.toLowerCase();
  const m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?/.exec(text);
  if (!m) return { kind: 'reps', count: FALLBACK_REP_COUNT };
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const mid = (lo + hi) / 2;
  const unit = text.slice(m.index + m[0].length).trim();
  if (/^(m|mins?|minutes?)\b/.test(unit)) return { kind: 'time', seconds: clamp(Math.round(mid * 60), 5, 3600) };
  if (/^(s|secs?|seconds?)\b/.test(unit)) return { kind: 'time', seconds: clamp(Math.round(mid), 5, 3600) };
  return { kind: 'reps', count: clamp(Math.round(mid), 1, 100) };
}

export interface Phase {
  kind: 'ready' | 'work' | 'rest';
  label: string;
  seconds: number;
}

/** Timing assumptions behind routine length estimates; documented in README.md. */
export const TIMING = {
  readySeconds: 15,
  secondsPerRep: { default: 3, plyometrics: 2, powerlifting: 4, 'olympic weightlifting': 4 } as Record<string, number>,
  restSeconds: {
    default: 60,
    powerlifting: 120,
    'olympic weightlifting': 120,
    strongman: 90,
    stretching: 10,
    cardio: 0,
  } as Record<string, number>,
};

export const MIN_SETS = 1;
export const MAX_SETS = 10;

export function clampSets(sets: number): number {
  return Number.isFinite(sets) ? clamp(Math.round(sets), MIN_SETS, MAX_SETS) : MIN_SETS;
}

/** Break one exercise into timed phases: get ready, then sets separated by rests. */
export function planPhases(sets: number, reps: string, category: string): Phase[] {
  const n = clampSets(sets);
  const parsed = parseReps(reps);
  const perRep = TIMING.secondsPerRep[category] ?? TIMING.secondsPerRep.default;
  const work = parsed.kind === 'time' ? parsed.seconds : parsed.count * perRep;
  const rest = TIMING.restSeconds[category] ?? TIMING.restSeconds.default;
  const phases: Phase[] = [{ kind: 'ready', label: 'Get ready', seconds: TIMING.readySeconds }];
  for (let i = 1; i <= n; i++) {
    phases.push({ kind: 'work', label: n > 1 ? `Set ${i} of ${n}` : 'Go', seconds: work });
    if (i < n && rest > 0) phases.push({ kind: 'rest', label: 'Rest', seconds: rest });
  }
  return phases;
}

export function totalSeconds(phases: readonly Phase[]): number {
  return phases.reduce((sum, p) => sum + p.seconds, 0);
}

/** Which phase is active after `elapsed` seconds, and how long is left in it. */
export function phaseAt(phases: readonly Phase[], elapsed: number): { index: number; phase: Phase; remaining: number } {
  let start = 0;
  for (let i = 0; i < phases.length; i++) {
    const end = start + phases[i].seconds;
    if (elapsed < end) return { index: i, phase: phases[i], remaining: end - elapsed };
    start = end;
  }
  const last = phases.length - 1;
  return { index: last, phase: phases[last], remaining: 0 };
}

export function formatReps(sets: number, reps: string): string {
  return `${sets} × ${reps}`;
}
