/**
 * The SQLite driver.
 *
 * Uses Node's built-in `node:sqlite`, which needs no native compilation and so
 * removes an entire class of install failure. It is marked experimental in Node
 * and prints a warning on first load; {@link silenceSqliteExperimentalWarning}
 * suppresses exactly that one warning and leaves every other warning intact, so
 * the CLI does not open with a scare line about a dependency the user did not
 * choose.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** The narrow slice of the driver this codebase depends on. */
export interface Db {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  run(sql: string, ...params: SqlValue[]): RunResult;
  /**
   * The generic is constrained to `object` rather than `SqlRow` so domain types
   * such as `AppliedMigration` can be used directly. Constraining to an indexed
   * type would force every such interface to declare an index signature it has
   * no use for.
   */
  get<T extends object = SqlRow>(sql: string, ...params: SqlValue[]): T | undefined;
  all<T extends object = SqlRow>(sql: string, ...params: SqlValue[]): T[];
  /**
   * Runs a function inside a transaction, rolling back if it throws.
   *
   * Needed wherever a change spans several statements and must not be half applied:
   * promoting a dashboard to default clears the old one first, so an interruption
   * between the two statements would leave the app with no default at all.
   *
   * Nested calls join the outer transaction rather than starting a second one, which
   * SQLite does not support. Callers therefore do not need to know whether they are
   * already inside one.
   */
  transaction<T>(work: () => T): T;
  close(): void;
  readonly underlying: DatabaseSync;
}

const SQLITE_EXPERIMENTAL_WARNING = 'SQLite is an experimental feature';

/**
 * Suppresses only the `node:sqlite` experimental warning.
 *
 * Implemented by filtering the process warning event rather than disabling
 * warnings wholesale, because silencing every warning would also hide genuine
 * deprecations from the user.
 */
export function silenceSqliteExperimentalWarning(): void {
  const previous = process.listeners('warning');
  process.removeAllListeners('warning');
  for (const listener of previous) {
    process.on('warning', (warning) => {
      if (warning.message.includes(SQLITE_EXPERIMENTAL_WARNING)) {
        return;
      }
      listener.call(process, warning);
    });
  }
}

/**
 * Applies the pragmas this app depends on.
 *
 * `foreign_keys` is off by default in SQLite and must be set per connection, so
 * a forgotten pragma here would silently disable referential integrity.
 *
 * `journal_mode = WAL` lets the CLI and a running API server read and write the
 * same file concurrently without blocking each other, which is what makes
 * headless capture safe while the dashboard is open.
 *
 * `busy_timeout` makes a contended write wait rather than fail immediately.
 */
const PRAGMAS: readonly string[] = [
  'PRAGMA foreign_keys = ON',
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA busy_timeout = 5000',
];

class NodeSqliteDb implements Db {
  readonly underlying: DatabaseSync;

  constructor(filename: string, pragmas: readonly string[] = PRAGMAS) {
    this.underlying = new DatabaseSync(filename);
    for (const pragma of pragmas) {
      this.underlying.exec(pragma);
    }
  }

  /** Nesting depth for `transaction`. See the interface documentation. */
  private depth = 0;

  exec(sql: string): void {
    this.underlying.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.underlying.prepare(sql);
  }

  run(sql: string, ...params: SqlValue[]): RunResult {
    const result = this.underlying.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get<T extends object = SqlRow>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.underlying.prepare(sql).get(...params) as T | undefined;
  }

  all<T extends object = SqlRow>(sql: string, ...params: SqlValue[]): T[] {
    return this.underlying.prepare(sql).all(...params) as T[];
  }

  transaction<T>(work: () => T): T {
    // Tracked with a depth counter rather than a boolean, because a repository method
    // called from inside another transaction must join it rather than fail.
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return work();
      } finally {
        this.depth -= 1;
      }
    }

    this.depth = 1;
    this.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      // Rolled back before rethrowing so the caller sees the original failure rather
      // than a "cannot commit - no transaction active" error from the rollback path.
      this.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.underlying.close();
  }
}

export interface OpenDbOptions {
  /**
   * Applied in addition to the standard pragmas. Pass an empty array for an
   * in-memory database used in tests, where WAL is meaningless.
   */
  pragmas?: readonly string[];
}

export function openDb(filename: string, options: OpenDbOptions = {}): Db {
  return new NodeSqliteDb(filename, options.pragmas ?? PRAGMAS);
}

/** An in-memory database with foreign keys enforced, for tests. */
export function openMemoryDb(): Db {
  return new NodeSqliteDb(':memory:', ['PRAGMA foreign_keys = ON']);
}

export { DatabaseSync };
