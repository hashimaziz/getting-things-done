/**
 * Theme handling.
 *
 * Dark mode is read from the user's operating system until they choose otherwise.
 * Once chosen, the choice is stored and wins: a dashboard open all day next to a
 * dark-themed editor should not flip to light every morning, so there is no
 * "system" ambiguity once the user has expressed a preference.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'gtd.theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** What the user asked for, falling back to `system` when unset or corrupt. */
export function readStoredPreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!store) {
    return 'system';
  }
  const stored = store.getItem(STORAGE_KEY);
  return isThemePreference(stored) ? stored : 'system';
}

export function writeStoredPreference(value: ThemePreference): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, value);
}

/**
 * Whether the OS is asking for dark. Returns false where the media query is
 * unavailable, so the default is light rather than an unreadable dark page.
 */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme actually in effect, once `system` has been resolved. */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'system' ? (prefersDark() ? 'dark' : 'light') : preference;
}

/**
 * Applies the theme by toggling a class on the root element, which is what the
 * `@custom-variant dark` selector in the stylesheet matches on.
 */
export function applyTheme(theme: 'light' | 'dark', root?: HTMLElement): void {
  const element = root ?? document.documentElement;
  element.classList.toggle('dark', theme === 'dark');
  element.style.colorScheme = theme;
}
