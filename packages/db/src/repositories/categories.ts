/**
 * Category repository.
 *
 * Categories are created by the setup wizard. Nothing is seeded, so this is the
 * only place categories come into existence.
 */

import {
  nowIso,
  newId,
  type Category,
  type CreateCategoryInput,
  type UpdateCategoryPatch,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { fromBool, toBool } from '../json.js';

interface CategoryRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, key, name, description, color, icon, sort_order, is_archived,
  created_at, updated_at`;

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    isArchived: toBool(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Machine keys mirror the label, so `Work` and `work` cannot both exist. */
function deriveKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key === '' ? 'category' : key;
}

export interface CategoriesRepo {
  list(options?: { includeArchived?: boolean }): Category[];
  getById(id: string): Category | null;
  getByKey(key: string): Category | null;
  count(): number;
  create(input: CreateCategoryInput): Category;
  update(id: string, patch: UpdateCategoryPatch): Category;
  remove(id: string): void;
}

export function createCategoriesRepo(db: Db): CategoriesRepo {
  return {
    list({ includeArchived = false } = {}): Category[] {
      const sql = includeArchived
        ? `SELECT ${COLUMNS} FROM categories ORDER BY sort_order, name COLLATE NOCASE`
        : `SELECT ${COLUMNS} FROM categories WHERE is_archived = 0
           ORDER BY sort_order, name COLLATE NOCASE`;
      return db.all<CategoryRow>(sql).map(toCategory);
    },

    getById(id: string): Category | null {
      const row = db.get<CategoryRow>(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, id);
      return row ? toCategory(row) : null;
    },

    getByKey(key: string): Category | null {
      const row = db.get<CategoryRow>(`SELECT ${COLUMNS} FROM categories WHERE key = ?`, key);
      return row ? toCategory(row) : null;
    },

    count(): number {
      return db.get<{ count: number }>('SELECT count(*) AS count FROM categories')?.count ?? 0;
    },

    create(input: CreateCategoryInput): Category {
      const timestamp = nowIso();
      const id = newId();
      const suppliedKey = input.key?.trim();
      const key =
        suppliedKey === undefined || suppliedKey === '' ? deriveKey(input.name) : suppliedKey;

      db.run(
        `INSERT INTO categories (id, key, name, description, color, icon, sort_order,
           is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        id,
        key,
        input.name.trim(),
        input.description ?? null,
        input.color ?? null,
        input.icon ?? null,
        input.sortOrder ?? 0,
        timestamp,
        timestamp,
      );

      const created = this.getById(id);
      if (!created) {
        throw new Error('Category insert reported success but the row could not be read back');
      }
      return created;
    },

    update(id: string, patch: UpdateCategoryPatch): Category {
      const assignments: string[] = [];
      const params: Array<string | number | null> = [];

      const set = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) {
          return;
        }
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('key', patch.key?.trim());
      set('name', patch.name?.trim());
      set('description', patch.description);
      set('color', patch.color);
      set('icon', patch.icon);
      set('sort_order', patch.sortOrder);
      // fromBool maps undefined to null, which would be written straight into a
      // NOT NULL column. The patch key has to be checked first so that an absent
      // flag leaves the row alone.
      if (patch.isArchived !== undefined) {
        set('is_archived', fromBool(patch.isArchived));
      }

      if (assignments.length === 0) {
        const unchanged = this.getById(id);
        if (!unchanged) {
          throw new CategoryNotFoundError(id);
        }
        return unchanged;
      }

      assignments.push('updated_at = ?');
      params.push(nowIso(), id);

      db.run(`UPDATE categories SET ${assignments.join(', ')} WHERE id = ?`, ...params);

      const updated = this.getById(id);
      if (!updated) {
        throw new CategoryNotFoundError(id);
      }
      return updated;
    },

    remove(id: string): void {
      db.run('DELETE FROM categories WHERE id = ?', id);
    },
  };
}

export class CategoryNotFoundError extends Error {
  readonly categoryId: string;

  constructor(categoryId: string) {
    super(`No category with id "${categoryId}"`);
    this.name = 'CategoryNotFoundError';
    this.categoryId = categoryId;
  }
}
