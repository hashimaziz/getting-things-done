/**
 * The completed archive.
 *
 * Allen's rule is that finished items are not deleted, they are filed. Keeping
 * them is what makes the throughput charts, the "when did I last do this"
 * question and the review of a pattern possible at all. An app that trashes
 * completed work has quietly turned into a to-do list.
 *
 * Queries go through the shared filter compiler, so the archive is filtered by
 * exactly the same field language as every other list, including the user's own
 * configured fields.
 */

import {
  compileQuery,
  createItemFieldResolver,
  type FieldDefinition,
  type FieldResolver,
  type FilterNode,
  type IsoDate,
  type SortRule,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { toItem, type ItemRow } from './items.js';

const COLUMNS = `id, category_id, title, container, notes, when_at, deadline_on, estimate_min,
  project_id, waiting_on_person_id, follow_up_at, contexts_json, recurrence_id,
  parent_item_id, occurrence_date, data_json, sort_order, created_at, updated_at,
  completed_at, trashed_at, is_template`;

export interface ArchiveQuery {
  resolver: FieldResolver;
  filter?: FilterNode | null;
  sort?: SortRule[];
  limit?: number;
  offset?: number;
}

export interface ArchiveResult {
  items: ReturnType<typeof toItem>[];
  /** Total matching the filter, ignoring limit and offset. */
  total: number;
}

/**
 * The base predicate every archive query carries.
 *
 * Completed is `container = 'done'`. Filtering on `completed_at` instead would be
 * wrong: reopening an item clears that timestamp but leaves it in the trash, so
 * the two disagree.
 */
const DONE_GUARD = { sql: "container = 'done' AND is_template = 0" };

/**
 * A distinct value and how often it occurs, for building a filter control.
 *
 * Only values actually present are returned. Offering an option that matches
 * nothing is worse than not offering it, because it looks like a choice and
 * silently yields an empty list.
 */
export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface Facet {
  field: string;
  label: string;
  type: string;
  /** False for a free-text field, where a closed list of options would mislead. */
  isOpen: boolean;
  values: FacetValue[];
}

export interface ArchiveRepo {
  query(params: ArchiveQuery): ArchiveResult;
  /**
   * Distinct values per field across the archived items.
   *
   * Only fields that make sense to filter on are included: text fields are open
   * ended, so a dropdown of every string ever typed would be noise.
   */
  facets(definitions: readonly FieldDefinition[], limit?: number): Facet[];
  /** Completion counts per day over a window, for the dashboard chart. */
  dailyCompletions(from: IsoDate, to: IsoDate): Array<{ date: IsoDate; count: number }>;
  /** The most recent day anything was completed, or null when nothing has been. */
  latestCompletion(): IsoDate | null;
}

export function createArchiveRepo(db: Db): ArchiveRepo {
  return {
    query(params) {
      const spec = {
        filter: params.filter ?? null,
        ...(params.sort === undefined ? {} : { sort: params.sort }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
        ...(params.offset === undefined ? {} : { offset: params.offset }),
      };

      const compiled = compileQuery(spec, params.resolver, [DONE_GUARD]);
      const items = db
        .all<ItemRow>(`SELECT ${COLUMNS} FROM items ${compiled.clause}`, ...compiled.params)
        .map(toItem);

      const total = db.get<{ total: number }>(
        `SELECT count(*) AS total FROM items ${compiled.whereSql}`,
        ...compiled.whereParams,
      );

      return { items, total: total?.total ?? items.length };
    },

    facets(definitions, limit = 25) {
      const facets: Facet[] = [];

      for (const definition of definitions) {
        if (
          definition.type === 'text' ||
          definition.type === 'longtext' ||
          definition.type === 'url'
        ) {
          // Open-ended: a closed list would imply options that do not exist.
          continue;
        }

        const resolver = createItemFieldResolver({
          fieldTypes: [{ key: definition.key, type: definition.type }],
        });
        const expression = resolver.expression(definition.key);
        const isMulti = definition.type === 'multiselect' || definition.type === 'people';

        // A multi-valued field needs json_each to reach inside the array, and the
        // count has to be distinct items: an item tagged a,b,c contributes three
        // rows, and counting rows would report three items holding "a".
        const source = isMulti
          ? `SELECT je.value AS value, count(DISTINCT items.id) AS count
               FROM items, json_each(${expression}) AS je
             WHERE ${DONE_GUARD.sql}`
          : `SELECT ${expression} AS value, count(*) AS count
               FROM items WHERE ${DONE_GUARD.sql}`;

        const blank = isMulti ? '' : ` AND ${expression} IS NOT NULL AND ${expression} != ''`;

        const rows = db.all<{ value: string | number | null; count: number }>(
          `${source}${blank} GROUP BY value ORDER BY count DESC, value LIMIT ?`,
          limit,
        );

        const values: FacetValue[] = [];
        for (const row of rows) {
          const asString = row.value === null ? '' : String(row.value);
          // An empty JSON array rendered as text is not a value anyone should pick.
          if (asString === '' || asString === '[]' || asString === '{}') {
            continue;
          }
          values.push({
            value: asString,
            label:
              definition.options.kind === 'choices'
                ? (definition.options.choices.find((choice) => choice.value === asString)?.label ??
                  asString)
                : asString,
            count: row.count,
          });
        }

        if (values.length > 0) {
          facets.push({
            field: definition.key,
            label: definition.label,
            type: definition.type,
            // Numeric and temporal fields take a range rather than a choice, so
            // the control should not present them as a closed list.
            isOpen: !isMulti && definition.type !== 'select' && definition.type !== 'priority',
            values,
          });
        }
      }

      return facets;
    },

    dailyCompletions(from, to) {
      const rows = db.all<{ date: string; count: number }>(
        `SELECT substr(completed_at, 1, 10) AS date, count(*) AS count
         FROM items
         WHERE container = 'done' AND is_template = 0 AND completed_at IS NOT NULL
           AND substr(completed_at, 1, 10) BETWEEN ? AND ?
         GROUP BY date ORDER BY date`,
        from,
        to,
      );
      return rows.map((row: { date: string; count: number }) => ({
        date: row.date as IsoDate,
        count: row.count,
      }));
    },

    latestCompletion() {
      const row = db.get<{ date: string | null }>(
        `SELECT substr(MAX(completed_at), 1, 10) AS date FROM items
         WHERE container = 'done' AND is_template = 0 AND completed_at IS NOT NULL`,
      );
      return row?.date ?? null;
    },
  };
}
