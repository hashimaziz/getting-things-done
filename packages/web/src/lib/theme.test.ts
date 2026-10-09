import {
  applyTheme,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
} from './theme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A Storage stand-in, so the tests do not touch the real one between files. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('preference reading', () => {
  it('defaults to following the system', () => {
    expect(readStoredPreference(fakeStorage())).toBe('system');
  });

  it('reads a stored preference', () => {
    expect(readStoredPreference(fakeStorage({ 'gtd.theme': 'dark' }))).toBe('dark');
  });

  it('ignores a corrupt stored value rather than throwing', () => {
    // An unrecognised value from an older build, or hand-edited localStorage.
    // Throwing here would leave the application unable to start.
    expect(readStoredPreference(fakeStorage({ 'gtd.theme': 'chartreuse' }))).toBe('system');
  });

  it('recognises only the three preferences', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe('resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses an explicit preference as-is', () => {
    stubMatchMedia(true);
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolves system from the media query', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('defaults to light where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applying', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
  });

  it('adds the dark class and sets color-scheme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('removes the class for light, so a stale dark class cannot persist', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('can target an element other than the document', () => {
    const root = document.createElement('div');
    applyTheme('dark', root);
    expect(root.classList.contains('dark')).toBe(true);
  });
});

describe('storage write', () => {
  it('persists the choice', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);

    writeStoredPreference('dark');

    expect(storage.map.get('gtd.theme')).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('is a no-op where storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => writeStoredPreference('dark')).not.toThrow();
    vi.unstubAllGlobals();
  });
});
