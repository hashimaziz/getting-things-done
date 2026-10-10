/**
 * Wiping everything.
 *
 * There is a moment when a system built up over months is not the system someone wants
 * any more, and the honest way out is to delete it and start again. That needs a button,
 * because the alternative is deleting a file by hand, which is a way of wiping data
 * that also removes the directory, the WAL files and any chance of recovery.
 *
 * Two decisions make this safe rather than merely available:
 *
 * - The schema is left alone. Only rows are deleted, so the database file stays valid,
 *   migrations stay applied, and the application starts again on a known structure. A
 *   reset that dropped the schema would leave a database the app has to rebuild, and a
 *   half-removed schema is a much worse state than an empty one.
 * - Everything happens in one transaction, with foreign keys enforced. A reset that
 *   cleared items and then failed on a constraint would leave a system with categories
 *   and no items, which looks like data loss rather than like a failed reset.
 *
 * `setup.completed` is deliberately not preserved. Clearing it is what sends the
 * application back to the setup wizard, which is the whole point of the button.
 */

import type { Db } from './driver.js';

/**
 * Tables in deletion order.
 *
 * Every table holding user data, children before parents, because foreign keys are
 * enforced. Anything added to the schema later must be added here too — which is why
 * {@link assertNoTablesMissed} exists, and why the list is asserted against the schema
 * at startup rather than trusted.
 */
export const WIPE_ORDER: readonly string[] = [
  'activity_log',
  'items',
  'field_indexes',
  'recurrence_rules',
  'checklist_templates',
  'dashboards',
  'field_defs',
  'projects',
  'people',
  'contexts',
  'categories',
  'settings',
];

/**
 * Tables that exist in the schema but must not be wiped.
 *
 * Migrations bookkeeping and anything structural. There is no such table today, and the
 * list exists so that adding one is a deliberate decision rather than an omission.
 */
export const PRESERVED_TABLES: readonly string[] = ['schema_migrations'];

/** Counts before and after, so a caller can report what was removed. */
export interface WipeReport {
  tables: Array<{ table: string; removed: number }>;
  totalRemoved: number;
  elapsedMs: number;
}

/**
 * Deletes every row of user data.
 *
 * Returns what it removed rather than a bare success, because "wiped 412 items" is
 * information and "wiped" is not — it is the difference between believing the button
 * worked and having been told.
 */
export function wipeAllData(db: Db): WipeReport {
  assertNoTablesMissed(db);

  const startedAt = Date.now();
  const tables: WipeReport['tables'] = [];
  let totalRemoved = 0;

  db.transaction(() => {
    for (const table of WIPE_ORDER) {
      const result = db.run(`DELETE FROM ${table}`);
      tables.push({ table, removed: result.changes });
      totalRemoved += result.changes;
    }
  });

  return { tables, totalRemoved, elapsedMs: Date.now() - startedAt };
}

/**
 * Fails loudly when the schema contains a table the wipe does not know about.
 *
 * A new table added in a later migration and not added here would be silently left
 * behind, so the "wipe everything" button would wipe most things and quietly keep the
 * rest. That is the worst possible failure for this operation: it destroys data *and*
 * misleads about what remains.
 */
function assertNoTablesMissed(db: Db): void {
  const rows = db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const known = new Set([...WIPE_ORDER, ...PRESERVED_TABLES]);

  const unknown = rows
    .map((row: { name: string }) => row.name)
    .filter((name: string) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `Cannot wipe: the schema contains tables this build does not know how to clear (${unknown.join(', ')}). ` +
        'Add them to WIPE_ORDER or PRESERVED_TABLES so the choice is deliberate.',
    );
  }
}

/**
 * What a wipe would remove, without removing it.
 *
 * Used to show a person what they are about to lose. "This will delete 412 items" is
 * meaningfully different from a button labelled "reset", and it is the difference
 * between a decision and an accident.
 */
export function previewWipe(db: Db): Array<{ table: string; rows: number }> {
  return WIPE_ORDER.map((table) => ({
    table,
    rows: db.get<{ count: number }>(`SELECT count(*) AS count FROM ${table}`)?.count ?? 0,
  }));
}

/** The confirmation phrase, so a reset cannot happen by muscle memory. */
export const WIPE_CONFIRMATION = 'WIPE EVERYTHING';
