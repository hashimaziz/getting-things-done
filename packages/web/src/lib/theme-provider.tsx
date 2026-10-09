/**
 * Theme provider.
 *
 * Kept separate from the theme helpers so the helpers stay pure and testable
 * without React, and so there is exactly one place that talks to localStorage or
 * the DOM.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
  type ThemePreference,
} from './theme';

interface ThemeContextValue {
  /** What the user chose, which may be `system`. */
  preference: ThemePreference;
  /** What is actually rendered, with `system` resolved. */
  theme: 'light' | 'dark';
  setPreference: (value: ThemePreference) => void;
  /** Cycles light, dark, system. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const NEXT: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());

  const theme = resolveTheme(preference);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setPreference = useCallback((value: ThemePreference) => {
    writeStoredPreference(value);
    setPreferenceState(value);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setPreference,
      toggle: () => setPreference(NEXT[preference]),
    }),
    [preference, theme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return value;
}
