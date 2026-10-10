import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createItemFieldResolver } from '@gtd/core';
import { openMemoryDb, migrate, createRepositories, type Db } from '@gtd/db';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

/**
 * The wipe endpoint.
 *
 * The bar is deliberately high here: this is the one endpoint in the application that
 * destroys everything, and it is reachable without authentication because the whole
 * application is local and single-user. So the tests are mostly about what happens when
 * the confirmation is absent, wrong, or nearly right.
 */

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db = openMemoryDb();
  migrate(db);
  app = await buildApp({
    db,
    logger: false,
    reconcileIndexes: false,
    now: () => '2026-03-02T00:00:00.000Z',
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

/**
 * Every item in the database, through the query engine.
 *
 * Read with a real field resolver rather than by counting rows directly, so these
 * tests assert what the application would actually see.
 */
function allItems(db: Db) {
  const repos = createRepositories(db);
  const definitions = repos.fieldDefs.listAll();
  const resolver = createItemFieldResolver({
    fieldTypes: definitions.map((definition) => ({ key: definition.key, type: definition.type })),
  });
  return repos.items.query({ resolver, filter: null, sort: [], limit: 100 }).items;
}

async function seed(): Promise<void> {
  const repos = createRepositories(db);
  const category = repos.categories.create({ name: 'Work', key: 'work' });
  const item = repos.items.create({ categoryId: category.id, title: 'Call Sam' });
  repos.items.complete(item.id);
  repos.settings.set('setup.completed', true);
}

describe('previewing a wipe', () => {
  it('reports what is there', async () => {
    await seed();

    const response = await app.inject({ method: 'GET', url: '/api/system/wipe/preview' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tables.find((entry: { table: string }) => entry.table === 'items').rows).toBe(1);
    expect(body.total).toBeGreaterThan(0);
  });

  it('changes nothing', async () => {
    await seed();

    await app.inject({ method: 'GET', url: '/api/system/wipe/preview' });

    expect(allItems(db)).toHaveLength(1);
  });

  it('tells the caller what phrase to type', async () => {
    // The preview is where a person decides, so it is where they learn the cost of
    // getting it wrong.
    const response = await app.inject({ method: 'GET', url: '/api/system/wipe/preview' });

    expect(response.json().confirmation).toBe('WIPE EVERYTHING');
  });
});

describe('wiping', () => {
  it('requires the confirmation phrase', async () => {
    await seed();

    const response = await app.inject({ method: 'POST', url: '/api/system/wipe', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(allItems(db)).toHaveLength(1);
  });

  it('refuses a wrong phrase', async () => {
    await seed();

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'yes' },
    });

    expect(response.statusCode).toBe(400);
  });

  /*
   * The case worth protecting: a lowercase or truncated phrase is a plausible thing for
   * a person to type, and accepting it would defeat the point of requiring one.
   */
  it('refuses the phrase in the wrong case', async () => {
    await seed();

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'wipe everything' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a partial phrase', async () => {
    await seed();

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'WIPE' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('accepts the exact phrase and removes everything', async () => {
    await seed();

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'WIPE EVERYTHING' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().remaining).toBe(0);
    expect(allItems(db)).toEqual([]);
  });

  it('returns the app to the setup wizard', async () => {
    // The point of the button: after it, the application is as it was on first run.
    await seed();

    await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'WIPE EVERYTHING' },
    });

    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.json().setupCompleted).toBe(false);
  });

  it('reports what it removed', async () => {
    await seed();

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'WIPE EVERYTHING' },
    });

    expect(response.json().wiped).toBeGreaterThan(0);
    expect(
      response.json().tables.find((entry: { table: string }) => entry.table === 'items').removed,
    ).toBe(1);
  });

  it('leaves the application able to accept new data', async () => {
    await seed();
    await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'WIPE EVERYTHING' },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Fresh start' },
    });

    expect(created.statusCode).toBe(201);
  });

  it('is safe to run twice', async () => {
    await seed();
    await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'WIPE EVERYTHING' },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      payload: { confirm: 'WIPE EVERYTHING' },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().wiped).toBe(0);
  });
});
