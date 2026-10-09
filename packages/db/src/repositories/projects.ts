/**
 * Project repository.
 *
 * A project is any outcome needing more than one action. Deliberately minimal:
 * no sub-projects, no Natural Planning Model. Those are roadmap items that build
 * on this record rather than replace it.
 *
 * The important invariant is not enforced here: every *active* project should
 * have at least one open item against it. That is a question about the items as
 * much as the project, so it is computed by `projectsWithoutNextAction` in core
 * rather than asserted against here.
 */

import {
  newId,
  nowIso,
  type CreateProjectInput,
  type Item,
  type Project,
  type ProjectStatus,
  type UpdateProjectPatch,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { translating } from '../errors.js';

interface ProjectRow {
  id: string;
  name: string;
  outcome: string | null;
  category_id: string | null;
  status: string;
  review_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, name, outcome, category_id, status, review_at, completed_at, created_at, updated_at';

const WRITE_CONTEXT = {
  entity: 'Project',
  references: { category_id: 'category' },
} as const;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    outcome: row.outcome,
    categoryId: row.category_id,
    status: row.status as ProjectStatus,
    reviewAt: row.review_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProjectsRepo {
  list(status?: ProjectStatus): Project[];
  getById(id: string): Project | null;
  /** Active projects, which is the list a weekly review works through. */
  listActive(): Project[];
  create(input: CreateProjectInput): Project;
  update(id: string, patch: UpdateProjectPatch): Project;
  /** Marks a project completed, stamping the completion time. */
  complete(id: string): Project;
  remove(id: string): void;
  /** The open items belonging to a project. */
  itemsOf(projectId: string, items: readonly Item[]): Item[];
}

export function createProjectsRepo(db: Db): ProjectsRepo {
  const repo: ProjectsRepo = {
    list(status) {
      const sql =
        status === undefined
          ? `SELECT ${COLUMNS} FROM projects ORDER BY status, name COLLATE NOCASE`
          : `SELECT ${COLUMNS} FROM projects WHERE status = ? ORDER BY name COLLATE NOCASE`;
      return (status === undefined ? db.all<ProjectRow>(sql) : db.all<ProjectRow>(sql, status)).map(
        toProject,
      );
    },

    getById(id) {
      const row = db.get<ProjectRow>(`SELECT ${COLUMNS} FROM projects WHERE id = ?`, id);
      return row ? toProject(row) : null;
    },

    listActive() {
      return db
        .all<ProjectRow>(
          `SELECT ${COLUMNS} FROM projects WHERE status = 'active' ORDER BY name COLLATE NOCASE`,
        )
        .map(toProject);
    },

    create(input) {
      const id = newId();
      const timestamp = nowIso();
      translating(WRITE_CONTEXT, () =>
        db.run(
          `INSERT INTO projects (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          input.name.trim(),
          input.outcome ?? null,
          input.categoryId ?? null,
          input.status ?? 'active',
          null,
          null,
          timestamp,
          timestamp,
        ),
      );
      const created = repo.getById(id);
      if (!created) {
        throw new Error('Project insert reported success but the row could not be read back');
      }
      return created;
    },

    update(id, patch) {
      const assignments: string[] = [];
      const params: Array<string | number | null> = [];
      const set = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) return;
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('name', patch.name?.trim());
      set('outcome', patch.outcome);
      set('category_id', patch.categoryId);
      set('status', patch.status);
      set('review_at', patch.reviewAt);

      if (assignments.length > 0) {
        assignments.push('updated_at = ?');
        params.push(nowIso(), id);
        translating(WRITE_CONTEXT, () =>
          db.run(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`, ...params),
        );
      }

      const updated = repo.getById(id);
      if (!updated) {
        throw new ProjectNotFoundError(id);
      }
      return updated;
    },

    complete(id) {
      const timestamp = nowIso();
      translating(WRITE_CONTEXT, () =>
        db.run(
          `UPDATE projects SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`,
          timestamp,
          timestamp,
          id,
        ),
      );
      const updated = repo.getById(id);
      if (!updated) {
        throw new ProjectNotFoundError(id);
      }
      return updated;
    },

    remove(id) {
      // Items keep existing; their project reference is cleared by the ON DELETE
      // SET NULL. Deleting a project should not silently delete the work.
      translating(WRITE_CONTEXT, () => db.run('DELETE FROM projects WHERE id = ?', id));
    },

    itemsOf(projectId, items) {
      return items.filter(
        (item) =>
          item.projectId === projectId && item.container !== 'done' && item.container !== 'trash',
      );
    },
  };

  return repo;
}

export class ProjectNotFoundError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super(`No project with id "${projectId}"`);
    this.name = 'ProjectNotFoundError';
    this.projectId = projectId;
  }
}
