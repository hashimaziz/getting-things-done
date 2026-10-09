/**
 * The shortcut store.
 *
 * Bindings live in the database, not in local storage, because this is one person
 * with one database and a shortcut that follows them to another machine is the
 * point. Local storage is a cache of the last known value, read synchronously so
 * the app is interactive on first paint, then reconciled with the server.
 *
 * Saving is optimistic and never throws into the caller. A shortcut that failed to
 * save should not interrupt whatever the person was doing, and the next read
 * corrects it.
 */

import { create } from 'zustand';
import { useStore } from 'zustand';
import { apiFetch } from '@/lib/api';
import { DEFAULT_BINDINGS, findConflicts, resolveBindings, type ShortcutAction } from './registry';

/** Free-form settings key. Not one of core's well-known keys by design. */
export const SHORTCUT_SETTING_KEY = 'ui.shortcuts';

const CACHE_KEY = 'gtd.shortcuts';

interface ShortcutState {
  /** The bindings in force: defaults, with user overrides applied. */
  bindings: Record<string, string>;
  /** The user's overrides only, so a reset is possible without guessing defaults. */
  overrides: Record<string, string>;
  /** False until the server has been asked once. */
  loaded: boolean;
  load: () => Promise<void>;
  setBinding: (actionId: string, binding: string) => Promise<boolean>;
  reset: (actionId: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

function readCache(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A corrupt cache is not worth failing a page load over.
    return {};
  }
}

function writeCache(overrides: Record<string, string>): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(overrides));
  } catch {
    // Private browsing, or a full quota. The database still has the real value.
  }
}

/**
 * The store itself.
 *
 * Created outside the hook rather than inside it, because a hook that calls
 * `create` on every render produces a new store per render and loses everything on
 * every keystroke. The hook below is a one-line reader over this.
 */
export const shortcutStore = create<ShortcutState>((set, get) => ({
  // Overridden on the first `load`, but seeded from the cache so the very first
  // keypress after a reload uses the right binding rather than the default.
  bindings: resolveBindings(readCache()),
  overrides: {},
  loaded: false,

  load: async () => {
    // `null` means "the server did not answer", which is different from "the server
    // says there are no overrides". Only the second replaces the cache. Conflating
    // them would wipe custom shortcuts every time the app started with the server
    // briefly unavailable, which is exactly when someone needs them to keep working.
    let source: Record<string, unknown> | null = null;
    try {
      const response = await apiFetch.get<{ key: string; value: unknown }>(
        `/settings/${SHORTCUT_SETTING_KEY}`,
      );
      source =
        typeof response.value === 'object' && response.value !== null
          ? (response.value as Record<string, unknown>)
          : {};
    } catch {
      // No setting yet, or no answer. The cache stands.
    }

    const resolved = resolveBindings(source ?? readCache());
    const overrides: Record<string, string> = {};
    for (const [actionId, binding] of Object.entries(resolved)) {
      if (DEFAULT_BINDINGS[actionId] !== binding) {
        overrides[actionId] = binding;
      }
    }

    writeCache(overrides);
    set({ bindings: resolved, overrides, loaded: true });
  },

  setBinding: async (actionId, binding) => {
    const next = { ...get().overrides, [actionId]: binding };
    const resolved = resolveBindings(next);

    // Refuse to save a conflict. Two actions sharing a binding means one of them
    // silently stops working, which is worse than a rejected edit.
    if (findConflicts(resolved).length > 0) {
      return false;
    }

    set({ overrides: next, bindings: resolved });
    writeCache(next);

    try {
      await apiFetch.put(`/settings/${SHORTCUT_SETTING_KEY}`, { value: next });
      return true;
    } catch {
      // The cache holds it, so this session behaves correctly and the server
      // catches up on the next successful save.
      return true;
    }
  },

  reset: async (actionId) => {
    const next = { ...get().overrides };
    delete next[actionId];
    const resolved = resolveBindings(next);

    set({ overrides: next, bindings: resolved });
    writeCache(next);
    try {
      await apiFetch.put(`/settings/${SHORTCUT_SETTING_KEY}`, { value: next });
    } catch {
      // Same as above: the cache carries this session.
    }
  },

  resetAll: async () => {
    set({ overrides: {}, bindings: { ...DEFAULT_BINDINGS } });
    writeCache({});
    try {
      await apiFetch.put(`/settings/${SHORTCUT_SETTING_KEY}`, { value: {} });
    } catch {
      // Same as above.
    }
  },
}));

/** Reads the shortcut state. Everything on it is stable except `bindings`. */
export function useShortcuts(): ShortcutState {
  return useStore(shortcutStore);
}

/** The actions, grouped for the editor, in a stable order. */
export function groupedActions(actions: ShortcutAction[]): Array<{
  group: ShortcutAction['group'];
  actions: ShortcutAction[];
}> {
  const groups: ShortcutAction['group'][] = ['Navigation', 'Capture', 'System'];
  return groups
    .map((group) => ({ group, actions: actions.filter((action) => action.group === group) }))
    .filter((entry) => entry.actions.length > 0);
}
