/**
 * Item repository.
 *
 * Reads validate the container invariants, so an item that somehow reached the
 * database in an illegal state surfaces as a warning rather than as an
 * inexplicable gap in a list. Writes enforce the container transition rules and
 * record every change in the activity log.
 *
 * Free-text filtering and sorting live in the query module; this repository owns
 * single-row access and the write path.
 */

import {
  assertContainerInvariants,
  checkTransition,
  compileQuery,
  inferContainer,
  newId,
  nowIso,
  type ActivityEntry,
  type ActivityVerb,
  type CreateItemInput,
  type FieldDefinition,
  type FieldResolver,
  type FieldValue,
  type FilterNode,
  type Item,
  type QuerySpec,
  type SortRule,
  type UpdateItemPatch,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { translating } from '../errors.js';
import { readJson, toBool, writeJson } from '../json.js';

/**
 * Constraints an item write depends on.
 *
 * Item creates fail most often because the client referenced a category or
 * project that does not exist, so those references are named here rather than
 * surfacing as a generic foreign-key error.
 */
const WRITE_CONTEXT = {
  entity: 'Item',
  references: {
    category_id: 'category',
    project_id: 'project',
    waiting_on_person_id: 'person',
    recurrence_id: 'recurring series',
  },
} as const;

interface ItemRow {
  id: string;
  category_id: string;
  title: string;
  container: string;
  notes: string | null;
  when_at: string | null;
  deadline_on: string | null;
  estimate_min: number | null;
  project_id: string | null;
  waiting_on_person_id: string | null;
  follow_up_at: string | null;
  contexts_json: string;
  recurrence_id: string | null;
  parent_item_id: string | null;
  occurrence_date: string | null;
  is_template: number;
  data_json: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  trashed_at: string | null;
}

/**
 * The read column list.
 *
 * `is_template` is last because it was added by a later migration; keeping the
 * order stable means every SELECT here stays in step with the one in the
 * materializer.
 */
const COLUMNS = `id, category_id, title, container, notes, when_at, deadline_on, estimate_min,
  project_id, waiting_on_person_id, follow_up_at, contexts_json, recurrence_id,
  parent_item_id, occurrence_date, data_json, sort_order, created_at, updated_at,
  completed_at, trashed_at, is_template`;

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    container: row.container as Item['container'],
    notes: row.notes,
    whenAt: row.when_at,
    deadlineOn: row.deadline_on,
    estimateMinutes: row.estimate_min,
    projectId: row.project_id,
    waitingOnPersonId: row.waiting_on_person_id,
    followUpAt: row.follow_up_at,
    contextIds: readJson<string[]>(row.contexts_json, []),
    recurrenceId: row.recurrence_id,
    parentItemId: row.parent_item_id,
    occurrenceDate: row.occurrence_date,
    isTemplate: toBool(row.is_template),
    data: readJson<Record<string, FieldValue>>(row.data_json, {}),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    trashedAt: row.trashed_at,
  };
}

/**
 * Column assignments that clear state which only made sense in the container
 * being left.
 *
 * Keys are raw SQL column names, because these are fed straight to the update
 * statement rather than being read as properties of an item.
 *
 * Leaving a container clears these so a Waiting For item that becomes a next
 * action does not keep chasing a follow-up that no longer has a trigger, and a
 * calendar item that becomes a next action does not leave a stale date behind to
 * pull it back.
 */
function clearedColumnsFor(container: Item['container']): Record<string, null> {
  switch (container) {
    case 'calendar':
      // The date is what made this calendar material in the first place.
      return { when_at: null };
    case 'waiting':
      // Without a delegate there is nothing left to chase.
      return { waiting_on_person_id: null, follow_up_at: null };
    default:
      return {};
  }
}

export interface ItemsRepoOptions {
  /** Injected so tests can assert on warnings rather than writing to stderr. */
  onInvariantViolation?: (item: Item, messages: string[]) => void;
  now?: () => string;
}

export interface ItemsRepo {
  getById(id: string): Item | null;
  listByContainer(container: Item['container']): Item[];
  listAll(): Item[];
  /** Every recurring series definition. The only way to reach a template row. */
  listTemplates(): Item[];
  /** The materialised occurrences of a series, oldest first. */
  occurrencesOf(parentItemId: string): Item[];
  /** Occurrence dates already materialised for a series, for de-duplication. */
  occurrenceDatesOf(parentItemId: string): string[];
  countByContainer(): Record<string, number>;
  query(params: QueryItemsParams): QueryItemsResult;
  create(input: CreateItemInput): Item;
  update(id: string, patch: UpdateItemPatch, verb?: ActivityVerb): Item;
  setContainer(id: string, container: Item['container']): Item;
  /**
   * Marks or unmarks an item as a recurring series definition.
   *
   * Templates are excluded from every list and count, so this is what takes a
   * series definition out of circulation once it has occurrences.
   */
  setTemplateFlag(id: string, isTemplate: boolean): Item;
  /** Deletes every materialised occurrence of a series. */
  deleteOccurrencesOf(parentItemId: string): number;
  setData(id: string, data: Record<string, FieldValue>): Item;
  complete(id: string): Item;
  reopen(id: string): Item;
  trash(id: string): Item;
  restore(id: string): Item;
  remove(id: string): void;
}

export interface QueryItemsParams {
  /**
   * Built from the field definitions, so a filter naming an unknown field is
   * rejected rather than compiled.
   */
  resolver: FieldResolver;
  filter?: FilterNode | null;
  sort?: SortRule[];
  limit?: number;
  offset?: number;
}

export interface QueryItemsResult {
  items: Item[];
  /** Total rows matching the filter, ignoring limit and offset, for pagination. */
  total: number;
}

export function createItemsRepo(db: Db, options: ItemsRepoOptions = {}): ItemsRepo {
  const now = options.now ?? nowIso;
  const reportViolation =
    options.onInvariantViolation ??
    ((item, messages) => {
      console.warn(
        `[gtd] item ${item.id} (${item.title}) violates its container: ${messages.join('; ')}`,
      );
    });

  function getRaw(id: string): ItemRow | undefined {
    return db.get<ItemRow>(`SELECT ${COLUMNS} FROM items WHERE id = ?`, id);
  }

  function require(id: string): ItemRow {
    const row = getRaw(id);
    if (!row) {
      throw new ItemNotFoundError(id);
    }
    return row;
  }

  function checkInvariants(item: Item): Item {
    const violations = assertContainerInvariants({
      container: item.container,
      whenAt: item.whenAt,
      waitingOnPersonId: item.waitingOnPersonId,
      followUpAt: item.followUpAt,
      projectId: item.projectId,
    });
    if (violations.length > 0) {
      reportViolation(
        item,
        violations.map((violation) => violation.message),
      );
    }
    return item;
  }

  function log(itemId: string, verb: ActivityVerb, from: unknown, to: unknown): void {
    db.run(
      `INSERT INTO activity_log (id, item_id, verb, at, from_json, to_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      newId(),
      itemId,
      verb,
      now(),
      from === undefined ? null : writeJson(from),
      to === undefined ? null : writeJson(to),
    );
  }

  const repo: ItemsRepo = {
    getById(id: string): Item | null {
      const row = getRaw(id);
      return row ? checkInvariants(toItem(row)) : null;
    },

    listByContainer(container: Item['container']): Item[] {
      return db
        .all<ItemRow>(
          `SELECT ${COLUMNS} FROM items WHERE container = ? AND is_template = 0
           ORDER BY sort_order, created_at`,
          container,
        )
        .map(toItem)
        .map(checkInvariants);
    },

    listAll(): Item[] {
      return db
        .all<ItemRow>(`SELECT ${COLUMNS} FROM items ORDER BY created_at`)
        .map(toItem)
        .map(checkInvariants);
    },

    /**
     * Every recurring series definition.
     *
     * Templates are excluded from every other read, so this and getById are the
     * only ways to reach one.
     */
    listTemplates(): Item[] {
      return db
        .all<ItemRow>(`SELECT ${COLUMNS} FROM items WHERE is_template = 1 ORDER BY created_at`)
        .map(toItem);
    },

    /** The materialised occurrences of a series, oldest first. */
    occurrencesOf(parentItemId: string): Item[] {
      return db
        .all<ItemRow>(
          `SELECT ${COLUMNS} FROM items WHERE parent_item_id = ?
           ORDER BY occurrence_date, created_at`,
          parentItemId,
        )
        .map(toItem);
    },

    /**
     * Occurrence dates already materialised for a series, for de-duplication.
     *
     * Trashed occurrences are included on purpose. Trashing an occurrence means
     * "not this time", so recreating it would undo the user's decision. The
     * unique index on (parent, date) agrees, and backs this up: it covers trashed
     * rows too, so a trashed occurrence cannot be recreated even by accident.
     */
    occurrenceDatesOf(parentItemId: string): string[] {
      return db
        .all<{ occurrence_date: string }>(
          `SELECT DISTINCT occurrence_date FROM items
           WHERE parent_item_id = ? AND occurrence_date IS NOT NULL`,
          parentItemId,
        )
        .map((row) => row.occurrence_date);
    },

    countByContainer(): Record<string, number> {
      const rows = db.all<{ container: string; count: number }>(
        'SELECT container, count(*) AS count FROM items WHERE is_template = 0 GROUP BY container',
      );
      return Object.fromEntries(rows.map((row) => [row.container, row.count]));
    },

    query(params: QueryItemsParams): QueryItemsResult {
      const spec: QuerySpec = {
        filter: params.filter ?? null,
        ...(params.sort === undefined ? {} : { sort: params.sort }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
        ...(params.offset === undefined ? {} : { offset: params.offset }),
      };

      // Scoped so a series definition never appears in a list or a count. Passed
      // as a guard rather than spliced into the compiled text, so the WHERE the
      // COUNT reuses is literally the same string as the one the page used.
      const compiled = compileQuery(spec, params.resolver, [{ sql: 'is_template = 0' }]);

      const rows = db
        .all<ItemRow>(`SELECT ${COLUMNS} FROM items ${compiled.clause}`, ...compiled.params)
        .map(toItem)
        .map(checkInvariants);

      // The total reuses the exact WHERE and parameters, so a paged result and its
      // total can never disagree about what matched.
      const count = db.get<{ total: number }>(
        `SELECT count(*) AS total FROM items ${compiled.whereSql}`,
        ...compiled.whereParams,
      );

      return { items: rows, total: count?.total ?? rows.length };
    },

    create(input: CreateItemInput): Item {
      const id = newId();
      const timestamp = now();
      const container = inferContainer({
        whenAt: input.whenAt ?? null,
        waitingOnPersonId: input.waitingOnPersonId ?? null,
        completed: input.container === 'done',
        trashed: input.container === 'trash',
      });

      const row: ItemRow = {
        id,
        category_id: input.categoryId,
        title: input.title.trim(),
        container: input.container ?? container,
        notes: input.notes ?? null,
        when_at: input.whenAt ?? null,
        deadline_on: input.deadlineOn ?? null,
        estimate_min: input.estimateMinutes ?? null,
        project_id: input.projectId ?? null,
        waiting_on_person_id: input.waitingOnPersonId ?? null,
        follow_up_at: input.followUpAt ?? null,
        contexts_json: writeJson(input.contextIds ?? []),
        recurrence_id: input.recurrenceId ?? null,
        parent_item_id: input.parentItemId ?? null,
        occurrence_date: input.occurrenceDate ?? null,
        is_template: input.isTemplate === true ? 1 : 0,
        data_json: writeJson(input.data ?? {}),
        sort_order: input.sortOrder ?? 0,
        created_at: timestamp,
        updated_at: timestamp,
        completed_at: input.container === 'done' ? timestamp : null,
        trashed_at: input.container === 'trash' ? timestamp : null,
      };

      translating(WRITE_CONTEXT, () =>
        db.run(
          `INSERT INTO items (${COLUMNS.replace(/\s+/g, ' ')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.category_id,
          row.title,
          row.container,
          row.notes,
          row.when_at,
          row.deadline_on,
          row.estimate_min,
          row.project_id,
          row.waiting_on_person_id,
          row.follow_up_at,
          row.contexts_json,
          row.recurrence_id,
          row.parent_item_id,
          row.occurrence_date,
          row.data_json,
          row.sort_order,
          row.created_at,
          row.updated_at,
          row.completed_at,
          row.trashed_at,
          // is_template is the last column in COLUMNS, so it is the last
          // parameter. Order here must match the column list exactly.
          row.is_template,
        ),
      );

      log(id, 'created', undefined, { container: row.container });
      return checkInvariants(toItem(require(id)));
    },

    update(id: string, patch: UpdateItemPatch, verb: ActivityVerb = 'updated'): Item {
      const before = toItem(require(id));
      const target = patch.container ?? before.container;

      const check = checkTransition(before.container, target);
      if (!check.ok) {
        throw new IllegalContainerTransitionError(check.from, check.to, check.reason);
      }

      const assignments: string[] = [];
      const params: Array<string | number | null> = [];

      const set = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) {
          return;
        }
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('title', patch.title?.trim());
      set('category_id', patch.categoryId);
      set('notes', patch.notes);
      set('when_at', patch.whenAt);
      set('deadline_on', patch.deadlineOn);
      set('estimate_min', patch.estimateMinutes);
      set('project_id', patch.projectId);
      set('waiting_on_person_id', patch.waitingOnPersonId);
      set('follow_up_at', patch.followUpAt);
      set(
        'contexts_json',
        patch.contextIds === undefined ? undefined : writeJson(patch.contextIds),
      );
      set('recurrence_id', patch.recurrenceId);
      set('sort_order', patch.sortOrder);
      set('container', patch.container);
      set('data_json', patch.data === undefined ? undefined : writeJson(patch.data));

      // Leaving a container clears the fields that only made sense there, so a
      // Waiting For item that becomes a next action does not keep chasing a
      // follow-up that no longer has a trigger.
      if (patch.container !== undefined && patch.container !== before.container) {
        // Keyed on the container being *left*, since that is the one whose
        // specific fields are now meaningless.
        for (const [column, value] of Object.entries(clearedColumnsFor(before.container))) {
          set(column, value);
        }
      }

      assignments.push('updated_at = ?');
      params.push(now(), id);

      translating(WRITE_CONTEXT, () =>
        db.run(`UPDATE items SET ${assignments.join(', ')} WHERE id = ?`, ...params),
      );

      const after = toItem(require(id));
      if (patch.container !== undefined && patch.container !== before.container) {
        log(id, verb, { container: before.container }, { container: after.container });
      } else {
        log(id, verb, undefined, undefined);
      }

      return checkInvariants(after);
    },

    setContainer(id: string, container: Item['container']): Item {
      return repo.update(id, { container }, 'moved');
    },

    setTemplateFlag(id: string, isTemplate: boolean): Item {
      const row = require(id);
      translating(WRITE_CONTEXT, () =>
        db.run(
          'UPDATE items SET is_template = ?, updated_at = ? WHERE id = ?',
          isTemplate ? 1 : 0,
          now(),
          id,
        ),
      );
      log(id, 'updated', { isTemplate: toBool(row.is_template) }, { isTemplate });
      return checkInvariants(toItem(require(id)));
    },

    deleteOccurrencesOf(parentItemId: string): number {
      return translating(WRITE_CONTEXT, () =>
        db.run('DELETE FROM items WHERE parent_item_id = ?', parentItemId),
      ).changes;
    },

    setData(id: string, data: Record<string, FieldValue>): Item {
      db.run(
        'UPDATE items SET data_json = ?, updated_at = ? WHERE id = ?',
        writeJson(data),
        now(),
        id,
      );
      log(id, 'updated', undefined, { data });
      return checkInvariants(toItem(require(id)));
    },

    complete(id: string): Item {
      const timestamp = now();
      db.run(
        `UPDATE items SET container = 'done', completed_at = ?, updated_at = ? WHERE id = ?`,
        timestamp,
        timestamp,
        id,
      );
      const before = toItem(require(id));
      log(id, 'completed', { container: before.container }, { container: 'done' });
      return checkInvariants(toItem(require(id)));
    },

    reopen(id: string): Item {
      db.run(
        `UPDATE items SET container = 'next_action', completed_at = NULL, updated_at = ? WHERE id = ?`,
        now(),
        id,
      );
      log(id, 'reopened', { container: 'done' }, { container: 'next_action' });
      return checkInvariants(toItem(require(id)));
    },

    trash(id: string): Item {
      const timestamp = now();
      db.run(
        `UPDATE items SET container = 'trash', trashed_at = ?, updated_at = ? WHERE id = ?`,
        timestamp,
        timestamp,
        id,
      );
      log(id, 'trashed', undefined, undefined);
      return checkInvariants(toItem(require(id)));
    },

    restore(id: string): Item {
      db.run(
        `UPDATE items SET container = 'inbox', trashed_at = NULL, updated_at = ? WHERE id = ?`,
        now(),
        id,
      );
      log(id, 'restored', { container: 'trash' }, { container: 'inbox' });
      return checkInvariants(toItem(require(id)));
    },

    remove(id: string): void {
      db.run('DELETE FROM items WHERE id = ?', id);
    },
  };

  return repo;
}

export class ItemNotFoundError extends Error {
  readonly itemId: string;

  constructor(itemId: string) {
    super(`No item with id "${itemId}"`);
    this.name = 'ItemNotFoundError';
    this.itemId = itemId;
  }
}

export class IllegalContainerTransitionError extends Error {
  readonly from: Item['container'];
  readonly to: Item['container'];

  constructor(from: Item['container'], to: Item['container'], reason: string) {
    super(reason);
    this.name = 'IllegalContainerTransitionError';
    this.from = from;
    this.to = to;
  }
}

export type { ActivityEntry, FieldDefinition };
