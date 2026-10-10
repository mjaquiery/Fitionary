import type { Exercise } from '../types.ts';
import { clampSets, formatReps } from './reps.ts';
import type { Block, RoutineItem } from './routine.ts';
import type { Session } from './session.ts';
import { totals } from './session.ts';
import { formatDuration } from './format.ts';

const BLOCK_CODES: Record<Block, string> = { warmup: 'w', main: 'm', cooldown: 'c' };
const CODE_BLOCKS: Record<string, Block> = { w: 'warmup', m: 'main', c: 'cooldown' };

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Compact, URL-safe encoding of a routine for share links. */
export function encodeDeck(items: readonly RoutineItem[]): string {
  return toBase64Url(JSON.stringify(items.map((i) => [i.id, i.sets, i.reps, BLOCK_CODES[i.block]])));
}

/** Decode a share link payload, dropping unknown exercises. Returns null if it is malformed or empty. */
export function decodeDeck(data: string, knownIds: ReadonlySet<string>): RoutineItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(data));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const items: RoutineItem[] = [];
  for (const entry of parsed.slice(0, 200)) {
    if (!Array.isArray(entry)) continue;
    const [id, sets, reps, block] = entry as unknown[];
    if (typeof id !== 'string' || !knownIds.has(id)) continue;
    if (typeof sets !== 'number' || typeof reps !== 'string') continue;
    items.push({
      id,
      sets: clampSets(sets),
      reps: reps.slice(0, 40),
      block: CODE_BLOCKS[typeof block === 'string' ? block : ''] ?? 'main',
    });
  }
  return items.length ? items : null;
}

export function shareUrl(origin: string, items: readonly RoutineItem[]): string {
  return `${origin}/routine?deck=${encodeDeck(items)}`;
}

const STATUS_MARK = { done: '✓', skipped: '↷', pending: '·' } as const;

/** Plain-text summary used for Share / Copy. */
export function summaryText(session: Session, byId: ReadonlyMap<string, Exercise>, link: string): string {
  const t = totals(session);
  const lines = [
    `Fitionary workout: ${t.done} of ${t.total} done${t.skipped ? `, ${t.skipped} skipped` : ''}, ${formatDuration(t.activeMs / 1000)} active`,
    '',
    ...session.items.map((item, i) => {
      const name = byId.get(item.id)?.name ?? item.id;
      return `${STATUS_MARK[session.statuses[i]]} ${i + 1}. ${name} (${formatReps(item.sets, item.reps)})`;
    }),
    '',
    `Try this routine: ${link}`,
  ];
  return lines.join('\n');
}

/** Machine-readable export of a session. */
export function summaryJson(session: Session, byId: ReadonlyMap<string, Exercise>, link: string): string {
  const t = totals(session);
  return JSON.stringify(
    {
      app: 'Fitionary',
      startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : null,
      finishedAt: session.finishedAt ? new Date(session.finishedAt).toISOString() : null,
      activeSeconds: Math.round(t.activeMs / 1000),
      completed: t.done,
      skipped: t.skipped,
      link,
      exercises: session.items.map((item, i) => ({
        id: item.id,
        name: byId.get(item.id)?.name ?? item.id,
        block: item.block,
        sets: item.sets,
        reps: item.reps,
        status: session.statuses[i],
        seconds: Math.round(session.spentMs[i] / 1000),
      })),
    },
    null,
    2,
  );
}
