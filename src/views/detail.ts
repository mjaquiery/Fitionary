import { announce, h, icon, ICONS } from '../dom.ts';
import { capitalize, formatClock, listToText } from '../lib/format.ts';
import { MAX_SETS, MIN_SETS, formatReps } from '../lib/reps.ts';
import { exerciseSeconds } from '../lib/routine.ts';
import { store } from '../store.ts';
import type { Exercise } from '../types.ts';
import { frameViewer, type FrameViewer } from './frames.ts';
import { includeToggle } from './library.ts';

function repsEditor(ex: Exercise): HTMLElement {
  const current = store.repsFor(ex);
  const setsId = `sets-${ex.id}`;
  const repsId = `reps-${ex.id}`;
  const hintId = `reps-hint-${ex.id}`;
  const sets = h('input', { id: setsId, type: 'number', inputmode: 'numeric', min: MIN_SETS, max: MAX_SETS, step: 1, value: current.sets, required: true });
  const reps = h('input', { id: repsId, type: 'text', value: current.reps, maxlength: 40, autocomplete: 'off', 'aria-describedby': hintId, required: true });
  const estimate = h('p', { class: 'muted' });
  const reset = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'Reset to suggested');

  const refresh = () => {
    const r = store.repsFor(ex);
    estimate.textContent = `About ${formatClock(exerciseSeconds(ex, r.sets, r.reps))} in a routine, including rests.`;
    reset.hidden = !store.hasCustomReps(ex.id);
  };

  const commit = () => {
    const n = Number(sets.value);
    store.setReps(ex, { sets: Number.isFinite(n) && sets.value !== '' ? n : ex.defaultReps.sets, reps: reps.value });
    const r = store.repsFor(ex);
    sets.value = String(r.sets);
    reps.value = r.reps;
    refresh();
  };

  const stepSets = (delta: number) => {
    sets.value = String(Math.min(MAX_SETS, Math.max(MIN_SETS, (Number(sets.value) || 0) + delta)));
    commit();
    announce(`${sets.value} sets`);
  };

  sets.addEventListener('change', commit);
  reps.addEventListener('change', commit);
  reset.addEventListener('click', () => {
    store.setReps(ex, null);
    sets.value = String(ex.defaultReps.sets);
    reps.value = ex.defaultReps.reps;
    refresh();
    announce('Reset to suggested sets and reps');
  });
  refresh();

  return h(
    'section',
    { class: 'detail-section', 'aria-labelledby': `reps-heading-${ex.id}` },
    h('h3', { id: `reps-heading-${ex.id}` }, 'Sets and reps'),
    h('p', null, 'Suggested: ', h('strong', null, formatReps(ex.defaultReps.sets, ex.defaultReps.reps))),
    h(
      'form',
      { class: 'reps-form', onsubmit: (e: Event) => (e.preventDefault(), commit()) },
      h(
        'div',
        { class: 'field' },
        h('label', { for: setsId }, 'Sets'),
        h(
          'div',
          { class: 'stepper' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fewer sets', onclick: () => stepSets(-1) }, '−'),
          sets,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More sets', onclick: () => stepSets(1) }, '+'),
        ),
      ),
      h('div', { class: 'field field-grow' }, h('label', { for: repsId }, 'Reps or time'), reps, h('p', { id: hintId, class: 'hint' }, 'For example 10, 8-12, 30s hold or 5 min')),
    ),
    h('div', { class: 'reps-footer' }, estimate, reset),
  );
}

export interface DetailDialog {
  open(ex: Exercise): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Modal detail view. `onClose` runs when the user dismisses it (Esc, close button, backdrop). */
export function detailDialog(onClose: () => void): DetailDialog {
  const dialog = h('dialog', { class: 'detail', 'aria-labelledby': 'detail-title' });
  document.body.appendChild(dialog);
  let viewer: FrameViewer | null = null;
  let unsubscribe: (() => void) | null = null;

  const teardown = () => {
    viewer?.destroy();
    viewer = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  dialog.addEventListener('close', () => {
    teardown();
    onClose();
  });
  // Click on the backdrop (outside the content box) closes.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  return {
    get isOpen() {
      return dialog.open;
    },
    open(ex) {
      teardown();
      viewer = frameViewer(ex);
      const toggle = includeToggle(ex, 'toggle toggle-large');
      unsubscribe = store.on('excluded', (id) => id === ex.id && toggle.sync());

      dialog.replaceChildren(
        h(
          'div',
          { class: 'detail-inner' },
          h(
            'header',
            { class: 'detail-head' },
            h('h2', { id: 'detail-title' }, ex.name),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, icon(ICONS.close)),
          ),
          viewer.el,
          h(
            'dl',
            { class: 'facts' },
            h('div', null, h('dt', null, 'Primary muscles'), h('dd', null, listToText(ex.primaryMuscles) || 'Not specified')),
            ex.secondaryMuscles.length ? h('div', null, h('dt', null, 'Secondary muscles'), h('dd', null, listToText(ex.secondaryMuscles))) : null,
            h('div', null, h('dt', null, 'Equipment'), h('dd', null, capitalize(ex.equipment))),
            h('div', null, h('dt', null, 'Level'), h('dd', null, capitalize(ex.level))),
            h('div', null, h('dt', null, 'Type'), h('dd', null, capitalize(ex.category))),
          ),
          toggle.btn,
          repsEditor(ex),
          h(
            'section',
            { class: 'detail-section', 'aria-labelledby': 'instructions-heading' },
            h('h3', { id: 'instructions-heading' }, 'Instructions'),
            ex.instructions.length
              ? h('ol', { class: 'instructions' }, ex.instructions.map((step) => h('li', null, step)))
              : h('p', { class: 'muted' }, 'No instructions are available for this exercise.'),
          ),
        ),
      );
      document.title = `${ex.name} · Fitionary`;
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
