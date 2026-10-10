import meta from '../data/meta.json';
import { h } from '../dom.ts';
import { TIMING } from '../lib/reps.ts';
import type { DataMeta } from '../types.ts';

export function aboutView(): { el: HTMLElement; heading: HTMLElement } {
  const m = meta as DataMeta;
  const heading = h('h1', { id: 'about-heading', tabindex: -1 }, 'About Fitionary');
  const el = h(
    'section',
    { class: 'view about prose', 'aria-labelledby': 'about-heading' },
    h('div', { class: 'view-head' }, heading),
    h('p', null, 'Fitionary is an exercise library and workout dealer that runs entirely in your browser. There is no account and no server: your exclusions, rep settings and workouts are saved in this browser’s local storage only.'),

    h('h2', null, 'Exercise data'),
    h(
      'p',
      null,
      `${m.exerciseCount} exercises and ${m.imageCount} images come from `,
      h('a', { href: m.repository }, m.source),
      ', released into the public domain under the ',
      h('a', { href: 'https://unlicense.org' }, 'Unlicense'),
      '. Data version: ',
      h('a', { href: `${m.repository}/tree/${m.ref}` }, h('code', null, m.ref.slice(0, 12))),
      '. Thanks to the Free Exercise DB maintainers, and to ',
      h('a', { href: 'https://github.com/wrkout/exercises.json' }, 'wrkout/exercises.json'),
      ', which it builds on.',
    ),

    h('h2', null, 'How suggested reps and routine times work'),
    h('p', null, 'Each exercise gets suggested sets and reps based on its type. For example, strength moves get 3 × 8-12 and stretches get 2 × 30 s holds. You can change these for any exercise from its detail view.'),
    h(
      'p',
      null,
      `To estimate routine length, Fitionary allows ${TIMING.readySeconds} s to get ready, about ${TIMING.secondsPerRep.default} s per rep, and ${TIMING.restSeconds.default} s rest between sets, with longer rests for heavy lifts and shorter ones for stretches. A routine is filled to within about half an exercise of the length you ask for.`,
    ),

    h('h2', null, 'Safety'),
    h('p', null, 'Exercise content is for information only and is not medical advice. Consult a qualified professional before starting a new exercise programme, and stop if anything hurts.'),

    h('h2', null, 'Source code and licenses'),
    h('p', null, 'See ', h('code', null, 'LICENSES.md'), ' in the source repository for the data license and attribution details.'),
  );
  return { el, heading };
}

export function notFoundView(): { el: HTMLElement; heading: HTMLElement } {
  const heading = h('h1', { tabindex: -1 }, 'Page not found');
  return {
    heading,
    el: h('section', { class: 'view prose' }, h('div', { class: 'view-head' }, heading), h('p', null, 'That page doesn’t exist. ', h('a', { href: '/' }, 'Back to the exercise library'), '.')),
  };
}
