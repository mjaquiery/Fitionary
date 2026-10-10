import { h, icon, ICONS, prefersReducedMotion } from '../dom.ts';
import type { Exercise } from '../types.ts';

export function frameAlt(ex: Exercise, index: number): string {
  return ex.images.length > 1 ? `${ex.name}, frame ${index + 1} of ${ex.images.length}` : `${ex.name} demonstration`;
}

/** Shown when an exercise has no images, or an image fails to load. */
export function imagePlaceholder(ex: Exercise): HTMLElement {
  return h('div', { class: 'img-placeholder', role: 'img', 'aria-label': `No image available for ${ex.name}` }, h('span', { 'aria-hidden': 'true' }, 'No image'));
}

/** Swap a broken image for the placeholder (e.g. before `npm run fetch-data` has been run). */
export function withFallback(img: HTMLImageElement, ex: Exercise): HTMLImageElement {
  img.addEventListener('error', () => img.replaceWith(imagePlaceholder(ex)), { once: true });
  return img;
}

export interface FrameViewer {
  el: HTMLElement;
  destroy(): void;
}

/**
 * Step through an exercise's frames: click/tap the image, swipe, use the
 * arrow buttons, or press ←/→ while the image has focus. With `autoplay`,
 * frames cycle until the user takes over (never with reduced motion).
 */
export function frameViewer(ex: Exercise, { autoplay = false, label = 'Exercise images' } = {}): FrameViewer {
  if (ex.images.length === 0) return { el: h('figure', { class: 'frames' }, imagePlaceholder(ex)), destroy() {} };

  let index = 0;
  const imgs = ex.images.map((src, i) =>
    withFallback(h('img', { src, alt: frameAlt(ex, i), width: 850, height: 567, decoding: 'async', hidden: i !== 0, draggable: 'false' }), ex),
  );

  if (ex.images.length === 1) {
    return { el: h('figure', { class: 'frames' }, h('div', { class: 'frames-stage' }, imgs)), destroy() {} };
  }

  const status = h('span', { class: 'frames-status', 'aria-live': 'polite' });
  const stage = h('div', {
    class: 'frames-stage is-interactive',
    tabindex: 0,
    role: 'group',
    'aria-roledescription': 'image sequence',
    'aria-label': `${label}: ${ex.name}. Press left or right arrow to change frame.`,
  }, imgs);

  const show = (i: number) => {
    index = (i + imgs.length) % imgs.length;
    imgs.forEach((img, n) => (img.hidden = n !== index));
    status.textContent = `Frame ${index + 1} of ${imgs.length}`;
  };

  let timer: number | undefined;
  const stopAutoplay = () => window.clearInterval(timer);
  const step = (delta: number) => {
    stopAutoplay();
    show(index + delta);
  };

  // Tap to advance; horizontal swipe to step either way.
  let startX: number | null = null;
  let swiped = false;
  stage.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    swiped = false;
  });
  stage.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) {
      swiped = true;
      step(dx < 0 ? 1 : -1);
    }
  });
  stage.addEventListener('click', () => {
    if (!swiped) step(1);
    swiped = false;
  });
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    }
  });

  const el = h(
    'figure',
    { class: 'frames' },
    stage,
    h(
      'figcaption',
      { class: 'frames-controls' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous frame', onclick: () => step(-1) }, icon(ICONS.prev)),
      status,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next frame', onclick: () => step(1) }, icon(ICONS.next)),
    ),
  );
  show(0);

  if (autoplay && !prefersReducedMotion()) {
    // Cycle silently: don't announce every automatic frame change.
    timer = window.setInterval(() => {
      index = (index + 1) % imgs.length;
      imgs.forEach((img, n) => (img.hidden = n !== index));
    }, 1200);
    stage.addEventListener('focus', stopAutoplay);
  }

  return { el, destroy: stopAutoplay };
}
