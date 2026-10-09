/**
 * Settings repository.
 *
 * A key/value table for the handful of values that are configuration rather than
 * user data: the timezone, the first day of the week, whether setup has run, and
 * when the last weekly review happened.
 *
 * Values are JSON rather than text so a setting can be a boolean, a number or a
 * list without a parallel type column, and so reading one never has to guess how
 * to parse it.
 */

import { nowIso, SETTING_KEYS, type IsoDateTime, type Setting, type SettingKey } from '@gtd/core';
import type { Db } from '../driver.js';
import { readJson } from '../json.js';

interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
}

export interface SettingsRepo {
  get<T = unknown>(key: string): T | undefined;
  /** Typed convenience for the well-known keys. */
  getKnown<K extends SettingKey>(key: K): SettingValueMap[K] | undefined;
  getAll(): Setting[];
  set<T>(key: string, value: T): Setting<T>;
  has(key: string): boolean;
  remove(key: string): boolean;
  /** True once the setup wizard has run. Gates the wizard route. */
  isSetupComplete(): boolean;
  markSetupComplete(): void;
}

/** The declared type of each well-known setting. */
export interface SettingValueMap {
  [SETTING_KEYS.setupCompleted]: boolean;
  [SETTING_KEYS.timezone]: string;
  [SETTING_KEYS.weekStartsOn]: number;
  [SETTING_KEYS.lastWeeklyReviewAt]: IsoDateTime | null;
  [SETTING_KEYS.nextWeeklyReviewAt]: IsoDateTime | null;
}

export function createSettingsRepo(db: Db): SettingsRepo {
  const repo: SettingsRepo = {
    get<T>(key: string): T | undefined {
      const row = db.get<SettingRow>(
        'SELECT key, value_json, updated_at FROM settings WHERE key = ?',
        key,
      );
      if (!row) {
        return undefined;
      }
      return readJson<T | undefined>(row.value_json, undefined);
    },

    getKnown<K extends SettingKey>(key: K): SettingValueMap[K] | undefined {
      return repo.get<SettingValueMap[K]>(key);
    },

    getAll(): Setting[] {
      return db
        .all<SettingRow>('SELECT key, value_json, updated_at FROM settings ORDER BY key')
        .map((row) => ({
          key: row.key,
          value: readJson<unknown>(row.value_json, null),
          updatedAt: row.updated_at,
        }));
    },

    set<T>(key: string, value: T): Setting<T> {
      const updatedAt = nowIso();
      db.run(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        key,
        JSON.stringify(value ?? null),
        updatedAt,
      );
      return { key, value, updatedAt };
    },

    has(key: string): boolean {
      return (
        (db.get<{ count: number }>('SELECT count(*) AS count FROM settings WHERE key = ?', key)
          ?.count ?? 0) > 0
      );
    },

    remove(key: string): boolean {
      return db.run('DELETE FROM settings WHERE key = ?', key).changes > 0;
    },

    isSetupComplete(): boolean {
      return repo.get<boolean>(SETTING_KEYS.setupCompleted) === true;
    },

    markSetupComplete(): void {
      repo.set(SETTING_KEYS.setupCompleted, true);
    },
  };

  return repo;
}
