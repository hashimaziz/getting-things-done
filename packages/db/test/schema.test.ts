import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../src/driver.js';
import {
  assertMigrationIdsAreSane,
  checksumOf,
  currentVersion,
  hasTable,
  migrate,
} from '../src/migrate.js';
import { LATEST_MIGRATION_ID, MIGRATIONS } from '../src/schema/migrations.js';

describe('assertMigrationIdsAreSane', () => {
  it('accepts the real migrations', () => {
    expect(() => assertMigrationIdsAreSane(MIGRATIONS)).not.toThrow();
  });

  it('rejects a duplicate id', () => {
    expect(() =>
      assertMigrationIdsAreSane([
        { id: 1, name: 'a', sql: '' },
        { id: 1, name: 'b', sql: '' },
      ]),
    ).toThrow(/Duplicate migration id/);
  });

  it('rejects a gap in the sequence', () => {
    expect(() =>
      assertMigrationIdsAreSane([
        { id: 1, name: 'a', sql: '' },
        { id: 3, name: 'c', sql: '' },
      ]),
    ).toThrow(/contiguous/);
  });

  it('rejects a sequence that does not start at 1', () => {
    expect(() => assertMigrationIdsAreSane([{ id: 2, name: 'b', sql: '' }])).toThrow(/contiguous/);
  });
});

describe('checksumOf', () => {
  it('is stable for the same SQL', () => {
    expect(checksumOf(MIGRATIONS[0]!)).toBe(checksumOf(MIGRATIONS[0]!));
  });

  it('changes when the SQL changes', () => {
    const a = checksumOf({ id: 1, name: 'a', sql: 'CREATE TABLE a (x)' });
    const b = checksumOf({ id: 1, name: 'a', sql: 'CREATE TABLE a (y)' });
    expect(a).not.toBe(b);
  });

  it('ignores line ending differences', () => {
    const a = checksumOf({ id: 1, name: 'a', sql: 'CREATE TABLE a (\n  x\n)' });
    const b = checksumOf({ id: 1, name: 'a', sql: 'CREATE TABLE a (\r\n  x\r\n)' });
    expect(a).toBe(b);
  });
});

describe('migrate', () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates the migrations table on an empty database', () => {
    migrate(db);
    expect(hasTable(db, 'schema_migrations')).toBe(true);
  });

  it('applies every migration', () => {
    const report = migrate(db);
    expect(report.applied).toEqual(MIGRATIONS.map((migration) => migration.id));
    expect(report.version).toBe(LATEST_MIGRATION_ID);
  });

  it('creates every domain table', () => {
    migrate(db);
    for (const table of [
      'categories',
      'people',
      'contexts',
      'projects',
      'recurrence_rules',
      'checklist_templates',
      'dashboards',
      'items',
      'field_defs',
      'activity_log',
      'settings',
      'field_indexes',
    ]) {
      expect(hasTable(db, table)).toBe(true);
    }
  });

  it('is idempotent', () => {
    migrate(db);
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(MIGRATIONS.map((migration) => migration.id));
  });

  it('records the version', () => {
    migrate(db);
    expect(currentVersion(db)).toBe(LATEST_MIGRATION_ID);
  });

  it('reports version 0 before migrating', () => {
    expect(currentVersion(db)).toBe(0);
  });

  it('applies only pending migrations when new ones are added', () => {
    migrate(db, [MIGRATIONS[0]!]);
    const report = migrate(db);
    expect(report.applied).toEqual([2]);
    expect(report.alreadyApplied).toEqual([1]);
  });

  it('detects an edited migration', () => {
    migrate(db);
    const tampered = [{ ...MIGRATIONS[0]!, sql: 'SELECT 1;' }];
    const report = migrate(db, [...tampered, ...MIGRATIONS.slice(1)]);
    expect(report.drifted).toEqual(['initial_schema']);
  });

  it('reports no drift for the shipped migrations', () => {
    migrate(db);
    expect(migrate(db).drifted).toEqual([]);
  });

  it('rolls back and throws when a migration fails', () => {
    expect(() =>
      migrate(db, [
        { id: 1, name: 'ok', sql: 'CREATE TABLE good (a)' },
        { id: 2, name: 'bad', sql: 'CREATE TABLE good (a)' },
      ]),
    ).toThrow(/Migration 2 \(bad\) failed/);
  });

  it('leaves the schema at the last good version after a failure', () => {
    expect(() =>
      migrate(db, [
        { id: 1, name: 'ok', sql: 'CREATE TABLE good (a)' },
        { id: 2, name: 'bad', sql: 'CREATE TABLE good (a)' },
      ]),
    ).toThrow();
    expect(hasTable(db, 'good')).toBe(true);
    expect(currentVersion(db)).toBe(1);
  });

  it('includes the original error as the cause', () => {
    try {
      migrate(db, [{ id: 1, name: 'bad', sql: 'THIS IS NOT SQL' }]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBeDefined();
    }
  });
});

describe('schema constraints', () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb();
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  function insertCategory(id: string, key = 'work'): void {
    db.run(
      `INSERT INTO categories (id, key, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      id,
      key,
      'Work',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  }

  function insertItem(overrides: Record<string, string | number | null> = {}): void {
    const row: Record<string, string | number | null> = {
      id: 'item-1',
      category_id: 'cat-1',
      title: 'Do a thing',
      container: 'next_action',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
    db.run(
      `INSERT INTO items (id, category_id, title, container, notes, when_at, deadline_on,
         estimate_min, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id as string,
      row.category_id as string,
      row.title as string,
      row.container as string,
      (row.notes ?? null) as string | null,
      (row.when_at ?? null) as string | null,
      (row.deadline_on ?? null) as string | null,
      (row.estimate_min ?? null) as number | null,
      row.created_at as string,
      row.updated_at as string,
      (row.completed_at ?? null) as string | null,
    );
  }

  it('rejects an item with an unknown container', () => {
    insertCategory('cat-1');
    expect(() => insertItem({ container: 'nope' })).toThrow();
  });

  it('rejects an item referencing a missing category', () => {
    expect(() => insertItem({ category_id: 'missing' })).toThrow();
  });

  it('rejects a negative estimate', () => {
    insertCategory('cat-1');
    expect(() => insertItem({ estimate_min: -1 })).toThrow();
  });

  it('rejects a non-integer estimate because tables are STRICT', () => {
    insertCategory('cat-1');
    expect(() => insertItem({ estimate_min: 1.5 })).toThrow();
  });

  it('rejects a boolean stored as an integer in a STRICT column', () => {
    expect(() =>
      db.run(
        `INSERT INTO categories (id, key, name, is_archived, created_at, updated_at)
         VALUES ('c', 'k', 'n', 'yes', 't', 't')`,
      ),
    ).toThrow();
  });

  it('accepts a valid item', () => {
    insertCategory('cat-1');
    expect(() => insertItem()).not.toThrow();
    expect(db.get<{ title: string }>('SELECT title FROM items WHERE id = ?', 'item-1')?.title).toBe(
      'Do a thing',
    );
  });

  it('defaults contexts_json and data_json', () => {
    insertCategory('cat-1');
    insertItem();
    const row = db.get<{ contexts_json: string; data_json: string }>(
      'SELECT contexts_json, data_json FROM items WHERE id = ?',
      'item-1',
    );
    expect(row).toEqual({ contexts_json: '[]', data_json: '{}' });
  });

  it('cascades a category delete to its field definitions', () => {
    insertCategory('cat-1');
    db.run(
      `INSERT INTO field_defs (id, category_id, key, label, type, created_at, updated_at)
       VALUES ('f1', 'cat-1', 'assigner', 'Assigner', 'text', 't', 't')`,
    );
    db.run('DELETE FROM categories WHERE id = ?', 'cat-1');
    expect(db.get('SELECT id FROM field_defs WHERE id = ?', 'f1')).toBeUndefined();
  });

  it('prevents two global field definitions from sharing a key', () => {
    const insert = (id: string) =>
      db.run(
        `INSERT INTO field_defs (id, category_id, key, label, type, created_at, updated_at)
         VALUES (?, NULL, 'priority', 'Priority', 'priority', 't', 't')`,
        id,
      );
    insert('f1');
    expect(() => insert('f2')).toThrow();
  });

  it('prevents two definitions in one category from sharing a key', () => {
    insertCategory('cat-1');
    const insert = (id: string) =>
      db.run(
        `INSERT INTO field_defs (id, category_id, key, label, type, created_at, updated_at)
         VALUES (?, 'cat-1', 'poc', 'POC', 'text', 't', 't')`,
        id,
      );
    insert('f1');
    expect(() => insert('f2')).toThrow();
  });

  it('allows the same key in two different categories', () => {
    insertCategory('cat-1', 'work');
    insertCategory('cat-2', 'home');
    const insert = (id: string, categoryId: string) =>
      db.run(
        `INSERT INTO field_defs (id, category_id, key, label, type, created_at, updated_at)
         VALUES (?, ?, 'poc', 'POC', 'text', 't', 't')`,
        id,
        categoryId,
      );
    insert('f1', 'cat-1');
    expect(() => insert('f2', 'cat-2')).not.toThrow();
  });

  it('cascades an item delete to its activity log', () => {
    insertCategory('cat-1');
    insertItem();
    db.run(
      `INSERT INTO activity_log (id, item_id, verb, at) VALUES ('a1', 'item-1', 'created', 't')`,
    );
    db.run('DELETE FROM items WHERE id = ?', 'item-1');
    expect(db.get('SELECT id FROM activity_log WHERE id = ?', 'a1')).toBeUndefined();
  });

  it('cascades a recurrence-parent delete to its occurrences', () => {
    insertCategory('cat-1');
    insertItem({ id: 'parent' });
    db.run(
      `INSERT INTO items (id, category_id, title, container, parent_item_id, created_at, updated_at)
       VALUES ('child', 'cat-1', 'Occurrence', 'next_action', 'parent', 't', 't')`,
    );
    db.run('DELETE FROM items WHERE id = ?', 'parent');
    expect(db.get('SELECT id FROM items WHERE id = ?', 'child')).toBeUndefined();
  });

  it('cascades a field definition delete to its index registry entry', () => {
    insertCategory('cat-1');
    db.run(
      `INSERT INTO field_defs (id, category_id, key, label, type, created_at, updated_at)
       VALUES ('f1', 'cat-1', 'poc', 'POC', 'text', 't', 't')`,
    );
    db.run(
      `INSERT INTO field_indexes (field_def_id, index_name, expression, created_at)
       VALUES ('f1', 'idx_x', 'json_extract(data_json, ''$.poc'')', 't')`,
    );
    db.run('DELETE FROM field_defs WHERE id = ?', 'f1');
    expect(
      db.get('SELECT field_def_id FROM field_indexes WHERE field_def_id = ?', 'f1'),
    ).toBeUndefined();
  });

  it('allows at most one default dashboard', () => {
    const insert = (id: string, key: string, isDefault: number) =>
      db.run(
        `INSERT INTO dashboards (id, key, name, layout_json, is_default, created_at, updated_at)
         VALUES (?, ?, 'D', '[]', ?, 't', 't')`,
        id,
        key,
        isDefault,
      );
    insert('d1', 'main', 1);
    expect(() => insert('d2', 'work', 1)).toThrow();
    expect(() => insert('d3', 'home', 0)).not.toThrow();
  });

  it('defaults is_default to false', () => {
    db.run(
      `INSERT INTO dashboards (id, key, name, layout_json, created_at, updated_at)
       VALUES ('d1', 'main', 'D', '[]', 't', 't')`,
    );
    expect(
      db.get<{ is_default: number }>('SELECT is_default FROM dashboards WHERE id = ?', 'd1'),
    ).toEqual({ is_default: 0 });
  });

  it('exposes json_extract over data_json', () => {
    insertCategory('cat-1');
    db.run(
      `INSERT INTO items (id, category_id, title, container, data_json, created_at, updated_at)
       VALUES ('j1', 'cat-1', 'T', 'next_action', '{"poc":"Dana"}', 't', 't')`,
    );
    const row = db.get<{ poc: string }>(
      "SELECT json_extract(data_json, '$.poc') AS poc FROM items WHERE id = 'j1'",
    );
    expect(row?.poc).toBe('Dana');
  });

  it('enables the partial calendar index only for calendar items', () => {
    const index = db.get<{ sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_when_at'",
    );
    expect(index?.sql).toContain("container = 'calendar'");
  });
});
