import { announce, h, icon, ICONS } from '../dom.ts';
import { EMPTY_FILTER, facets, filterExercises, filterFromParams, filterToParams, type FilterState } from '../lib/filter.ts';
import { capitalize } from '../lib/format.ts';
import { formatReps } from '../lib/reps.ts';
import { store } from '../store.ts';
import type { Exercise } from '../types.ts';
import { imagePlaceholder, withFallback } from './frames.ts';

/** Toggle button for including an exercise in generated routines. Call `sync` when exclusions change. */
export function includeToggle(ex: Exercise, className = 'toggle'): { btn: HTMLButtonElement; sync: () => void } {
  const btn = h(
    'button',
    { type: 'button', class: className },
    icon(ICONS.check, 'icon toggle-icon'),
    h('span', null, 'In routines'),
    h('span', { class: 'sr-only' }, `: ${ex.name}`),
  );
  const sync = () => btn.setAttribute('aria-pressed', String(!store.isExcluded(ex.id)));
  sync();
  btn.addEventListener('click', () => {
    const exclude = !store.isExcluded(ex.id);
    store.setExcluded([ex.id], exclude);
    announce(`${ex.name} ${exclude ? 'excluded from' : 'included in'} routines`);
  });
  return { btn, sync };
}

function muscleTags(ex: Exercise): HTMLElement {
  return h(
    'p',
    { class: 'tags' },
    h('span', { class: 'sr-only' }, 'Primary muscles: '),
    ex.primaryMuscles.map((m) => h('span', { class: 'tag tag-primary' }, capitalize(m))),
    ex.secondaryMuscles.length ? h('span', { class: 'sr-only' }, '. Secondary: ') : null,
    ex.secondaryMuscles.map((m) => h('span', { class: 'tag' }, capitalize(m))),
  );
}

interface Card {
  li: HTMLLIElement;
  syncExcluded(): void;
  syncReps(): void;
}

function card(ex: Exercise): Card {
  const reps = h('dd', null);
  const syncReps = () => {
    const r = store.repsFor(ex);
    reps.textContent = formatReps(r.sets, r.reps) + (store.hasCustomReps(ex.id) ? ' (yours)' : '');
  };
  syncReps();

  const media = ex.images[0]
    ? withFallback(h('img', { src: ex.images[0], alt: `${ex.name} demonstration`, loading: 'lazy', decoding: 'async', width: 850, height: 567 }), ex)
    : imagePlaceholder(ex);
  const toggle = includeToggle(ex);

  const li = h(
    'li',
    { class: 'card' },
    h('div', { class: 'card-media' }, media),
    h(
      'div',
      { class: 'card-body' },
      h('h2', { class: 'card-title' }, h('a', { class: 'card-link', href: `/exercise/${encodeURIComponent(ex.id)}` }, ex.name)),
      muscleTags(ex),
      h(
        'dl',
        { class: 'meta' },
        h('div', null, h('dt', null, 'Equipment'), h('dd', null, capitalize(ex.equipment))),
        h('div', null, h('dt', null, 'Suggested'), reps),
      ),
      toggle.btn,
    ),
  );
  const syncExcluded = () => {
    li.classList.toggle('is-excluded', store.isExcluded(ex.id));
    toggle.sync();
  };
  syncExcluded();
  return { li, syncExcluded, syncReps };
}

function select(id: string, label: string, options: Array<[value: string, text: string]>): { field: HTMLElement; input: HTMLSelectElement } {
  const input = h('select', { id, name: id }, options.map(([value, text]) => h('option', { value }, text)));
  return { field: h('div', { class: 'field' }, h('label', { for: id }, label), input), input };
}

export interface LibraryView {
  el: HTMLElement;
  /** Re-read filters from the URL (on navigation). */
  sync(): void;
  heading: HTMLElement;
}

export function libraryView(): LibraryView {
  const all = store.exercises;
  const { muscles, equipment } = facets(all);
  const cards = new Map<string, Card>();
  const cardFor = (ex: Exercise) => {
    let c = cards.get(ex.id);
    if (!c) cards.set(ex.id, (c = card(ex)));
    return c.li;
  };
  // One listener per event; cards are looked up by id.
  store.on('excluded', (id) => id && cards.get(id)?.syncExcluded());
  store.on('reps', (id) => id && cards.get(id)?.syncReps());

  const heading = h('h1', { id: 'library-heading', tabindex: -1 }, 'Exercise library');
  const search = h('input', { id: 'q', name: 'q', type: 'search', autocomplete: 'off', placeholder: 'e.g. push-up, hamstrings', enterkeyhint: 'search' });
  const muscle = select('muscle', 'Muscle group', [['', 'All muscles'], ...muscles.map((m): [string, string] => [m.value, `${capitalize(m.value)} (${m.count})`])]);
  const equip = select('equipment', 'Equipment', [['', 'Any equipment'], ...equipment.map((e): [string, string] => [e.value, `${capitalize(e.value)} (${e.count})`])]);
  const show = select('show', 'Show', [['all', 'All exercises'], ['included', 'In routines'], ['excluded', 'Excluded from routines']]);

  const count = h('p', { class: 'result-count', id: 'result-count' });
  const list = h('ul', { class: 'cards', 'aria-labelledby': 'library-heading' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Clear filters');
  const empty = h('div', { class: 'empty', hidden: true }, h('p', null, 'No exercises match those filters.'), clearBtn);
  const excludeShown = h('button', { type: 'button', class: 'btn btn-small btn-quiet' }, 'Exclude shown');
  const includeShown = h('button', { type: 'button', class: 'btn btn-small btn-quiet' }, 'Include shown');

  const form = h(
    'form',
    { class: 'filters', role: 'search', 'aria-label': 'Filter exercises', onsubmit: (e: Event) => e.preventDefault() },
    h('div', { class: 'field field-search' }, h('label', { for: 'q' }, 'Search'), search),
    muscle.field,
    equip.field,
    show.field,
  );

  let current: Exercise[] = [];
  let state: FilterState = EMPTY_FILTER;

  const render = (announceCount: boolean) => {
    current = filterExercises(all, state, store.excluded);
    list.replaceChildren(...current.map(cardFor));
    const text = current.length === all.length ? `${all.length} exercises` : `${current.length} of ${all.length} exercises`;
    count.textContent = text;
    empty.hidden = current.length > 0;
    excludeShown.hidden = includeShown.hidden = current.length === 0;
    if (announceCount) announce(text);
  };

  const readForm = (): FilterState => ({
    query: search.value,
    muscle: muscle.input.value,
    equipment: equip.input.value,
    status: show.input.value as FilterState['status'],
  });

  const writeForm = (s: FilterState) => {
    search.value = s.query;
    muscle.input.value = s.muscle;
    equip.input.value = s.equipment;
    show.input.value = s.status;
  };

  const apply = (announceCount = true) => {
    state = readForm();
    const qs = filterToParams(state).toString();
    history.replaceState(history.state, '', qs ? `/?${qs}` : '/');
    render(announceCount);
  };

  let debounce: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(apply, 150);
  });
  for (const s of [muscle.input, equip.input, show.input]) s.addEventListener('change', () => apply());
  clearBtn.addEventListener('click', () => {
    writeForm(EMPTY_FILTER);
    apply();
    search.focus();
  });

  excludeShown.addEventListener('click', () => {
    store.setExcluded(current.map((e) => e.id), true);
    announce(`${current.length} exercises excluded from routines`);
    if (state.status === 'included') render(false);
  });
  includeShown.addEventListener('click', () => {
    store.setExcluded(current.map((e) => e.id), false);
    announce(`${current.length} exercises included in routines`);
    if (state.status === 'excluded') render(false);
  });

  const el = h(
    'section',
    { class: 'view library', 'aria-labelledby': 'library-heading' },
    h('div', { class: 'view-head' }, heading, h('p', { class: 'lede' }, 'Search and filter, tap an exercise for instructions, and choose which ones can appear in your routines.')),
    form,
    h('div', { class: 'results-bar' }, count, h('div', { class: 'bulk', role: 'group', 'aria-label': 'Bulk actions for shown exercises' }, excludeShown, includeShown)),
    list,
    empty,
  );

  return {
    el,
    heading,
    sync() {
      const fromUrl = filterFromParams(new URLSearchParams(location.search));
      if (JSON.stringify(fromUrl) === JSON.stringify(state) && list.childElementCount) return;
      state = fromUrl;
      writeForm(state);
      render(false);
    },
  };
}
