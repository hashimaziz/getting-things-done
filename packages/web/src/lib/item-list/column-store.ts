/**
 * Per-view column configuration.
 *
 * Stored per view rather than globally, because hiding "Waiting on" from next
 * actions is right and hiding it from the waiting list is wrong, and a single global
 * setting cannot be right for both.
 *
 * Persisted the same way shortcuts are: the database is the truth, local storage is a
 * cache so the first paint is already correct.
 */

import { create } from 'zustand';
import { useStore } from 'zustand';
import { apiFetch } from '@/lib/api';
import {
  applyColumnConfig,
  defaultColumns,
  moveColumn,
  toggleHidden,
  type ColumnConfig,
  type ColumnSpec,
} from './columns';
import type { FieldDefinition } from '../types';

/** Free-form settings key, per the same reasoning as the shortcut settings. */
export const COLUMN_SETTING_KEY = 'ui.listColumns';

const CACHE_KEY = 'gtd.listColumns';

type StoredConfig = Record<string, ColumnConfig>;

interface ColumnState {
  config: StoredConfig;
  loaded: boolean;
  load: () => Promise<void>;
  /** The columns for a view, defaults with configuration applied. */
  columnsFor: (view: string, container: string, definitions: FieldDefinition[]) => ColumnSpec[];
  toggle: (view: string, key: string) => Promise<void>;
  move: (view: string, key: string, delta: number) => Promise<void>;
}

function readCache(): StoredConfig {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoredConfig) : {};
  } catch {
    return {};
  }
}

function writeCache(config: StoredConfig): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(config));
  } catch {
    // Quota or private mode. The database still has the value.
  }
}

/** The view key for a container. `list:calendar` cannot collide with a page route. */
export function viewKey(container: string): string {
  return `list:${container}`;
}

export const columnStore = create<ColumnState>((set, get) => ({
  config: readCache(),
  loaded: false,

  load: async () => {
    let source: StoredConfig | null = null;
    try {
      const response = await apiFetch.get<{ key: string; value: unknown }>(
        `/settings/${COLUMN_SETTING_KEY}`,
      );
      source =
        typeof response.value === 'object' && response.value !== null
          ? (response.value as StoredConfig)
          : {};
    } catch {
      // No answer: the cache stands, as with shortcuts.
    }

    const config = source ?? readCache();
    writeCache(config);
    set({ config, loaded: true });
  },

  columnsFor: (view, container, definitions) =>
    applyColumnConfig(defaultColumns(container, definitions), get().config[view] ?? null),

  toggle: async (view, key) => {
    const next: StoredConfig = {
      ...get().config,
      [view]: toggleHidden(get().config[view] ?? null, key),
    };
    set({ config: next });
    writeCache(next);
    await persist(next);
  },

  move: async (view, key, delta) => {
    const next: StoredConfig = {
      ...get().config,
      [view]: moveColumn(get().config[view] ?? null, key, delta),
    };
    set({ config: next });
    writeCache(next);
    await persist(next);
  },
}));

async function persist(config: StoredConfig): Promise<void> {
  try {
    await apiFetch.put(`/settings/${COLUMN_SETTING_KEY}`, { value: config });
  } catch {
    // The cache carries this session; the next successful save catches up.
  }
}

export function useColumns(): ColumnState {
  return useStore(columnStore);
}
