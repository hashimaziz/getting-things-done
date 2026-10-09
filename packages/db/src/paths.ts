/**
 * Where the data lives on disk.
 *
 * Resolution order is `$GTD_HOME`, then `~/.gtd`. The env var exists so tests,
 * throwaway instances and multiple profiles can each keep an isolated database,
 * and so the CLI can be pointed at a specific store deliberately.
 */

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { APP_CONFIG } from '@gtd/core';

export interface ResolvedPaths {
  /** Directory holding the database and any future exports. */
  dataDir: string;
  /** Absolute path to the SQLite file. */
  databasePath: string;
  /** True when $GTD_HOME supplied the location. */
  isOverridden: boolean;
}

export interface ResolveOptions {
  /** Defaults to `process.env`. Injectable so tests do not mutate the real env. */
  env?: Record<string, string | undefined>;
  /** Overrides the home directory. Injectable for the same reason. */
  homeDir?: string;
}

/**
 * Resolves the data directory and database path.
 *
 * A relative `$GTD_HOME` is resolved against the current working directory
 * rather than the home directory, because someone who writes a relative path is
 * expressing an intent relative to where they are standing. Silently resolving it
 * against `$HOME` would put the database somewhere they never looked.
 */
export function resolvePaths(options: ResolveOptions = {}): ResolvedPaths {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const override = env[APP_CONFIG.paths.dataDirEnvVar];

  if (override !== undefined && override.trim() !== '') {
    const dataDir = isAbsolute(override.trim())
      ? resolve(override.trim())
      : resolve(process.cwd(), override.trim());
    return {
      dataDir,
      databasePath: join(dataDir, APP_CONFIG.paths.databaseFileName),
      isOverridden: true,
    };
  }

  const dataDir = join(home, APP_CONFIG.paths.dataDirName);
  return {
    dataDir,
    databasePath: join(dataDir, APP_CONFIG.paths.databaseFileName),
    isOverridden: false,
  };
}

/** Creates the data directory if it does not exist. Idempotent. */
export function ensureDataDir(paths: ResolvedPaths): ResolvedPaths {
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  return paths;
}
