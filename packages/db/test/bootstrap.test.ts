import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@gtd/core';
import {
  MigrationDriftError,
  bootstrap,
  currentVersion,
  describePaths,
  hasTable,
  resolvePaths,
} from '../src/index.js';

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'gtd-db-test-'));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('resolvePaths', () => {
  it('defaults to the data directory inside the home directory', () => {
    const paths = resolvePaths({ env: {}, homeDir: '/home/tester' });
    expect(paths.dataDir).toBe(`/home/tester/${APP_CONFIG.paths.dataDirName}`);
    expect(paths.databasePath).toBe(
      `/home/tester/${APP_CONFIG.paths.dataDirName}/${APP_CONFIG.paths.databaseFileName}`,
    );
    expect(paths.isOverridden).toBe(false);
  });

  it('honours the env var override', () => {
    const paths = resolvePaths({
      env: { [APP_CONFIG.paths.dataDirEnvVar]: '/tmp/custom-store' },
      homeDir: '/home/tester',
    });
    expect(paths.dataDir).toBe('/tmp/custom-store');
    expect(paths.isOverridden).toBe(true);
  });

  it('resolves a relative override against the working directory', () => {
    // Someone writing a relative path is expressing intent relative to where
    // they are, not relative to $HOME.
    const paths = resolvePaths({
      env: { [APP_CONFIG.paths.dataDirEnvVar]: './store' },
      homeDir: '/home/tester',
    });
    expect(paths.dataDir).toBe(join(process.cwd(), 'store'));
  });

  it('treats a blank env var as unset', () => {
    const paths = resolvePaths({
      env: { [APP_CONFIG.paths.dataDirEnvVar]: '   ' },
      homeDir: '/home/tester',
    });
    expect(paths.isOverridden).toBe(false);
  });

  it('reads the real process env by default', () => {
    // Sanity check that the default path is wired, without asserting the
    // developer's actual home directory.
    expect(resolvePaths().dataDir).toContain(APP_CONFIG.paths.dataDirName);
  });
});

describe('bootstrap', () => {
  it('creates the data directory if missing', () => {
    const target = join(tempRoot, 'nested', 'store');
    expect(existsSync(target)).toBe(false);
    const result = bootstrap({ env: { [APP_CONFIG.paths.dataDirEnvVar]: target } });
    expect(existsSync(target)).toBe(true);
    result.db.close();
  });

  it('creates the database file', () => {
    const target = join(tempRoot, 'store');
    const result = bootstrap({ env: { [APP_CONFIG.paths.dataDirEnvVar]: target } });
    expect(existsSync(result.paths.databasePath)).toBe(true);
    result.db.close();
  });

  it('brings the schema fully up to date', () => {
    const result = bootstrap({ env: { [APP_CONFIG.paths.dataDirEnvVar]: tempRoot } });
    expect(result.migrations.applied.length).toBeGreaterThan(0);
    expect(hasTable(result.db, 'items')).toBe(true);
    expect(currentVersion(result.db)).toBe(result.migrations.version);
    result.db.close();
  });

  it('is safe to run twice against the same directory', () => {
    const env = { [APP_CONFIG.paths.dataDirEnvVar]: tempRoot };
    const first = bootstrap({ env });
    first.db.close();
    const second = bootstrap({ env });
    expect(second.migrations.applied).toEqual([]);
    second.db.close();
  });

  it('enables WAL so the CLI and server can share the file', () => {
    const result = bootstrap({ env: { [APP_CONFIG.paths.dataDirEnvVar]: tempRoot } });
    const mode = result.db.get<{ journal_mode: string }>('PRAGMA journal_mode');
    expect(mode?.journal_mode).toBe('wal');
    result.db.close();
  });

  it('enables foreign keys', () => {
    const result = bootstrap({ env: { [APP_CONFIG.paths.dataDirEnvVar]: tempRoot } });
    const fk = result.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
    result.db.close();
  });

  it('supports in-memory databases without touching disk', () => {
    const result = bootstrap({ inMemory: true });
    expect(hasTable(result.db, 'items')).toBe(true);
    result.db.close();
  });

  it('applies the full schema without throwing in the default mode', () => {
    const result = bootstrap({ inMemory: true });
    expect(result.migrations.drifted).toEqual([]);
    result.db.close();
  });
});

describe('MigrationDriftError', () => {
  it('names the drifted migrations', () => {
    expect(new MigrationDriftError(['initial_schema']).message).toContain('initial_schema');
  });

  it('explains the cause and the correct remedy', () => {
    const error = new MigrationDriftError(['initial_schema']);
    expect(error.message).toContain('edited after it shipped');
    expect(error.message).toContain('Add a new migration');
  });

  it('exposes the drifted names for programmatic use', () => {
    expect(new MigrationDriftError(['a', 'b']).drifted).toEqual(['a', 'b']);
  });

  it('is an Error', () => {
    expect(new MigrationDriftError([])).toBeInstanceOf(Error);
  });
});

describe('describePaths', () => {
  it('names the env var when overridden', () => {
    const paths = resolvePaths({
      env: { [APP_CONFIG.paths.dataDirEnvVar]: '/tmp/store' },
      homeDir: '/home/tester',
    });
    expect(describePaths(paths)).toContain(APP_CONFIG.paths.dataDirEnvVar);
  });

  it('says default location otherwise', () => {
    const paths = resolvePaths({ env: {}, homeDir: '/home/tester' });
    expect(describePaths(paths)).toContain('default location');
  });

  it('always includes the database path', () => {
    const paths = resolvePaths({ env: {}, homeDir: '/home/tester' });
    expect(describePaths(paths)).toContain(paths.databasePath);
  });
});
