import './style.css';
import { isFinished } from './lib/session.ts';
import { cameFromApp, navigate, onNavigate, parseRoute, startRouter, type Route } from './router.ts';
import { store } from './store.ts';
import type { Exercise } from './types.ts';
import { aboutView, notFoundView } from './views/about.ts';
import { detailDialog } from './views/detail.ts';
import { libraryView, type LibraryView } from './views/library.ts';
import { routineView, type RoutineView } from './views/routine.ts';

const TITLES: Record<Route['name'], string> = {
  library: 'Fitionary: exercise library',
  exercise: 'Fitionary',
  routine: 'Routine · Fitionary',
  about: 'About · Fitionary',
  notfound: 'Not found · Fitionary',
};

async function boot() {
  const main = document.getElementById('main')!;
  // The dataset is a separate chunk so the page shell paints before ~1 MB of JSON parses.
  const { default: exercises } = await import('./data/exercises.json');
  store.init(exercises as Exercise[]);

  let library: LibraryView | null = null;
  let routine: RoutineView | null = null;
  let active: Route['name'] | null = null;

  const getLibrary = () => (library ??= libraryView());
  const getRoutine = () => (routine ??= routineView());

  const dialog = detailDialog(() => {
    // Closed by the user while the URL still points at the exercise: go back to the list.
    if (parseRoute(location.pathname).name !== 'exercise') return;
    if (cameFromApp()) history.back();
    else navigate('/', { replace: true });
  });

  const navBadge = document.querySelector<HTMLElement>('.nav-badge')!;
  const syncBadge = () => {
    const s = store.session;
    navBadge.hidden = !(s && s.startedAt !== null && !isFinished(s));
  };
  store.on('session', syncBadge);
  syncBadge();

  const render = () => {
    const route = parseRoute(location.pathname);
    // The detail dialog sits on top of the library.
    const base = route.name === 'exercise' ? 'library' : route.name;

    if (route.name === 'exercise') {
      const ex = store.byId.get(route.id);
      if (!ex) {
        navigate('/missing', { replace: true });
        return;
      }
      if (active !== 'library') show(base);
      dialog.open(ex);
      return;
    }
    dialog.close();
    const changed = base !== active;
    show(base);
    document.title = TITLES[route.name];
    if (changed) focusHeading();
  };

  let heading: HTMLElement | null = null;
  const focusHeading = () => heading?.focus({ preventScroll: false });

  function show(name: Route['name']) {
    if (name !== active && active === 'routine') routine?.unmount();
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-nav]')) {
      if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    let view: { el: HTMLElement; heading: HTMLElement };
    if (name === 'library') {
      view = getLibrary();
      library!.sync();
    } else if (name === 'routine') {
      view = getRoutine();
    } else if (name === 'about') {
      view = aboutView();
    } else {
      view = notFoundView();
    }
    if (name !== active || !main.contains(view.el)) {
      main.replaceChildren(view.el);
      window.scrollTo(0, 0);
    }
    if (name === 'routine' && active !== 'routine') routine!.mount();
    heading = view.heading;
    active = name;
  }

  onNavigate(render);
  startRouter();
  render();
}

boot().catch((err: unknown) => {
  console.error(err);
  const main = document.getElementById('main');
  if (main) main.innerHTML = '<p class="loading" role="alert">Sorry, Fitionary failed to load. Please refresh the page.</p>';
});
