import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createItemFieldResolver } from '@gtd/core';
import { createRepositories, migrate, openDb, resolvePaths, type Db } from '@gtd/db';
import { runCli } from '../src/bin.js';

/**
 * The headless CLI.
 *
 * `runCli` takes an injected home directory and streams, which is what makes it
 * testable at all — and the earlier version had no tests despite being written that way.
 * A command meant for scripts is exactly the kind of code whose bugs stay invisible
 * until a script depends on them.
 *
 * Every test runs the real binary entry point against a real SQLite file in a temporary
 * directory, so the argument parsing, the bootstrap and the repositories are all
 * exercised together rather than mocked apart.
 */

let home: string;
let out: string[];
let err: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'gtd-cli-'));
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

async function cli(...argv: string[]): Promise<number> {
  return runCli(argv, {
    homeDir: home,
    stdout: { write: (value) => out.push(value) },
    stderr: { write: (value) => err.push(value) },
  });
}

function output(): string {
  return out.join('');
}

/**
 * Opens the CLI's database directly, for reading back what the CLI wrote.
 *
 * The path comes from `resolvePaths` rather than being spelled out here, and `env` is
 * emptied on purpose: an ambient `GTD_HOME` would otherwise redirect the test at a real
 * database — and a test that writes to a real database is worse than no test.
 */
/**
 * A field resolver over the configured definitions.
 *
 * The query engine needs one, and a resolver that knows no fields makes every custom
 * field filter match nothing — which is the same class of silent wrong answer these
 * tests exist to catch.
 */
function fieldResolver(db: Db): ReturnType<typeof createItemFieldResolver> {
  const definitions = createRepositories(db).fieldDefs.listAll();
  return createItemFieldResolver({
    fieldTypes: definitions.map((definition) => ({ key: definition.key, type: definition.type })),
  });
}

function withDb<T>(work: (repos: ReturnType<typeof createRepositories>, db: Db) => T): T {
  const paths = resolvePaths({ homeDir: home, env: {} });
  // The data directory is created by bootstrap, not by opening a file. The test reads
  // the database before the CLI has ever run in this directory, so it creates it here.
  mkdirSync(paths.dataDir, { recursive: true });
  const db = openDb(paths.databasePath, { pragmas: ['PRAGMA foreign_keys = ON'] });
  migrate(db);
  try {
    return work(createRepositories(db), db);
  } finally {
    db.close();
  }
}

/** A database with one category, which capture needs somewhere to put things. */
function seedCategory(name = 'Work'): void {
  withDb((repos) => repos.categories.create({ name, key: name.toLowerCase() }));
}

/**
 * An item the way the CLI would create one.
 *
 * Explicitly in the inbox: the repository's own default container is `next_action`, and
 * a helper that relied on the default would quietly test the wrong list.
 */
function captureOne(title = 'Call Sam'): string {
  seedCategory();
  return withDb((repos) => {
    const category = repos.categories.list()[0];
    if (category === undefined) throw new Error('category missing');
    return repos.items.create({ categoryId: category.id, title, container: 'inbox' }).id;
  });
}

function inboxItems(): Array<{ id: string; title: string; container: string }> {
  return withDb((repos, db) =>
    repos.items
      .query({ resolver: fieldResolver(db), filter: null, sort: [], limit: 50 })
      .items.map((item) => ({ id: item.id, title: item.title, container: item.container })),
  );
}

describe('help', () => {
  it('prints usage for no arguments', async () => {
    expect(await cli()).toBe(0);
    expect(output()).toContain('gtd capture');
  });

  it('explains the confirmation phrase for the destructive command', async () => {
    await cli('help');

    expect(output()).toContain('WIPE EVERYTHING');
  });
});

describe('capture', () => {
  it('puts text in the inbox', async () => {
    seedCategory();

    expect(await cli('capture', 'Call', 'Sam')).toBe(0);

    const items = inboxItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.container).toBe('inbox');
    // Multiple arguments join, so a shell does not have to quote the sentence.
    expect(items[0]?.title).toBe('Call Sam');
  });

  it('uses the only category without being asked', async () => {
    // One decision, not two. A category prompt at capture is a question at the moment
    // capture should be frictionless.
    seedCategory();

    await cli('capture', 'Something');

    expect(inboxItems()).toHaveLength(1);
  });

  it('refuses without a category when several exist', async () => {
    seedCategory();
    withDb((repos) => repos.categories.create({ name: 'Home', key: 'home' }));

    expect(await cli('capture', 'Something')).toBe(1);
    expect(err.join('')).toContain('--category');
  });

  it('names the category explicitly when several exist', async () => {
    seedCategory();
    withDb((repos) => repos.categories.create({ name: 'Home', key: 'home' }));

    expect(await cli('capture', 'Something', '--category', 'home')).toBe(0);
  });

  it('refuses an unknown category', async () => {
    seedCategory();

    expect(await cli('capture', 'Something', '--category', 'nope')).toBe(1);
  });

  it('refuses empty text', async () => {
    seedCategory();

    expect(await cli('capture')).toBe(1);
    expect(err.join('')).toContain('capture needs text');
  });

  it('says there is nowhere to capture when no category exists', async () => {
    expect(await cli('capture', 'Something')).toBe(1);
    expect(err.join('')).toContain('No category');
  });
});

describe('list', () => {
  it('lists the inbox by default', async () => {
    captureOne('Call Sam');

    expect(await cli('list')).toBe(0);
    expect(output()).toContain('Call Sam');
  });

  /*
   * The bug this replaces. The earlier version fetched the first 500 items and filtered
   * them in JavaScript, so with more items than that it reported fewer than exist, with
   * nothing to indicate anything was missing. A script cannot detect that.
   */
  it('reports the true total rather than the size of one page', async () => {
    const id = captureOne();
    withDb((repos) => {
      const category = repos.categories.list()[0];
      if (category === undefined) throw new Error('category missing');
      for (let index = 0; index < 20; index += 1) {
        repos.items.create({ categoryId: category.id, title: `Item ${index}`, container: 'inbox' });
      }
      void id;
    });

    await cli('list', '--json');

    const parsed = JSON.parse(output()) as { total: number; items: unknown[] };
    expect(parsed.total).toBe(21);
  });

  it('says when the page is smaller than the total', async () => {
    captureOne();
    withDb((repos) => {
      const category = repos.categories.list()[0];
      if (category === undefined) throw new Error('category missing');
      for (let index = 0; index < 10; index += 1) {
        repos.items.create({ categoryId: category.id, title: `Item ${index}`, container: 'inbox' });
      }
    });

    await cli('list', '--limit', '5');

    // Silence here would let a script read five lines as the whole truth.
    expect(output()).toContain('5 of 11');
  });

  it('filters by container through the query engine', async () => {
    captureOne('In the inbox');
    withDb((repos) => {
      const category = repos.categories.list()[0];
      if (category === undefined) throw new Error('category missing');
      repos.items.create({ categoryId: category.id, title: 'Doing', container: 'next_action' });
    });

    await cli('list', 'next_action', '--json');

    const parsed = JSON.parse(output()) as { items: Array<{ title: string }> };
    expect(parsed.items.map((item) => item.title)).toEqual(['Doing']);
  });

  it('rejects a container it does not know, and says which exist', async () => {
    expect(await cli('list', 'nonsense')).toBe(1);
    expect(err.join('')).toContain('next_action');
  });

  it('copes with an empty container', async () => {
    captureOne();

    await cli('list', 'done');

    expect(output()).toContain('(nothing)');
  });
});

describe('lifecycle', () => {
  it('completes an item', async () => {
    const id = captureOne();

    expect(await cli('complete', id)).toBe(0);
    expect(withDb((repos) => repos.items.getById(id)?.container)).toBe('done');
  });

  it('stamps a completion time', async () => {
    const id = captureOne();

    await cli('complete', id);

    // Completing is not "set container to done"; it is completing.
    expect(withDb((repos) => repos.items.getById(id)?.completedAt)).toBeTruthy();
  });

  it('trashes and restores', async () => {
    const id = captureOne();

    await cli('trash', id);
    expect(withDb((repos) => repos.items.getById(id)?.container)).toBe('trash');

    await cli('restore', id);
    expect(withDb((repos) => repos.items.getById(id)?.container)).not.toBe('trash');
  });

  it('reopens a completed item', async () => {
    const id = captureOne();
    await cli('complete', id);

    await cli('reopen', id);

    expect(withDb((repos) => repos.items.getById(id)?.container)).toBe('next_action');
  });

  it('moves an item between containers', async () => {
    const id = captureOne();

    await cli('move', id, 'someday');

    expect(withDb((repos) => repos.items.getById(id)?.container)).toBe('someday');
  });

  it('refuses an illegal transition, using the same rules as the API', async () => {
    const id = captureOne();
    await cli('trash', id);

    expect(await cli('move', id, 'done')).toBe(1);
  });

  it('says what it needs when an id is missing', async () => {
    expect(await cli('complete')).toBe(1);
    expect(err.join('')).toContain('item id');
  });

  it('shows an item', async () => {
    const id = captureOne('Something specific');

    await cli('show', id);

    // A `show` command that prints an id saves the caller nothing.
    expect(output()).toContain('Something specific');
  });
});

describe('output', () => {
  it('prints the container and the title', async () => {
    captureOne('Call Sam');

    await cli('list');

    expect(output()).toContain('inbox');
    expect(output()).toContain('Call Sam');
  });

  it('emits JSON on request', async () => {
    captureOne();

    await cli('list', '--json');

    expect(() => JSON.parse(output())).not.toThrow();
  });

  it('emits a JSON error when asked for JSON output', async () => {
    const code = await cli('capture', '--json');

    // A script parsing stdout should get an error object, not a sentence on stderr it
    // never reads.
    expect(code).toBe(1);
    expect(() => JSON.parse(output())).not.toThrow();
  });
});

describe('argument errors', () => {
  it('rejects a flag with no value instead of swallowing the next argument', async () => {
    // The earlier parser spliced two entries wherever it found a flag, so `capture
    // --category` silently consumed the following argument and ran a different command.
    const code = await cli('capture', '--category');

    expect(code).toBe(1);
    expect(err.join('')).toContain('--category needs a value');
  });

  it('rejects a flag followed by another flag', async () => {
    expect(await cli('list', '--category', '--json')).toBe(1);
  });

  it('rejects an unknown option', async () => {
    expect(await cli('list', '--nonsense')).toBe(1);
  });

  it('rejects an unknown command', async () => {
    expect(await cli('frobnicate')).toBe(1);
    expect(err.join('')).toContain('Unknown command');
  });

  it('rejects a nonsense limit', async () => {
    expect(await cli('list', '--limit', 'many')).toBe(1);
  });
});

describe('reset', () => {
  it('previews what it would remove, and removes nothing', async () => {
    captureOne();

    expect(await cli('reset', '--preview', '--json')).toBe(0);

    const report = JSON.parse(output());
    expect(report.wouldRemove).toBeGreaterThan(0);
    // Only the tables that actually hold something: a list of twelve zeroes is a
    // table of noise in front of the one number that matters.
    expect(report.tables.every((entry: { rows: number }) => entry.rows > 0)).toBe(true);
    expect(report.tables.find((entry: { table: string }) => entry.table === 'items').rows).toBe(1);

    expect(inboxItems()).toHaveLength(1);
    expect(withDb((repos) => repos.categories.list())).toHaveLength(1);
  });

  it('needs no confirmation to preview, because it changes nothing', async () => {
    captureOne();

    expect(await cli('reset', '--preview')).toBe(0);
    expect(inboxItems()).toHaveLength(1);
  });

  it('still refuses to wipe when preview and confirm are given together', async () => {
    // `--preview` wins rather than being ignored, so a script that meant to look
    // cannot destroy a database on the way past.
    captureOne();

    expect(await cli('reset', '--preview', '--confirm', 'WIPE EVERYTHING')).toBe(0);
    expect(inboxItems()).toHaveLength(1);
  });

  it('refuses without the confirmation phrase', async () => {
    captureOne();

    expect(await cli('reset')).toBe(1);
    expect(err.join('')).toContain('WIPE EVERYTHING');
    expect(inboxItems()).toHaveLength(1);
  });

  it('refuses the wrong phrase', async () => {
    captureOne();

    expect(await cli('reset', '--confirm', 'yes')).toBe(1);
    expect(inboxItems()).toHaveLength(1);
  });

  it('wipes everything with the phrase', async () => {
    captureOne();

    expect(await cli('reset', '--confirm', 'WIPE EVERYTHING')).toBe(0);

    expect(inboxItems()).toEqual([]);
    expect(withDb((repos) => repos.categories.list())).toEqual([]);
  });

  it('leaves the application usable afterwards', async () => {
    captureOne();
    await cli('reset', '--confirm', 'WIPE EVERYTHING');

    // The reset's own JSON is still in the buffer; only the list's output is being parsed.
    out = [];
    expect(await cli('list', '--json')).toBe(0);
    expect(JSON.parse(output()).total).toBe(0);
  });

  it('returns the application to first-run state', async () => {
    captureOne();
    withDb((repos) => repos.settings.set('setup.completed', true));

    await cli('reset', '--confirm', 'WIPE EVERYTHING');

    // Clearing the flag is what sends the app back to the setup wizard.
    expect(withDb((repos) => repos.settings.isSetupComplete())).toBe(false);
  });
});
