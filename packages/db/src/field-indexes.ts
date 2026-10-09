/**
 * The lazily-created expression indexes over `items.data_json`.
 *
 * Any user-defined field can be marked filterable or sortable at any time. SQLite
 * can index a JSON path directly, so instead of migrating `items` to a real
 * column, an index is created on `json_extract(data_json, '$.<key>')` on demand.
 *
 * Every such index is recorded in `field_indexes` so it can be dropped again when
 * a field is un-marked, and so startup can tell the difference between "index
 * should exist but does not" and "index was never requested". Without the
 * registry, un-marking a field would leave the index behind forever, which is
 * slow but silent.
 */

import type { FieldDefinition } from '@gtd/core';
import type { Db } from './driver.js';
import { nowIso } from '@gtd/core';

/** Maximum length of a SQLite identifier. */
const MAX_IDENTIFIER_LENGTH = 60;

/**
 * Deterministic index name for a field definition.
 *
 * Derived from the definition id rather than the field key so that renaming a
 * field does not silently repoint an existing index at a different JSON path.
 */
export function indexNameFor(fieldDefId: string): string {
  return `idx_fx_${fieldDefId.replace(/-/g, '')}`.slice(0, MAX_IDENTIFIER_LENGTH);
}

/**
 * The indexed expression for a field.
 *
 * Field keys are validated to lower snake_case before they reach this point, so
 * interpolation is safe. The assertion makes that guarantee explicit rather than
 * assumed, because an unvalidated key would allow SQL injection through a JSON
 * path.
 */
export function expressionFor(key: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
    throw new RangeError(`Refusing to index an invalid field key: ${key}`);
  }
  return `json_extract(data_json, '$.${key}')`;
}

function indexExists(db: Db, name: string): boolean {
  return (
    (db.get<{ count: number }>(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
      name,
    )?.count ?? 0) > 0
  );
}

function dropIndexIfExists(db: Db, name: string): boolean {
  if (!indexExists(db, name)) {
    return false;
  }
  db.exec(`DROP INDEX ${name}`);
  return true;
}

/** Creates the index for a field if it is missing, and records it. */
export function createFieldIndex(db: Db, definition: FieldDefinition): void {
  const indexName = indexNameFor(definition.id);
  if (!indexExists(db, indexName)) {
    db.exec(`CREATE INDEX ${indexName} ON items (${expressionFor(definition.key)})`);
  }
  db.run(
    `INSERT INTO field_indexes (field_def_id, index_name, expression, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (field_def_id) DO UPDATE SET
       index_name = excluded.index_name,
       expression = excluded.expression`,
    definition.id,
    indexName,
    expressionFor(definition.key),
    nowIso(),
  );
}

/** Drops the index for a field, if one exists. Safe to call repeatedly. */
export function dropFieldIndex(db: Db, fieldDefId: string): boolean {
  const recorded = db.get<{ index_name: string }>(
    'SELECT index_name FROM field_indexes WHERE field_def_id = ?',
    fieldDefId,
  );
  const name = recorded?.index_name ?? indexNameFor(fieldDefId);
  const dropped = dropIndexIfExists(db, name);
  db.run('DELETE FROM field_indexes WHERE field_def_id = ?', fieldDefId);
  return dropped;
}

/** True when a field definition should have an index. */
export function needsIndex(definition: Pick<FieldDefinition, 'filterable' | 'sortable'>): boolean {
  return definition.filterable || definition.sortable;
}

export interface ReconcileReport {
  created: string[];
  dropped: string[];
}

/**
 * Brings the live indexes in line with the field definitions.
 *
 * Run at startup. Catches three drift cases that would otherwise be invisible
 * until a query got mysteriously slow: a field marked filterable whose index was
 * lost, an index whose registry row went missing, and an orphaned index left
 * behind by a definition that no longer exists.
 */
export function reconcileFieldIndexes(db: Db, definitions: FieldDefinition[]): ReconcileReport {
  const created: string[] = [];
  const dropped: string[] = [];

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  const registered = db.all<{ field_def_id: string; index_name: string }>(
    'SELECT field_def_id, index_name FROM field_indexes',
  );

  for (const row of registered) {
    const definition = byId.get(row.field_def_id);
    const shouldExist = definition !== undefined && needsIndex(definition);

    if (!shouldExist) {
      if (dropIndexIfExists(db, row.index_name)) {
        dropped.push(row.index_name);
      }
      db.run('DELETE FROM field_indexes WHERE field_def_id = ?', row.field_def_id);
      continue;
    }

    // Registered but absent from the schema, e.g. after a manual index drop.
    if (!indexExists(db, row.index_name)) {
      createFieldIndex(db, definition);
      created.push(row.index_name);
    }
  }

  // A definition that wants an index but has no registry row at all.
  for (const definition of definitions) {
    if (!needsIndex(definition)) {
      continue;
    }
    if (indexExists(db, indexNameFor(definition.id))) {
      continue;
    }
    createFieldIndex(db, definition);
    created.push(indexNameFor(definition.id));
  }

  return { created, dropped };
}
