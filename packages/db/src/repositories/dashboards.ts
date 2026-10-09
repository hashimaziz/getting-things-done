/**
 * Dashboard repository.
 *
 * A dashboard is a name and a layout: a list of widgets with positions and sizes. The
 * layout is stored as JSON because it is a document, not a relation — widgets are not
 * queried, joined or constrained independently of the dashboard that owns them.
 *
 * The one rule worth enforcing here is "exactly one default". A partial unique index on
 * `is_default` makes two defaults impossible, and that makes promotion a transaction
 * rather than a sequence of two statements that could be interrupted between. Two
 * dashboards both flagged default is a bug the user would experience as the dashboard
 * opening at random.
 */

import {
  newId,
  nowIso,
  type CreateDashboardInput,
  type Dashboard,
  type DashboardWidget,
  type UpdateDashboardPatch,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { translating } from '../errors.js';
import { readJson, writeJson } from '../json.js';

interface DashboardRow {
  id: string;
  key: string;
  name: string;
  layout_json: string;
  is_default: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, key, name, layout_json, is_default, sort_order, created_at, updated_at';

const WRITE_CONTEXT = { entity: 'Dashboard', references: {} } as const;

function toDashboard(row: DashboardRow): Dashboard {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    widgets: readJson<DashboardWidget[]>(row.layout_json, []),
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Rejects a layout that is not a list.
 *
 * Stored as JSON, so anything can be written into the column by a script or a future
 * version. A dashboard whose layout is an object rather than a list has nothing to
 * render, and rendering nothing looks like a broken dashboard rather than bad data.
 */
function encodeLayout(widgets: unknown): string {
  if (widgets !== undefined && !Array.isArray(widgets)) {
    throw new Error('A dashboard layout must be a list of widgets');
  }
  return writeJson(widgets ?? []);
}

export interface DashboardsRepo {
  list(): Dashboard[];
  getById(id: string): Dashboard | null;
  /** The dashboard the app opens on. Falls back to the first one. */
  getDefault(): Dashboard | null;
  create(input: CreateDashboardInput): Dashboard;
  update(id: string, patch: UpdateDashboardPatch): Dashboard;
  remove(id: string): void;
}

export class DashboardNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No dashboard with id "${id}"`);
    this.name = 'DashboardNotFoundError';
  }
}

export function createDashboardsRepo(db: Db): DashboardsRepo {
  const repo: DashboardsRepo = {
    list() {
      return db
        .all<DashboardRow>(
          `SELECT ${COLUMNS} FROM dashboards ORDER BY is_default DESC, sort_order, name COLLATE NOCASE`,
        )
        .map(toDashboard);
    },

    getById(id) {
      const row = db.get<DashboardRow>(`SELECT ${COLUMNS} FROM dashboards WHERE id = ?`, id);
      return row ? toDashboard(row) : null;
    },

    getDefault() {
      const row =
        db.get<DashboardRow>(`SELECT ${COLUMNS} FROM dashboards WHERE is_default = 1`) ??
        db.get<DashboardRow>(`SELECT ${COLUMNS} FROM dashboards ORDER BY sort_order LIMIT 1`);
      return row ? toDashboard(row) : null;
    },

    create(input) {
      const id = newId();
      const timestamp = nowIso();
      const layout = encodeLayout(input.widgets);

      translating(WRITE_CONTEXT, () =>
        db.transaction(() => {
          /*
           * The first dashboard to exist becomes the default, whichever flag it was
           * created with. A person who creates their first dashboard and does not tick
           * "open by default" should still find it opening.
           */
          const existing =
            db.get<{ count: number }>('SELECT count(*) AS count FROM dashboards')?.count ?? 0;

          db.run(
            `INSERT INTO dashboards (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            input.key.trim(),
            input.name.trim(),
            layout,
            existing === 0 || input.isDefault === true ? 1 : 0,
            input.sortOrder ?? 0,
            timestamp,
            timestamp,
          );

          if (input.isDefault === true) {
            promote(id);
          }
        }),
      );

      const created = repo.getById(id);
      if (!created) {
        throw new Error('Dashboard insert reported success but the row could not be read back');
      }
      return created;
    },

    update(id, patch) {
      if (repo.getById(id) === null) {
        throw new DashboardNotFoundError(id);
      }

      const assignments: string[] = [];
      const params: Array<string | number | null> = [];
      const set = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) return;
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('key', patch.key?.trim());
      set('name', patch.name?.trim());
      set('sort_order', patch.sortOrder);

      if (patch.widgets !== undefined) {
        set('layout_json', encodeLayout(patch.widgets));
      }

      translating(WRITE_CONTEXT, () =>
        db.transaction(() => {
          if (assignments.length > 0) {
            assignments.push('updated_at = ?');
            params.push(nowIso(), id);
            db.run(`UPDATE dashboards SET ${assignments.join(', ')} WHERE id = ?`, ...params);
          }
          if (patch.isDefault === true) {
            promote(id);
          }
          if (patch.isDefault === false) {
            db.run('UPDATE dashboards SET is_default = 0 WHERE id = ?', id);
          }
        }),
      );

      const updated = repo.getById(id);
      if (!updated) {
        throw new DashboardNotFoundError(id);
      }
      return updated;
    },

    remove(id) {
      if (repo.getById(id) === null) {
        throw new DashboardNotFoundError(id);
      }

      translating(WRITE_CONTEXT, () =>
        db.transaction(() => {
          const removed = db.run('DELETE FROM dashboards WHERE id = ?', id);
          /*
           * Deleting the default leaves the app with nothing to open. The next one in
           * order is promoted, so the app always has a dashboard rather than an error
           * page on start.
           */
          if (removed.changes > 0) {
            const replacement = db.get<{ id: string }>(
              'SELECT id FROM dashboards ORDER BY sort_order, name COLLATE NOCASE LIMIT 1',
            );
            if (replacement) {
              promote(replacement.id);
            }
          }
        }),
      );
    },
  };

  /** Clears every default and sets one. Must run inside a transaction. */
  function promote(id: string): void {
    db.run('UPDATE dashboards SET is_default = 0 WHERE is_default = 1 AND id <> ?', id);
    db.run('UPDATE dashboards SET is_default = 1, updated_at = ? WHERE id = ?', nowIso(), id);
  }

  return repo;
}
