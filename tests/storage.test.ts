// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStringArray, load, remove, save } from '../src/lib/storage.ts';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('storage', () => {
  it('round-trips values under a namespaced key', () => {
    expect(save('excluded', ['a', 'b'])).toBe(true);
    expect(localStorage.getItem('fitionary:v1:excluded')).toBe('["a","b"]');
    expect(load('excluded', [], isStringArray)).toEqual(['a', 'b']);
  });

  it('falls back when missing, unparseable or invalid', () => {
    expect(load('missing', ['x'], isStringArray)).toEqual(['x']);
    localStorage.setItem('fitionary:v1:bad', '{not json');
    expect(load('bad', [], isStringArray)).toEqual([]);
    localStorage.setItem('fitionary:v1:wrong', '[1,2]');
    expect(load('wrong', ['y'], isStringArray)).toEqual(['y']);
  });

  it('removes values', () => {
    save('k', ['v']);
    remove('k');
    expect(load('k', [], isStringArray)).toEqual([]);
  });

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(load('k', ['fallback'], isStringArray)).toEqual(['fallback']);
    expect(save('k', ['v'])).toBe(false);
  });
});
