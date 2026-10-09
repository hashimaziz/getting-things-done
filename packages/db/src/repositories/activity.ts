/**
 * Reading the activity log.
 *
 * Append-only and never updated in place. It backs three features that all need
 * history rather than current state: the completed archive, the throughput charts,
 * and the per-item history view.
 */

import {
  isIsoDate,
  newId,
  type ActivityEntry,
  type ActivityVerb,
  type IsoDate,
  type IsoDateTime,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { readJson } from '../json.js';

interface ActivityRow {
  id: string;
  item_id: string;
  verb: string;
  at: string;
  from_json: string | null;
  to_json: string | null;
}

const COLUMNS = 'id, item_id, verb, at, from_json, to_json';

function toEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    itemId: row.item_id,
    verb: row.verb as ActivityVerb,
    at: row.at as IsoDateTime,
    from: readJson<Record<string, unknown> | null>(row.from_json, null),
    to: readJson<Record<string, unknown> | null>(row.to_json, null),
  };
}

export interface ListActivityParams {
  limit?: number;
  offset?: number;
  /** Restrict to one item. */
  itemId?: string;
  /** Restrict to one verb. */
  verb?: ActivityVerb;
  /** Only entries at or after this instant. */
  since?: IsoDateTime;
}

export interface ActivityRepo {
  record(entry: {
    itemId: string;
    verb: ActivityVerb;
    from?: unknown;
    to?: unknown;
    at?: IsoDateTime;
  }): ActivityEntry;
  listForItem(itemId: string, params?: ListActivityParams): ActivityEntry[];
  listRecent(params?: ListActivityParams): ActivityEntry[];
  /** Entries together with the item's title, for a global activity feed. */
  listWithTitles(params?: ListActivityParams): Array<ActivityEntry & { title: string }>;
  /** Counts by verb, for a summary panel. */
  countByVerb(since?: IsoDateTime): Record<string, number>;
  /**
   * Completion counts per calendar day, oldest first.
   *
   * Computed in SQL over the `at` column's date prefix, which is why timestamps
   * are stored as ISO 8601 UTC: the first ten characters are the calendar day and
   * can be grouped without any date parsing.
   */
  completionsPerDay(since: IsoDate): Array<{ date: IsoDate; count: number }>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export function createActivityRepo(
  db: Db,
  now: () => string = () => new Date().toISOString(),
): ActivityRepo {
  const repo: ActivityRepo = {
    record({ itemId, verb, from, to, at }): ActivityEntry {
      const id = newId();
      const timestamp = at ?? now();
      db.run(
        `INSERT INTO activity_log (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        itemId,
        verb,
        timestamp,
        from === undefined ? null : JSON.stringify(from ?? null),
        to === undefined ? null : JSON.stringify(to ?? null),
      );
      return { id, itemId, verb, at: timestamp, from: null, to: null };
    },

    listForItem(itemId, params = {}) {
      return repo.listRecent({ ...params, itemId });
    },

    listRecent(params = {}) {
      const limit = clampLimit(params.limit);
      const offset =
        params.offset === undefined || params.offset < 0 ? 0 : Math.floor(params.offset);

      const predicates: string[] = [];
      const values: Array<string | number> = [];

      if (params.itemId !== undefined) {
        predicates.push('a.item_id = ?');
        values.push(params.itemId);
      }
      if (params.verb !== undefined) {
        predicates.push('a.verb = ?');
        values.push(params.verb);
      }
      if (params.since !== undefined) {
        predicates.push('a.at >= ?');
        values.push(params.since);
      }

      const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
      const rows = db.all<ActivityRow>(
        `SELECT ${COLUMNS} FROM activity_log a ${where}
         ORDER BY a.at DESC, a.rowid DESC LIMIT ? OFFSET ?`,
        ...values,
        limit,
        offset,
      );
      return rows.map(toEntry);
    },

    listWithTitles(params = {}) {
      const limit = clampLimit(params.limit);

      // The same predicates as listRecent. The route accepts a verb filter, so
      // silently dropping it here would return the unfiltered feed and look like a
      // broken filter rather than a broken query.
      const predicates: string[] = [];
      const values: Array<string | number> = [];
      if (params.itemId !== undefined) {
        predicates.push('a.item_id = ?');
        values.push(params.itemId);
      }
      if (params.verb !== undefined) {
        predicates.push('a.verb = ?');
        values.push(params.verb);
      }
      if (params.since !== undefined) {
        predicates.push('a.at >= ?');
        values.push(params.since);
      }
      const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';

      const rows = db.all<ActivityRow & { title: string }>(
        `SELECT a.id, a.item_id, a.verb, a.at, a.from_json, a.to_json, i.title
         FROM activity_log a
         JOIN items i ON i.id = a.item_id
         ${where}
         ORDER BY a.at DESC, a.rowid DESC
         LIMIT ?`,
        ...values,
        limit,
      );
      return rows.map((row) => ({ ...toEntry(row), title: row.title }));
    },

    countByVerb(since) {
      const rows = db.all<{ verb: string; count: number }>(
        `SELECT verb, count(*) AS count FROM activity_log
         WHERE (? IS NULL OR at >= ?)
         GROUP BY verb ORDER BY verb`,
        since ?? null,
        since ?? null,
      );
      return Object.fromEntries(rows.map((row) => [row.verb, row.count]));
    },

    completionsPerDay(since) {
      // Timestamps are ISO 8601 UTC, so substr(at, 1, 10) is the calendar day.
      // Grouping here rather than in JavaScript keeps this to one row per day
      // regardless of how many completions there are.
      const rows = db.all<{ date: string; count: number }>(
        `SELECT substr(at, 1, 10) AS date, count(*) AS count
         FROM activity_log
         WHERE verb = 'completed' AND substr(at, 1, 10) >= ?
         GROUP BY date
         ORDER BY date`,
        since,
      );
      return rows
        .filter((row) => isIsoDate(row.date))
        .map((row) => ({ date: row.date as IsoDate, count: row.count }));
    },
  };

  return repo;
}
