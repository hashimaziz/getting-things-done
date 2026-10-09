/**
 * The migration runner.
 *
 * Applies pending migrations in ascending id order, each inside its own
 * transaction, and records it in `schema_migrations` with a checksum of the SQL.
 *
 * The checksum is what makes editing an applied migration detectable rather than
 * silently ignored. A drift check runs at startup because a schema that no longer
 * matches its migrations is the kind of failure that surfaces days later as a
 * baffling query error.
 */

import { createHash } from 'node:crypto';
import type { Db } from './driver.js';
import { MIGRATIONS, type Migration } from './schema/migrations.js';

const CREATE_MIGRATIONS_TABLE = /* sql */ `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    checksum    TEXT    NOT NULL,
    applied_at  TEXT    NOT NULL
  ) STRICT;
`;

export interface AppliedMigration {
  id: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface MigrationReport {
  applied: number[];
  alreadyApplied: number[];
  /** Names of applied migrations whose SQL no longer matches. */
  drifted: string[];
  version: number;
}

export function checksumOf(migration: Migration): string {
  // Normalise line endings so the checksum does not change with git autocrlf.
  const normalised = migration.sql.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

/** Detects duplicate or non-contiguous migration ids before anything runs. */
export function assertMigrationIdsAreSane(migrations: readonly Migration[]): void {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    seen.add(migration.id);
  }

  const ids = [...seen].sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i += 1) {
    const expected = i + 1;
    if (ids[i] !== expected) {
      throw new Error(
        `Migration ids must be contiguous starting at 1. Expected ${expected}, found ${String(ids[i])}.`,
      );
    }
  }
}

/** Brings the database up to the latest schema version. Safe to call repeatedly. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): MigrationReport {
  assertMigrationIdsAreSane(migrations);

  db.exec(CREATE_MIGRATIONS_TABLE);
  db.exec('PRAGMA foreign_keys = OFF');

  const existing = new Map<number, AppliedMigration>(
    db
      .all<AppliedMigration>('SELECT id, name, checksum, applied_at FROM schema_migrations')
      .map((row) => [row.id, row]),
  );

  const applied: number[] = [];
  const drifted: string[] = [];

  for (const migration of migrations) {
    const previous = existing.get(migration.id);
    const checksum = checksumOf(migration);

    if (previous) {
      if (previous.checksum !== checksum) {
        drifted.push(migration.name);
      }
      continue;
    }

    // One transaction per migration, so a failure leaves the schema at the last
    // good version rather than half-applied.
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.run(
        'INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        migration.id,
        migration.name,
        checksum,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.id} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    applied.push(migration.id);
  }

  db.exec('PRAGMA foreign_keys = ON');

  const version = migrations.reduce((max, migration) => Math.max(max, migration.id), 0);
  return {
    applied,
    alreadyApplied: [...existing.keys()].sort((a, b) => a - b),
    drifted,
    version,
  };
}

/** The highest applied migration id, or 0 for an empty database. */
export function currentVersion(db: Db): number {
  const exists = db.get<{ count: number }>(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (!exists || exists.count === 0) {
    return 0;
  }
  const row = db.get<{ version: number }>(
    'SELECT COALESCE(MAX(id), 0) AS version FROM schema_migrations',
  );
  return row?.version ?? 0;
}

/** True when a table exists. Used by repositories to give clearer errors. */
export function hasTable(db: Db, name: string): boolean {
  const row = db.get<{ count: number }>(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  );
  return (row?.count ?? 0) > 0;
}
