/**
 * Field definition repository.
 *
 * Reads go through the core Zod schema, so a stored definition that violates an
 * invariant fails at the repository boundary instead of surfacing as a rendering
 * bug later. Writes keep `is_core` and the JSON index in step with `filterable`
 * and `sortable`.
 */

import {
  createFieldDefinition,
  nowIso,
  parseFieldDefinition,
  resolveDefinitionsForCategory,
  slugifyFieldKey,
  sortFieldDefinitions,
  uniqueFieldKey,
  type CreateFieldDefinitionInput,
  type FieldDefinition,
  type UpdateFieldDefinitionInput,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { createFieldIndex, dropFieldIndex, needsIndex } from '../field-indexes.js';
import { fromBool, readJson, toBool, writeJson } from '../json.js';

interface FieldDefRow {
  id: string;
  category_id: string | null;
  key: string;
  label: string;
  description: string | null;
  type: string;
  options_json: string;
  required: number;
  default_value_json: string;
  group_label: string | null;
  show_in_table: number;
  show_in_card: number;
  filterable: number;
  sortable: number;
  is_core: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, category_id, key, label, description, type, options_json, required,
  default_value_json, group_label, show_in_table, show_in_card, filterable, sortable,
  is_core, sort_order, created_at, updated_at`;

function toDefinition(row: FieldDefRow): FieldDefinition {
  return parseFieldDefinition({
    id: row.id,
    categoryId: row.category_id,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    options: readJson(row.options_json, { kind: 'none' }),
    required: toBool(row.required),
    defaultValue: readJson(row.default_value_json, null),
    groupLabel: row.group_label,
    showInTable: toBool(row.show_in_table),
    showInCard: toBool(row.show_in_card),
    filterable: toBool(row.filterable),
    sortable: toBool(row.sortable),
    isCore: toBool(row.is_core),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface FieldDefsRepo {
  listAll(): FieldDefinition[];
  /** Category definitions plus every global one, category winning on key collision. */
  listForCategory(categoryId: string | null): FieldDefinition[];
  getById(id: string): FieldDefinition | null;
  getByKey(key: string, categoryId: string | null): FieldDefinition | null;
  create(input: CreateFieldDefinitionInput): FieldDefinition;
  update(id: string, input: UpdateFieldDefinitionInput): FieldDefinition;
  remove(id: string): void;
}

export function createFieldDefsRepo(db: Db): FieldDefsRepo {
  function all(): FieldDefinition[] {
    return db
      .all<FieldDefRow>(
        `SELECT ${COLUMNS} FROM field_defs ORDER BY sort_order, label COLLATE NOCASE`,
      )
      .map(toDefinition);
  }

  return {
    listAll(): FieldDefinition[] {
      return all();
    },

    listForCategory(categoryId: string | null): FieldDefinition[] {
      return resolveDefinitionsForCategory(all(), categoryId);
    },

    getById(id: string): FieldDefinition | null {
      const row = db.get<FieldDefRow>(`SELECT ${COLUMNS} FROM field_defs WHERE id = ?`, id);
      return row ? toDefinition(row) : null;
    },

    getByKey(key: string, categoryId: string | null): FieldDefinition | null {
      const row =
        categoryId === null
          ? db.get<FieldDefRow>(
              `SELECT ${COLUMNS} FROM field_defs WHERE key = ? AND category_id IS NULL`,
              key,
            )
          : db.get<FieldDefRow>(
              `SELECT ${COLUMNS} FROM field_defs WHERE key = ? AND category_id = ?`,
              key,
              categoryId,
            );
      return row ? toDefinition(row) : null;
    },

    create(input: CreateFieldDefinitionInput): FieldDefinition {
      // Keys must be unique within their scope, so derive against what is
      // already there rather than letting the insert fail on the unique index.
      const existingKeys = all()
        .filter((definition) => definition.categoryId === (input.categoryId ?? null))
        .map((definition) => definition.key);

      const key =
        input.key && input.key.trim() !== ''
          ? input.key.trim()
          : uniqueFieldKey(slugifyFieldKey(input.label), existingKeys);

      const definition = createFieldDefinition({ ...input, key, existingKeys });

      db.run(
        `INSERT INTO field_defs (id, category_id, key, label, description, type, options_json,
           required, default_value_json, group_label, show_in_table, show_in_card, filterable,
           sortable, is_core, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        definition.id,
        definition.categoryId,
        definition.key,
        definition.label,
        definition.description,
        definition.type,
        writeJson(definition.options),
        fromBool(definition.required),
        writeJson(definition.defaultValue),
        definition.groupLabel,
        fromBool(definition.showInTable),
        fromBool(definition.showInCard),
        fromBool(definition.filterable),
        fromBool(definition.sortable),
        fromBool(definition.isCore),
        definition.sortOrder,
        definition.createdAt,
        definition.updatedAt,
      );

      if (needsIndex(definition)) {
        createFieldIndex(db, definition);
      }

      return definition;
    },

    update(id: string, input: UpdateFieldDefinitionInput): FieldDefinition {
      const existing = this.getById(id);
      if (!existing) {
        throw new FieldDefNotFoundError(id);
      }

      const merged = {
        ...existing,
        ...input,
        // Derived values are never taken from the caller.
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      } as FieldDefinition;

      const validated = parseFieldDefinition(merged);

      db.run(
        `UPDATE field_defs SET
           category_id = ?, key = ?, label = ?, description = ?, type = ?, options_json = ?,
           required = ?, default_value_json = ?, group_label = ?, show_in_table = ?,
           show_in_card = ?, filterable = ?, sortable = ?, is_core = ?, sort_order = ?,
           updated_at = ?
         WHERE id = ?`,
        validated.categoryId,
        validated.key,
        validated.label,
        validated.description,
        validated.type,
        writeJson(validated.options),
        fromBool(validated.required),
        writeJson(validated.defaultValue),
        validated.groupLabel,
        fromBool(validated.showInTable),
        fromBool(validated.showInCard),
        fromBool(validated.filterable),
        fromBool(validated.sortable),
        fromBool(validated.isCore),
        validated.sortOrder,
        validated.updatedAt,
        id,
      );

      // Keep the JSON index in step with whether the field is queryable.
      if (needsIndex(validated)) {
        createFieldIndex(db, validated);
      } else {
        dropFieldIndex(db, id);
      }

      return validated;
    },

    remove(id: string): void {
      dropFieldIndex(db, id);
      db.run('DELETE FROM field_defs WHERE id = ?', id);
    },
  };
}

export class FieldDefNotFoundError extends Error {
  readonly fieldDefId: string;

  constructor(fieldDefId: string) {
    super(`No field definition with id "${fieldDefId}"`);
    this.name = 'FieldDefNotFoundError';
    this.fieldDefId = fieldDefId;
  }
}

export { sortFieldDefinitions };
