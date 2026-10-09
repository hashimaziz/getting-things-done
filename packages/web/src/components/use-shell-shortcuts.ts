/**
 * The shell's keyboard wiring.
 *
 * Lives in the shell rather than in a provider because the handlers need the
 * router and the theme, and a shortcut's meaning is "go somewhere in this
 * application" — which is a shell concern, not an application-wide one.
 *
 * Every action resolves to navigation or the theme. Actions that need a dialog, a
 * selection or an item will be added here as they are built, and each addition is
 * one line in one switch rather than a new listener.
 */

import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from '@/lib/theme-provider';
import { useShortcuts, type ShortcutHandlers } from '@/shortcuts/use-shortcuts';
import { useShortcuts as useShortcutStore } from '@/shortcuts/store';

export interface ShortcutActions {
  /** Opens the palette, used by the shell to render it. */
  openPalette: () => void;
  /** Registers the handler for `commandPalette` itself. */
  handlers: ShortcutHandlers;
}

export function useShellShortcuts(bindings: Record<string, string>, openPalette: () => void) {
  const navigate = useNavigate();
  const { toggle: toggleTheme } = useTheme();

  const handlers = useMemo<ShortcutHandlers>(
    () => ({
      commandPalette: openPalette,
      quickCapture: () => navigate('/capture'),
      newItem: () => navigate('/capture?new=1'),
      goInbox: () => navigate('/list/inbox'),
      goNextActions: () => navigate('/list/next_action'),
      goCalendar: () => navigate('/calendar'),
      goReview: () => navigate('/review'),
      toggleTheme: toggleTheme,
    }),
    [navigate, toggleTheme, openPalette],
  );

  useShortcuts({ bindings, handlers });

  return handlers;
}

/**
 * Loads the saved bindings once, when the shell mounts.
 *
 * An effect, not a render-phase call. The store is already seeded from the local
 * cache, so the shortcuts are correct on the first keypress; fetching during render
 * would be a side effect in the middle of reconciliation, which is the sort of thing
 * React is entitled to run twice.
 */
export function useLoadShortcuts(): Record<string, string> {
  const { bindings, load, loaded } = useShortcutStore();

  useEffect(() => {
    if (!loaded) {
      void load();
    }
  }, [loaded, load]);

  return bindings;
}
