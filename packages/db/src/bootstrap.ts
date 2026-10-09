/**
 * Starting the application against a real data directory.
 *
 * The single sequence every entry point needs: resolve where the data is, make
 * sure the directory exists, open the database with the right pragmas, and
 * bring the schema up to date. Having one function for it means the CLI and the
 * API server cannot end up applying different migrations or different pragmas.
 */

import { APP_CONFIG } from '@gtd/core';
import { openDb, silenceSqliteExperimentalWarning, type Db } from './driver.js';
import { migrate, type MigrationReport } from './migrate.js';
import { ensureDataDir, resolvePaths, type ResolveOptions, type ResolvedPaths } from './paths.js';

export interface BootstrapOptions extends ResolveOptions {
  /** Open an in-memory database instead of touching disk. For tests. */
  inMemory?: boolean;
  /** Fail instead of reporting when a migration has drifted from its checksum. */
  strictMigrations?: boolean;
}

export interface Bootstrapped {
  db: Db;
  paths: ResolvedPaths;
  migrations: MigrationReport;
}

export class MigrationDriftError extends Error {
  readonly drifted: string[];

  constructor(drifted: string[]) {
    super(
      `Applied migrations no longer match their recorded checksum: ${drifted.join(', ')}. ` +
        'A migration was edited after it shipped. Add a new migration instead of changing an existing one.',
    );
    this.name = 'MigrationDriftError';
    this.drifted = drifted;
  }
}

export function bootstrap(options: BootstrapOptions = {}): Bootstrapped {
  silenceSqliteExperimentalWarning();

  if (options.inMemory) {
    const db = openDb(':memory:', { pragmas: ['PRAGMA foreign_keys = ON'] });
    const report = migrate(db);
    assertNoDrift(report, options.strictMigrations === true);
    return {
      db,
      paths: { dataDir: ':memory:', databasePath: ':memory:', isOverridden: true },
      migrations: report,
    };
  }

  const paths = ensureDataDir(resolvePaths(options));
  const db = openDb(paths.databasePath);
  const report = migrate(db);
  assertNoDrift(report, options.strictMigrations === true);

  return { db, paths, migrations: report };
}

function assertNoDrift(report: MigrationReport, strict: boolean): void {
  if (strict && report.drifted.length > 0) {
    throw new MigrationDriftError(report.drifted);
  }
}

/** A one-line description of where the data lives, for CLI output. */
export function describePaths(paths: ResolvedPaths): string {
  const source = paths.isOverridden
    ? `${APP_CONFIG.paths.dataDirEnvVar} override`
    : 'default location';
  return `${paths.databasePath} (${source})`;
}
