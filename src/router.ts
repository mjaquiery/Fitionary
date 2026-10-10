export type Route =
  | { name: 'library' }
  | { name: 'exercise'; id: string }
  | { name: 'routine' }
  | { name: 'about' }
  | { name: 'notfound' };

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'library' };
  if (path === '/routine') return { name: 'routine' };
  if (path === '/about') return { name: 'about' };
  const m = /^\/exercise\/([^/]+)$/.exec(path);
  if (m) {
    try {
      return { name: 'exercise', id: decodeURIComponent(m[1]) };
    } catch {
      return { name: 'notfound' };
    }
  }
  return { name: 'notfound' };
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function onNavigate(fn: Listener): void {
  listeners.add(fn);
}

export function navigate(url: string, { replace = false, state = null as unknown } = {}): void {
  if (replace) history.replaceState(state, '', url);
  else history.pushState(state, '', url);
  listeners.forEach((fn) => fn());
}

/** Route same-origin <a href="/..."> clicks through the History API instead of reloading. */
export function startRouter(): void {
  window.addEventListener('popstate', () => listeners.forEach((fn) => fn()));
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = (event.target as Element | null)?.closest('a');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/exercises/')) return;
    event.preventDefault();
    if (url.pathname + url.search + url.hash !== location.pathname + location.search + location.hash) {
      navigate(url.pathname + url.search + url.hash, { state: { inApp: true } });
    }
  });
}

/** True if the current history entry was reached by an in-app link (so Back stays in the app). */
export function cameFromApp(): boolean {
  return !!(history.state as { inApp?: boolean } | null)?.inApp;
}
