type AttrValue = string | number | boolean | null | undefined;
type Attrs = Record<string, AttrValue | EventListener>;
export type Child = Node | string | number | null | undefined | false | Child[];

/**
 * Tiny element builder.
 *   h('button', { class: 'btn', type: 'button', onclick: fn }, 'Save')
 * `on*` keys add event listeners; `true` sets a boolean attribute; null/false/undefined skip it.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === 'function') {
        el.addEventListener(key.slice(2), value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else if (value !== false && value !== null && value !== undefined) {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

/** Like replaceChildren, but accepts the same optional children as h(). */
export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

/** SVG icon from a path (24×24 viewBox), hidden from assistive tech. */
export function icon(path: string, className = 'icon'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'currentColor');
  svg.appendChild(p);
  return svg;
}

export const ICONS = {
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4Z',
  prev: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12l4.6-4.6Z',
  next: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6Z',
  play: 'M8 5v14l11-7L8 5Z',
  pause: 'M6 19h4V5H6v14Zm8-14v14h4V5h-4Z',
  skip: 'M6 18l8.5-6L6 6v12Zm10-12v12h2V6h-2Z',
  share: 'M18 16.1c-.8 0-1.4.3-2 .8l-7.1-4.2c.1-.2.1-.5.1-.7s0-.5-.1-.7L16 7.2c.5.5 1.2.8 2 .8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .2 0 .5.1.7L8 9.8C7.5 9.3 6.8 9 6 9c-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 2-.8l7.1 4.2c-.1.2-.1.4-.1.6 0 1.6 1.3 2.9 2.9 2.9s2.9-1.3 2.9-2.9-1.2-2.9-2.8-2.9Z',
  download: 'M5 20h14v-2H5v2Zm14-9h-4V3H9v8H5l7 7 7-7Z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z',
  sound: 'M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.4V12ZM19 12c0 .9-.2 1.8-.5 2.6l1.5 1.5c.6-1.2 1-2.6 1-4.1 0-4.3-3-7.9-7-8.8v2.1c2.9.8 5 3.5 5 6.7ZM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.2v2.1c1.4-.3 2.7-1 3.7-1.8l2 2 1.3-1.3-9-9L4.3 3ZM12 4 9.9 6.1 12 8.2V4Z',
};

export function announce(message: string): void {
  const el = document.getElementById('announcer');
  if (!el) return;
  // Clear first so repeating the same message is still announced.
  el.textContent = '';
  window.setTimeout(() => (el.textContent = message), 50);
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
