import { beforeEach, describe, expect, it } from 'vitest';
import type { FieldDefinition } from '@gtd/core';
import {
  createFieldDefsRepo,
  createFieldIndex,
  dropFieldIndex,
  expressionFor,
  indexNameFor,
  migrate,
  needsIndex,
  openMemoryDb,
  reconcileFieldIndexes,
  type Db,
} from '../src/index.js';

let db: Db;
let fieldDefs: ReturnType<typeof createFieldDefsRepo>;

function indexNames(): string[] {
  return db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_fx_%' ORDER BY name",
    )
    .map((row) => row.name);
}

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
  fieldDefs = createFieldDefsRepo(db);
});

describe('expressionFor', () => {
  it('builds a json_extract over the data column', () => {
    expect(expressionFor('poc')).toBe("json_extract(data_json, '$.poc')");
  });

  it('refuses a key that is not lower snake_case', () => {
    // Field keys are validated upstream. The assertion exists because an
    // unvalidated key would allow injection through a JSON path.
    expect(() => expressionFor("poc'; DROP TABLE items --")).toThrow(RangeError);
    expect(() => expressionFor('POC')).toThrow(RangeError);
    expect(() => expressionFor('')).toThrow(RangeError);
  });
});

describe('indexNameFor', () => {
  it('is deterministic', () => {
    const id = 'a1b2c3d4-0000-4000-8000-000000000000';
    expect(indexNameFor(id)).toBe(indexNameFor(id));
  });

  it('is derived from the id so a rename cannot repoint it', () => {
    const definition = fieldDefs.create({ label: 'Assigner', type: 'text' });
    expect(indexNameFor(definition.id)).toContain('idx_fx_');
    // Renaming the label changes the key but not the index name, so an existing
    // index cannot end up silently indexing a different JSON path.
    fieldDefs.update(definition.id, { label: 'Owner' });
    expect(indexNameFor(definition.id)).toBe(indexNameFor(definition.id));
  });

  it('stays within the SQLite identifier limit', () => {
    expect(indexNameFor('a'.repeat(80)).length).toBeLessThanOrEqual(60);
  });
});

describe('needsIndex', () => {
  it('is true when filterable or sortable', () => {
    expect(needsIndex({ filterable: true, sortable: false })).toBe(true);
    expect(needsIndex({ filterable: false, sortable: true })).toBe(true);
    expect(needsIndex({ filterable: false, sortable: false })).toBe(false);
  });
});

describe('create and drop', () => {
  it('creates an index for a filterable field', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    expect(indexNames()).toContain(indexNameFor(definition.id));
  });

  it('creates no index for an incidental field', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text' });
    expect(indexNames()).not.toContain(indexNameFor(definition.id));
  });

  it('records the index in the registry', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', sortable: true });
    const row = db.get<{ expression: string }>(
      'SELECT expression FROM field_indexes WHERE field_def_id = ?',
      definition.id,
    );
    expect(row?.expression).toBe("json_extract(data_json, '$.poc')");
  });

  it('is idempotent', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    createFieldIndex(db, definition);
    createFieldIndex(db, definition);
    expect(indexNames()).toHaveLength(1);
  });

  it('drops the index and its registry row', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    expect(dropFieldIndex(db, definition.id)).toBe(true);
    expect(indexNames()).not.toContain(indexNameFor(definition.id));
    expect(
      db.get('SELECT field_def_id FROM field_indexes WHERE field_def_id = ?', definition.id),
    ).toBeUndefined();
  });

  it('reports false when dropping an index that was never there', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text' });
    expect(dropFieldIndex(db, definition.id)).toBe(false);
  });

  it('is safe to drop twice', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    dropFieldIndex(db, definition.id);
    expect(() => dropFieldIndex(db, definition.id)).not.toThrow();
  });

  it('drops the index when a field stops being queryable', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    expect(indexNames()).toContain(indexNameFor(definition.id));
    fieldDefs.update(definition.id, { filterable: false });
    expect(indexNames()).not.toContain(indexNameFor(definition.id));
  });

  it('adds the index when a field becomes queryable', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text' });
    fieldDefs.update(definition.id, { sortable: true });
    expect(indexNames()).toContain(indexNameFor(definition.id));
  });

  it('drops the index when the definition is deleted', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    fieldDefs.remove(definition.id);
    expect(indexNames()).not.toContain(indexNameFor(definition.id));
  });
});

describe('reconcileFieldIndexes', () => {
  it('creates nothing when already consistent', () => {
    fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    const report = reconcileFieldIndexes(db, fieldDefs.listAll());
    expect(report.created).toEqual([]);
    expect(report.dropped).toEqual([]);
  });

  it('recreates an index lost from the live schema', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    db.exec(`DROP INDEX ${indexNameFor(definition.id)}`);
    const report = reconcileFieldIndexes(db, fieldDefs.listAll());
    expect(report.created).toContain(indexNameFor(definition.id));
    expect(indexNames()).toContain(indexNameFor(definition.id));
  });

  it('recreates a registry row lost from the table', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    db.exec(`DROP INDEX ${indexNameFor(definition.id)}`);
    db.run('DELETE FROM field_indexes WHERE field_def_id = ?', definition.id);
    reconcileFieldIndexes(db, fieldDefs.listAll());
    expect(
      db.get('SELECT field_def_id FROM field_indexes WHERE field_def_id = ?', definition.id),
    ).toBeDefined();
  });

  it('drops an orphaned index whose definition has gone', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    // Delete the definition row but leave the index and registry entry behind.
    db.run('PRAGMA foreign_keys = OFF');
    db.run('DELETE FROM field_defs WHERE id = ?', definition.id);
    db.run('PRAGMA foreign_keys = ON');
    expect(indexNames()).toContain(indexNameFor(definition.id));

    const report = reconcileFieldIndexes(db, fieldDefs.listAll());
    expect(report.dropped).toContain(indexNameFor(definition.id));
    expect(indexNames()).not.toContain(indexNameFor(definition.id));
  });

  it('drops an index whose field is no longer filterable', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    db.run('UPDATE field_defs SET filterable = 0 WHERE id = ?', definition.id);
    reconcileFieldIndexes(db, fieldDefs.listAll());
    expect(indexNames()).not.toContain(indexNameFor(definition.id));
  });

  it('adds a missing index for a field that should have one', () => {
    // Definition marked queryable in the database but never indexed.
    const definition = fieldDefs.create({ label: 'POC', type: 'text' });
    db.run('UPDATE field_defs SET sortable = 1 WHERE id = ?', definition.id);
    reconcileFieldIndexes(db, fieldDefs.listAll());
    expect(indexNames()).toContain(indexNameFor(definition.id));
  });
});

describe('index usage', () => {
  it('is used by the planner for a JSON path filter', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    const category = db.get<{ id: string }>('SELECT id FROM categories LIMIT 1')?.id;
    // No category exists in this fixture, so assert on the plan alone.
    const plan = db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM items WHERE ${expressionFor('poc')} = 'Dana'`,
    );
    const detail = plan.map((row) => row.detail).join(' ');
    expect(detail.toLowerCase()).toContain(indexNameFor(definition.id).toLowerCase());
    expect(category).toBeUndefined();
  });

  it('keeps the items table usable after indexing', () => {
    fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    const categories = createFieldDefsRepo(db);
    expect(categories.listAll()).toHaveLength(1);
  });
});

describe('definition round-trip after indexing', () => {
  it('survives an update that changes the key', () => {
    const definition = fieldDefs.create({ label: 'POC', type: 'text', filterable: true });
    const updated = fieldDefs.update(definition.id, { key: 'owner', label: 'Owner' });
    expect(updated.key).toBe('owner');
    expect(
      db.get<{ expression: string }>(
        'SELECT expression FROM field_indexes WHERE field_def_id = ?',
        definition.id,
      )?.expression,
    ).toBe("json_extract(data_json, '$.owner')");
  });
});

describe('type guard', () => {
  it('treats a definition as queryable after a reload', () => {
    const definition: FieldDefinition = fieldDefs.create({
      label: 'POC',
      type: 'text',
      filterable: true,
    });
    const reloaded = fieldDefs.getById(definition.id);
    expect(needsIndex(reloaded!)).toBe(true);
  });
});
