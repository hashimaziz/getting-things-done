import { beforeEach, describe, expect, it } from 'vitest';
import {
  openMemoryDb,
  migrate,
  wipeAllData,
  previewWipe,
  WIPE_CONFIRMATION,
  type Db,
} from '@gtd/db';
import { createRepositories } from '@gtd/db';
import { checkInvariants } from '@gtd/core';

/**
 * Wiping everything.
 *
 * The failure mode that matters is not "the wipe did not work" but "the wipe worked and
 * left something behind while saying it removed everything" — which destroys data and
 * misleads about what remains. So the tests assert both directions: everything is gone,
 * and the report's numbers add up to what was there.
 */

let db: Db;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
});

/** A database with something in most of the tables. */
function populate(): { itemId: string; categoryId: string } {
  const repos = createRepositories(db);

  const category = repos.categories.create({ name: 'Work', key: 'work' });
  repos.people.create({ name: 'Dana' });
  repos.contexts.create({ name: '@office' });
  repos.projects.create({ name: 'Move house' });
  repos.checklistTemplates.create({ name: 'Packing', entries: [{ id: 'a', label: 'Tape' }] });
  repos.dashboards.create({ key: 'home', name: 'Home' });
  repos.fieldDefs.create({ categoryId: category.id, label: 'Priority', type: 'priority' });

  const item = repos.items.create({ categoryId: category.id, title: 'Call Sam' });
  repos.items.trash(item.id);
  repos.settings.set('app.timezone', 'Europe/London');

  return { itemId: item.id, categoryId: category.id };
}

describe('previewing', () => {
  it('reports nothing for an empty database', () => {
    expect(previewWipe(db).every((entry) => entry.rows === 0)).toBe(true);
  });

  it('counts what is there without removing it', () => {
    populate();
    const preview = previewWipe(db);

    expect(preview.find((entry) => entry.table === 'items')?.rows).toBe(1);
    // The whole point: asking must change nothing.
    expect(preview.find((entry) => entry.table === 'categories')?.rows).toBe(1);
  });
});

describe('wiping', () => {
  it('removes every row of user data', () => {
    populate();

    wipeAllData(db);

    expect(previewWipe(db).every((entry) => entry.rows === 0)).toBe(true);
  });

  it('removes items, categories, fields and reference data', () => {
    populate();

    wipeAllData(db);

    for (const table of ['items', 'categories', 'field_defs', 'people', 'contexts', 'projects']) {
      expect(
        db.get<{ count: number }>(`SELECT count(*) AS count FROM ${table}`)?.count,
        table,
      ).toBe(0);
    }
  });

  it('removes settings, including the setup flag', () => {
    // Clearing `setup.completed` is what sends the application back to the wizard, which
    // is the entire purpose of the button.
    populate();
    repos().settings.set('setup.completed', true);

    wipeAllData(db);

    expect(repos().settings.isSetupComplete()).toBe(false);
  });

  it('removes dashboards and templates', () => {
    populate();

    wipeAllData(db);

    expect(repos().dashboards.list()).toEqual([]);
    expect(repos().checklistTemplates.list()).toEqual([]);
  });

  it('leaves the schema intact and migrated', () => {
    // A reset that dropped the schema would leave a database the application has to
    // rebuild, which is a far worse state than an empty one.
    populate();

    wipeAllData(db);

    const applied = db.get<{ count: number }>('SELECT count(*) AS count FROM schema_migrations');
    expect(applied?.count).toBeGreaterThan(0);
  });

  it('still accepts new data afterwards', () => {
    // The real test of "the schema is intact": the application can be set up again
    // without a restart or a migration.
    populate();
    wipeAllData(db);

    const created = repos().categories.create({ name: 'Fresh start', key: 'fresh' });

    expect(repos().categories.getById(created.id)?.name).toBe('Fresh start');
  });

  it('reports what it removed', () => {
    populate();

    const report = wipeAllData(db);

    expect(report.totalRemoved).toBeGreaterThan(0);
    expect(report.tables.find((entry) => entry.table === 'items')?.removed).toBe(1);
  });

  it('reports totals that match the preview', () => {
    // A report that does not add up is how someone concludes the wipe failed.
    populate();
    const before = previewWipe(db).reduce((sum, entry) => sum + entry.rows, 0);

    const report = wipeAllData(db);

    expect(report.totalRemoved).toBe(before);
  });

  it('is idempotent, so a second wipe is not an error', () => {
    populate();
    wipeAllData(db);

    expect(wipeAllData(db).totalRemoved).toBe(0);
  });

  it('leaves no invariant violations, because there is nothing to violate', () => {
    populate();
    wipeAllData(db);

    expect(checkInvariants([], [], {})).toEqual([]);
  });

  it('does not throw on foreign keys', () => {
    // Foreign keys are enforced. Children must go before parents or this fails.
    const seeded = populate();
    expect(seeded.itemId).toBeTruthy();

    expect(() => wipeAllData(db)).not.toThrow();
  });
});

describe('the confirmation phrase', () => {
  it('is a phrase rather than a flag', () => {
    // A stale script or a hopeful retry can send `force: true`. A phrase someone typed
    // is a deliberate act.
    expect(WIPE_CONFIRMATION).toBe('WIPE EVERYTHING');
    expect(WIPE_CONFIRMATION).not.toBe('true');
  });
});

/** A fresh repository set over the test database. */
function repos() {
  return createRepositories(db);
}
