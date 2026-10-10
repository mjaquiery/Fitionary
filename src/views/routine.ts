import { announce, h, icon, ICONS, prefersReducedMotion, replace } from '../dom.ts';
import { facets } from '../lib/filter.ts';
import { capitalize, formatClock, formatDuration, listToText } from '../lib/format.ts';
import { formatReps, phaseAt, planPhases, type Phase } from '../lib/reps.ts';
import {
  LEVELS,
  MAIN_CATEGORIES,
  MAX_MINUTES,
  MIN_MINUTES,
  exerciseSeconds,
  generateRoutine,
  type Block,
  type RoutineItem,
  type RoutineOptions,
} from '../lib/routine.ts';
import {
  advance,
  cardElapsed,
  createSession,
  isFinished,
  isRunning,
  pause,
  resume,
  start,
  tick,
  totals,
  type Session,
} from '../lib/session.ts';
import { decodeDeck, shareUrl, summaryJson, summaryText } from '../lib/share.ts';
import { BODYWEIGHT } from '../constants.ts';
import { store } from '../store.ts';
import type { Exercise } from '../types.ts';
import { frameViewer, type FrameViewer } from './frames.ts';

const BLOCK_LABEL: Record<Block, string> = { warmup: 'Warm-up', main: 'Workout', cooldown: 'Cool-down' };

function newSession(items: RoutineItem[]): Session {
  const durations = items.map((item) => {
    const ex = store.byId.get(item.id)!;
    return exerciseSeconds(ex, item.sets, item.reps) * 1000;
  });
  return createSession(items, durations);
}

const phasesFor = (item: RoutineItem): Phase[] => planPhases(item.sets, item.reps, store.byId.get(item.id)?.category ?? 'strength');

// ---- Sound, vibration and screen wake lock -------------------------------------------------

let audio: AudioContext | null = null;

/** Must be called from a user gesture once so browsers allow sound later. */
function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function cue(kind: 'work' | 'rest' | 'card' | 'done'): void {
  if (!store.sound) return;
  navigator.vibrate?.(kind === 'done' ? [200, 100, 200] : 120);
  if (!audio) return;
  const freq = { work: 880, rest: 440, card: 660, done: 990 }[kind];
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.3);
}

let wakeLock: WakeLockSentinel | null = null;

async function keepAwake(on: boolean): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  if (on && !wakeLock) {
    wakeLock = await navigator.wakeLock.request('screen').catch(() => null);
    wakeLock?.addEventListener('release', () => (wakeLock = null));
  } else if (!on && wakeLock) {
    await wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// ---- Setup form ------------------------------------------------------------------------------

function checkboxGroup(legend: string, name: string, options: Array<[value: string, label: string]>, checked: readonly string[], extra?: HTMLElement) {
  const boxes = options.map(([value, label]) => {
    const id = `${name}-${value.replace(/\W+/g, '-')}`;
    const input = h('input', { type: 'checkbox', id, name, value, checked: checked.includes(value) });
    return { input, el: h('div', { class: 'check' }, input, h('label', { for: id }, label)) };
  });
  const fieldset = h('fieldset', { class: 'checks' }, h('legend', null, legend), extra, h('div', { class: 'check-grid' }, boxes.map((b) => b.el)));
  return { fieldset, values: () => boxes.filter((b) => b.input.checked).map((b) => b.input.value) };
}

function setupForm(onDeal: (options: RoutineOptions) => void, message?: string[]): HTMLElement {
  const saved = store.routineOptions;
  const { muscles, equipment } = facets(store.exercises);

  const minutes = h('input', { type: 'range', id: 'minutes', name: 'minutes', min: MIN_MINUTES, max: MAX_MINUTES, step: 5, value: saved.minutes });
  const minutesOut = h('output', { for: 'minutes', id: 'minutes-out' });
  const syncMinutes = () => {
    minutesOut.textContent = `${minutes.value} min`;
    minutes.setAttribute('aria-valuetext', `${minutes.value} minutes`);
  };
  syncMinutes();

  const equip = checkboxGroup(
    'Equipment you have',
    'equipment',
    equipment.filter((e) => e.value !== BODYWEIGHT).map((e): [string, string] => [e.value, capitalize(e.value)]),
    saved.equipment,
    h('p', { class: 'hint' }, 'Bodyweight exercises are always included.'),
  );
  const level = h('select', { id: 'level', name: 'level' }, LEVELS.map((l) => h('option', { value: l, selected: l === saved.maxLevel }, capitalize(l))));
  const warmup = h('input', { type: 'checkbox', id: 'warmup', name: 'warmup', checked: saved.warmupCooldown });
  const categories = checkboxGroup('Exercise types', 'categories', MAIN_CATEGORIES.map((c): [string, string] => [c, capitalize(c)]), saved.categories);
  const focus = checkboxGroup(
    'Focus muscles',
    'focus',
    muscles.map((m): [string, string] => [m.value, capitalize(m.value)]),
    saved.focusMuscles,
    h('p', { class: 'hint' }, 'Leave all unticked for a full-body routine.'),
  );

  const read = (): RoutineOptions => ({
    minutes: Number(minutes.value),
    equipment: equip.values(),
    maxLevel: level.value,
    categories: categories.values(),
    focusMuscles: focus.values(),
    warmupCooldown: warmup.checked,
  });

  const excludedCount = store.excluded.size;
  const form = h(
    'form',
    { class: 'routine-form', 'aria-labelledby': 'routine-heading' },
    message?.length ? h('div', { class: 'notice notice-warn', role: 'alert' }, message.map((m) => h('p', null, m))) : null,
    h('div', { class: 'field' }, h('label', { for: 'minutes' }, 'Length ', minutesOut), minutes),
    equip.fieldset,
    h('div', { class: 'field' }, h('label', { for: 'level' }, 'Hardest level to include'), level),
    h('div', { class: 'check' }, warmup, h('label', { for: 'warmup' }, 'Warm-up and cool-down stretches')),
    h('details', { class: 'more' }, h('summary', null, 'More options'), categories.fieldset, focus.fieldset),
    h(
      'p',
      { class: 'hint' },
      excludedCount
        ? [`${excludedCount} exercise${excludedCount === 1 ? ' is' : 's are'} excluded from routines. `, h('a', { href: '/?show=excluded' }, 'Review exclusions')]
        : ['All exercises can be dealt. You can exclude any from the ', h('a', { href: '/' }, 'library'), '.'],
    ),
    h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, 'Deal the cards'),
  );
  minutes.addEventListener('input', syncMinutes);
  form.addEventListener('change', () => (store.routineOptions = read()));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const options = read();
    store.routineOptions = options;
    onDeal(options);
  });
  return form;
}

// ---- Face-down deck --------------------------------------------------------------------------

function deckStack(count: number, label: string): HTMLElement {
  const layers = Math.min(count, 4);
  return h(
    'div',
    { class: 'deck' },
    h('div', { class: 'deck-cards', 'aria-hidden': 'true' }, Array.from({ length: layers }, (_, i) => h('div', { class: 'card-back', style: `--i:${i}` }))),
    h('p', { class: 'deck-count' }, label),
  );
}

// ---- The view --------------------------------------------------------------------------------

export interface RoutineView {
  el: HTMLElement;
  heading: HTMLElement;
  mount(): void;
  unmount(): void;
}

export function routineView(): RoutineView {
  const heading = h('h1', { id: 'routine-heading', tabindex: -1 }, 'Routine');
  const body = h('div', { class: 'routine-body' });
  const el = h('section', { class: 'view routine', 'aria-labelledby': 'routine-heading' }, h('div', { class: 'view-head' }, heading), body);

  let timer: number | undefined;
  let lastSave = 0;
  let mounted = false;
  let player: Player | null = null;

  const setSession = (s: Session | null) => store.setSession(s);

  const deal = (options: RoutineOptions) => {
    const result = generateRoutine(store.exercises, options, { excluded: store.excluded, repsFor: (ex) => store.repsFor(ex) });
    if (!result.items.length) {
      render(result.warnings);
      return;
    }
    setSession(newSession(result.items));
    render(result.warnings);
    announce(`Dealt ${result.items.length} cards, about ${formatDuration(result.plannedSeconds)}`);
  };

  const stopLoop = () => {
    window.clearInterval(timer);
    timer = undefined;
  };

  const startLoop = () => {
    stopLoop();
    timer = window.setInterval(onTick, 250);
    onTick();
  };

  const onTick = () => {
    const s = store.session;
    if (!s || !player) return;
    const now = Date.now();
    const next = tick(s, now);
    if (next !== s) {
      setSession(next);
      if (isFinished(next)) {
        cue('done');
        render();
        return;
      }
      cue('card');
      player.deal(next);
    }
    player.update(next, now);
    if (isRunning(next) && now - lastSave > 5000) {
      store.touchSession(now);
      lastSave = now;
    }
  };

  const onVisibility = () => {
    const s = store.session;
    if (document.visibilityState === 'visible' && s && isRunning(s)) void keepAwake(true);
  };

  const onKey = (e: KeyboardEvent) => {
    const s = store.session;
    if (!player || !s || isFinished(s) || s.startedAt === null) return;
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, button, a, summary, [contenteditable]')) return;
    if (e.key === ' ') {
      e.preventDefault();
      player.togglePause();
    } else if (e.key === 'n' || e.key === 'N') {
      player.next('done');
    } else if (e.key === 's' || e.key === 'S') {
      player.next('skipped');
    }
  };

  /** Render the current state; if that removed the focused element, focus `target` (or the heading). */
  function render(warnings: string[] = []) {
    const target = renderState(warnings);
    const focused = document.activeElement;
    if (mounted && (!focused || focused === document.body || !focused.isConnected)) (target ?? heading).focus();
  }

  function renderState(warnings: string[]): HTMLElement | null {
    player?.destroy();
    player = null;
    stopLoop();
    const s = store.session;

    if (!s) {
      heading.textContent = 'Deal a routine';
      void keepAwake(false);
      body.replaceChildren(
        h('p', { class: 'lede' }, 'Pick a length and the equipment you have. Fitionary deals a deck of exercise cards face down; each is revealed when its turn comes.'),
        setupForm(deal, warnings),
      );
      return null;
    }

    if (s.startedAt === null) {
      heading.textContent = 'Your deck';
      const planned = s.durationsMs.reduce((a, b) => a + b, 0) / 1000;
      const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large' }, icon(ICONS.play), 'Start workout');
      startBtn.addEventListener('click', () => {
        unlockAudio();
        setSession(start(s, Date.now()));
        void keepAwake(true);
        render();
        announce('Workout started');
      });
      replace(
        body,
        warnings.length ? h('div', { class: 'notice notice-warn', role: 'status' }, warnings.map((w) => h('p', null, w))) : null,
        deckStack(s.items.length, `${s.items.length} cards face down · about ${formatDuration(planned)}`),
        h(
          'details',
          { class: 'peek' },
          h('summary', null, 'Peek at the cards'),
          h('ol', null, s.items.map((item) => h('li', null, `${store.byId.get(item.id)?.name ?? item.id} (${formatReps(item.sets, item.reps)}, ${BLOCK_LABEL[item.block].toLowerCase()})`))),
        ),
        h(
          'div',
          { class: 'actions' },
          startBtn,
          h('button', { type: 'button', class: 'btn', onclick: () => deal(store.routineOptions) }, 'Reshuffle'),
          h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => (setSession(null), render()) }, 'Change options'),
        ),
      );
      return startBtn;
    }

    if (!isFinished(s)) {
      heading.textContent = 'Workout';
      player = createPlayer({
        onChange: (next) => {
          setSession(next);
          if (isFinished(next)) {
            cue('done');
            render();
          }
        },
        onEnd: () => {
          let cur = store.session!;
          const now = Date.now();
          while (!isFinished(cur)) cur = advance(cur, now, 'skipped');
          setSession(cur);
          render();
        },
      });
      body.replaceChildren(player.el);
      player.deal(s);
      player.update(s, Date.now());
      void keepAwake(isRunning(s));
      if (mounted) startLoop();
      return player.primary;
    }

    heading.textContent = 'Workout complete';
    void keepAwake(false);
    body.replaceChildren(
      summaryView(s, {
        again: () => (setSession(newSession(s.items)), render()),
        fresh: () => (setSession(null), render()),
      }),
    );
    return null;
  }

  return {
    el,
    heading,
    mount() {
      mounted = true;
      const params = new URLSearchParams(location.search);
      const deckParam = params.get('deck');
      let notice: HTMLElement | null = null;
      if (deckParam !== null) {
        history.replaceState(history.state, '', '/routine');
        const items = decodeDeck(deckParam, new Set(store.byId.keys()));
        const s = store.session;
        const inProgress = s && s.startedAt !== null && !isFinished(s);
        if (!items) {
          notice = h('div', { class: 'notice notice-warn', role: 'alert' }, h('p', null, 'That shared routine link is invalid or refers to exercises that no longer exist.'));
        } else if (inProgress) {
          const load = h('button', { type: 'button', class: 'btn btn-small' }, 'Replace it with the shared routine');
          notice = h('div', { class: 'notice', role: 'status' }, h('p', null, 'You have a workout in progress, so the shared routine was not loaded.'), load);
          load.addEventListener('click', () => {
            setSession(newSession(items));
            render();
          });
        } else {
          setSession(newSession(items));
          notice = h('div', { class: 'notice', role: 'status' }, h('p', null, `Loaded a shared routine with ${items.length} cards.`));
        }
      }
      render();
      if (notice) body.prepend(notice);
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
    },
    unmount() {
      mounted = false;
      stopLoop();
      player?.destroy();
      player = null;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      void keepAwake(false);
    },
  };
}

// ---- Player ----------------------------------------------------------------------------------

interface Player {
  el: HTMLElement;
  /** The pause/resume button, focused when the player first appears. */
  primary: HTMLElement;
  /** Reveal the current card (flip animation). */
  deal(s: Session): void;
  /** Refresh timers and progress. */
  update(s: Session, now: number): void;
  togglePause(): void;
  next(status: 'done' | 'skipped'): void;
  destroy(): void;
}

function createPlayer(handlers: { onChange(s: Session): void; onEnd(): void }): Player {
  const progressText = h('p', { class: 'progress-text' });
  const progressTime = h('p', { class: 'progress-time muted' });
  const progress = h('progress', { class: 'progress', 'aria-label': 'Cards completed' });
  const pips = h('ol', { class: 'pips', 'aria-label': 'Cards' });
  const pile = h('div', { class: 'pile' });
  const slot = h('div', { class: 'slot' });
  const phaseLabel = h('p', { class: 'phase-label' });
  const countdown = h('p', { class: 'countdown' });
  const cardLeft = h('p', { class: 'card-left muted' });
  const timerBox = h('div', { class: 'timer', role: 'timer', 'aria-label': 'Exercise timer' }, phaseLabel, countdown, cardLeft);

  const pauseBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large' });
  const doneBtn = h('button', { type: 'button', class: 'btn btn-large' }, icon(ICONS.check), 'Done');
  const skipBtn = h('button', { type: 'button', class: 'btn btn-large' }, icon(ICONS.skip), 'Skip');
  const soundBtn = h('button', { type: 'button', class: 'btn btn-quiet btn-small' });
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'End workout');

  let viewer: FrameViewer | null = null;
  let dealtIndex = -1;
  let phaseIndex = -1;

  const syncSound = () => {
    soundBtn.replaceChildren(icon(store.sound ? ICONS.sound : ICONS.mute), store.sound ? 'Sound on' : 'Sound off');
    soundBtn.setAttribute('aria-pressed', String(store.sound));
  };
  syncSound();

  const syncPause = (s: Session) => {
    const running = isRunning(s);
    pauseBtn.replaceChildren(icon(running ? ICONS.pause : ICONS.play), running ? 'Pause' : 'Resume');
    timerBox.classList.toggle('is-paused', !running);
  };

  const current = () => store.session!;

  const player: Player = {
    primary: pauseBtn,
    el: h(
      'div',
      { class: 'player' },
      h('div', { class: 'progress-wrap' }, pile, h('div', { class: 'progress-info' }, progressText, progress, pips, progressTime)),
      slot,
      h('div', { class: 'controls-secondary' }, soundBtn, h('p', { class: 'hint keys' }, 'Keys: Space pause · N done · S skip'), endBtn),
      h('div', { class: 'dock' }, timerBox, h('div', { class: 'controls' }, pauseBtn, doneBtn, skipBtn)),
    ),

    deal(s) {
      if (s.index === dealtIndex) return;
      dealtIndex = s.index;
      phaseIndex = -1;
      viewer?.destroy();
      const item = s.items[s.index];
      const ex = store.byId.get(item.id) as Exercise;
      viewer = frameViewer(ex, { autoplay: true, label: 'Exercise images' });

      const face = h(
        'article',
        { class: 'play-card', 'aria-labelledby': 'play-card-title' },
        h('p', { class: `block-label block-${item.block}` }, BLOCK_LABEL[item.block]),
        h('h2', { id: 'play-card-title', class: 'play-card-title' }, ex.name),
        viewer.el,
        h('p', { class: 'play-reps' }, formatReps(item.sets, item.reps)),
        h('p', { class: 'muted' }, listToText(ex.primaryMuscles), ex.equipment !== BODYWEIGHT ? ` · ${capitalize(ex.equipment)}` : ''),
        ex.instructions.length
          ? h('details', { class: 'play-instructions' }, h('summary', null, 'Instructions'), h('ol', null, ex.instructions.map((step) => h('li', null, step))))
          : null,
      );
      slot.replaceChildren(face);
      if (!prefersReducedMotion()) {
        face.classList.add('is-dealing');
        requestAnimationFrame(() => requestAnimationFrame(() => face.classList.remove('is-dealing')));
      }

      const left = s.items.length - s.index - 1;
      pile.replaceChildren(deckStack(left, left ? `${left} left` : 'Last card'));
      pips.replaceChildren(
        ...s.items.map((_, i) => {
          const status = i === s.index ? 'current' : s.statuses[i];
          const text = { current: 'current', pending: 'face down', done: 'done', skipped: 'skipped' }[status];
          return h('li', { class: `pip pip-${status}`, 'aria-current': i === s.index ? 'step' : null }, h('span', { class: 'sr-only' }, `Card ${i + 1}: ${text}`));
        }),
      );
      progress.max = s.items.length;
      progress.value = s.index;
      progressText.textContent = `Card ${s.index + 1} of ${s.items.length}`;
      announce(`Card ${s.index + 1} of ${s.items.length}: ${ex.name}, ${formatReps(item.sets, item.reps)}`);
    },

    update(s, now) {
      syncPause(s);
      const item = s.items[s.index];
      if (!item) return;
      const phases = phasesFor(item);
      const elapsed = cardElapsed(s, now) / 1000;
      const at = phaseAt(phases, elapsed);
      if (at.index !== phaseIndex) {
        if (phaseIndex !== -1) {
          cue(at.phase.kind === 'rest' ? 'rest' : 'work');
          announce(at.phase.label);
        }
        phaseIndex = at.index;
        timerBox.dataset.phase = at.phase.kind;
      }
      const cardTotal = s.durationsMs[s.index] / 1000;
      phaseLabel.textContent = isRunning(s) ? at.phase.label : `Paused · ${at.phase.label}`;
      countdown.textContent = formatClock(at.remaining);
      cardLeft.textContent = `${formatClock(cardTotal - elapsed)} left on this card`;

      const done = s.spentMs.reduce((a, b) => a + b, 0) / 1000 + elapsed;
      const remaining = s.durationsMs.slice(s.index + 1).reduce((a, b) => a + b, 0) / 1000 + Math.max(0, cardTotal - elapsed);
      progressTime.textContent = `${formatClock(done)} elapsed · about ${formatDuration(remaining)} left`;
    },

    togglePause() {
      const s = current();
      const now = Date.now();
      unlockAudio();
      const next = isRunning(s) ? pause(s, now) : resume(s, now);
      handlers.onChange(next);
      void keepAwake(isRunning(next));
      announce(isRunning(next) ? 'Resumed' : 'Paused');
      player.update(next, now);
    },

    next(status) {
      const next = advance(current(), Date.now(), status);
      handlers.onChange(next);
      if (!isFinished(next)) {
        cue('card');
        player.deal(next);
        player.update(next, Date.now());
      }
    },

    destroy() {
      viewer?.destroy();
    },
  };

  pauseBtn.addEventListener('click', () => player.togglePause());
  doneBtn.addEventListener('click', () => player.next('done'));
  skipBtn.addEventListener('click', () => player.next('skipped'));
  soundBtn.addEventListener('click', () => {
    store.sound = !store.sound;
    if (store.sound) unlockAudio();
    syncSound();
  });
  endBtn.addEventListener('click', () => {
    if (window.confirm('End the workout now? Remaining cards will be marked as skipped.')) handlers.onEnd();
  });
  return player;
}

// ---- Summary ---------------------------------------------------------------------------------

function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function summaryView(s: Session, actions: { again(): void; fresh(): void }): HTMLElement {
  const t = totals(s);
  const link = shareUrl(location.origin, s.items);
  const text = summaryText(s, store.byId, link);
  const status = h('p', { class: 'status-msg', role: 'status' });

  const worked = new Map<string, number>();
  s.items.forEach((item, i) => {
    if (s.statuses[i] !== 'done') return;
    for (const m of store.byId.get(item.id)?.primaryMuscles ?? []) worked.set(m, (worked.get(m) ?? 0) + 1);
  });

  const shareBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon(ICONS.share), 'Share');
  shareBtn.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Fitionary workout', text, url: link });
        return;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return;
      }
    }
    status.textContent = (await copyText(text)) ? 'Summary and link copied to the clipboard.' : 'Could not copy. Use Download instead.';
  });
  const copyBtn = h('button', { type: 'button', class: 'btn' }, icon(ICONS.copy), 'Copy summary');
  copyBtn.addEventListener('click', async () => {
    status.textContent = (await copyText(text)) ? 'Summary copied to the clipboard.' : 'Could not copy. Use Download instead.';
  });
  const stamp = new Date(s.finishedAt ?? Date.now()).toISOString().slice(0, 10);
  const txtBtn = h('button', { type: 'button', class: 'btn' }, icon(ICONS.download), 'Download .txt');
  txtBtn.addEventListener('click', () => download(`fitionary-workout-${stamp}.txt`, text + '\n', 'text/plain'));
  const jsonBtn = h('button', { type: 'button', class: 'btn' }, icon(ICONS.download), 'Download .json');
  jsonBtn.addEventListener('click', () => download(`fitionary-workout-${stamp}.json`, summaryJson(s, store.byId, link) + '\n', 'application/json'));

  return h(
    'div',
    { class: 'summary' },
    h(
      'dl',
      { class: 'stats' },
      h('div', null, h('dt', null, 'Completed'), h('dd', null, `${t.done} of ${t.total}`)),
      h('div', null, h('dt', null, 'Skipped'), h('dd', null, String(t.skipped))),
      h('div', null, h('dt', null, 'Active time'), h('dd', null, formatClock(t.activeMs / 1000))),
    ),
    worked.size
      ? h(
          'section',
          { 'aria-labelledby': 'worked-heading' },
          h('h2', { id: 'worked-heading' }, 'Muscles worked'),
          h('ul', { class: 'tags' }, [...worked].sort((a, b) => b[1] - a[1]).map(([m, n]) => h('li', { class: 'tag tag-primary' }, `${capitalize(m)} × ${n}`))),
        )
      : null,
    h(
      'section',
      { 'aria-labelledby': 'cards-heading' },
      h('h2', { id: 'cards-heading' }, 'Cards'),
      h(
        'ol',
        { class: 'summary-list' },
        s.items.map((item, i) => {
          const ex = store.byId.get(item.id);
          const st = s.statuses[i];
          return h(
            'li',
            { class: `summary-item is-${st}` },
            h('span', { class: 'summary-mark', 'aria-hidden': 'true' }, st === 'done' ? '✓' : '↷'),
            h('span', { class: 'summary-name' }, ex ? h('a', { href: `/exercise/${encodeURIComponent(ex.id)}` }, ex.name) : item.id),
            h('span', { class: 'muted' }, `${formatReps(item.sets, item.reps)} · ${st === 'done' ? 'done' : 'skipped'} · ${formatClock(s.spentMs[i] / 1000)}`),
          );
        }),
      ),
    ),
    h('section', { 'aria-labelledby': 'share-heading' }, h('h2', { id: 'share-heading' }, 'Share or export'), h('div', { class: 'actions' }, shareBtn, copyBtn, txtBtn, jsonBtn), status),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: actions.again }, 'Do this routine again'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: actions.fresh }, 'New routine'),
    ),
  );
}
