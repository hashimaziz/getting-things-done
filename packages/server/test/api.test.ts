import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, type Db } from '@gtd/db';
import { z } from 'zod';
import { InvalidQueryError } from '@gtd/core';
import { buildApp } from '../src/app.js';
import { describeError } from '../src/errors.js';
import type { FastifyInstance } from 'fastify';

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db = openMemoryDb();
  migrate(db);
  app = await buildApp({ db, logger: false, reconcileIndexes: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function createCategory(name = 'Work'): Promise<{ id: string; key: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/categories', payload: { name } });
  expect(response.statusCode).toBe(201);
  return response.json().category;
}

describe('status', () => {
  it('reports the app name from core config', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json().app).toBe('GTD');
  });

  it('reports setup as incomplete on a fresh database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/status' });
    expect(response.json().setupCompleted).toBe(false);
  });
});

describe('categories', () => {
  it('starts empty rather than seeded', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(response.json().categories).toEqual([]);
  });

  it('creates a category', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Work', color: '#f00' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().category).toMatchObject({
      name: 'Work',
      color: '#f00',
      isArchived: false,
    });
  });

  it('derives a key when none is given', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Side Projects' },
    });
    expect(response.json().category.key).toBe('side_projects');
  });

  it('rejects an empty name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: '   ' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('rejects a missing name', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/categories', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a duplicate key with a conflict', async () => {
    await createCategory('Work');
    const response = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Other', key: 'work' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('duplicate_key');
    expect(response.json().error.message).toBe('A Category with that key already exists.');
    expect(response.json().error.details).toEqual({ field: 'key' });
  });

  it('rejects a duplicate key on update', async () => {
    await createCategory('Work');
    const home = await createCategory('Home');
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${home.id}`,
      payload: { key: 'work' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('lists categories', async () => {
    await createCategory('Work');
    await createCategory('Home');
    const response = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(response.json().categories).toHaveLength(2);
  });

  it('excludes archived categories by default', async () => {
    await createCategory('Work');
    const home = await createCategory('Home');
    await app.inject({
      method: 'PATCH',
      url: `/api/categories/${home.id}`,
      payload: { isArchived: true },
    });

    const active = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(active.json().categories.map((c: { name: string }) => c.name)).toEqual(['Work']);

    const all = await app.inject({ method: 'GET', url: '/api/categories?includeArchived=true' });
    expect(all.json().categories).toHaveLength(2);
  });

  it('gets one category', async () => {
    const category = await createCategory();
    const response = await app.inject({ method: 'GET', url: `/api/categories/${category.id}` });
    expect(response.json().category.id).toBe(category.id);
  });

  it('returns 404 for a missing category', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/categories/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('updates a category', async () => {
    const category = await createCategory();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${category.id}`,
      payload: { name: 'Employment' },
    });
    expect(response.json().category.name).toBe('Employment');
  });

  it('does not clear unspecified fields on update', async () => {
    const category = await createCategory('Work');
    await app.inject({
      method: 'PATCH',
      url: `/api/categories/${category.id}`,
      payload: { name: 'New' },
    });
    const response = await app.inject({ method: 'GET', url: `/api/categories/${category.id}` });
    expect(response.json().category.key).toBe(category.key);
  });

  it('clears a field sent as null', async () => {
    const category = await createCategory();
    await app.inject({
      method: 'PATCH',
      url: `/api/categories/${category.id}`,
      payload: { description: 'x' },
    });
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${category.id}`,
      payload: { description: null },
    });
    expect(cleared.json().category.description).toBeNull();
  });

  it('deletes a category', async () => {
    const category = await createCategory();
    const response = await app.inject({ method: 'DELETE', url: `/api/categories/${category.id}` });
    expect(response.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(list.json().categories).toEqual([]);
  });
});

describe('field definitions', () => {
  it('creates a field scoped to a category', async () => {
    const category = await createCategory();
    const response = await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Complete By', type: 'date' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().field.key).toBe('complete_by');
    expect(response.json().field.categoryId).toBe(category.id);
  });

  it('rejects an unknown field type', async () => {
    const category = await createCategory();
    const response = await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Weird', type: 'telepathy' },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('lists the definitions applying to a category', async () => {
    const category = await createCategory();
    await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/categories/${category.id}/fields`,
    });
    expect(response.json().fields.map((f: { key: string }) => f.key)).toEqual(['assigner']);
  });

  it('lists all definitions', async () => {
    const category = await createCategory();
    await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const response = await app.inject({ method: 'GET', url: '/api/fields' });
    expect(response.json().fields).toHaveLength(1);
  });

  it('gets one definition', async () => {
    const category = await createCategory();
    const created = await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = created.json().field.id;
    const response = await app.inject({ method: 'GET', url: `/api/fields/${id}` });
    expect(response.json().field.id).toBe(id);
  });

  it('returns 404 for a missing definition', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/fields/nope' });
    expect(response.statusCode).toBe(404);
  });

  it('updates a definition', async () => {
    const category = await createCategory();
    const created = await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = created.json().field.id;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/fields/${id}`,
      payload: { label: 'Owner', filterable: true },
    });
    expect(response.json().field).toMatchObject({ label: 'Owner', filterable: true });
  });

  it('moves a definition to global scope via the query string', async () => {
    const category = await createCategory();
    const created = await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = created.json().field.id;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/fields/${id}?categoryId=null`,
      payload: {},
    });
    expect(response.json().field.categoryId).toBeNull();
  });

  it('deletes a definition', async () => {
    const category = await createCategory();
    const created = await app.inject({
      method: 'POST',
      url: `/api/categories/${category.id}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = created.json().field.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/fields/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/fields' })).json().fields).toEqual([]);
  });
});

describe('settings', () => {
  it('starts empty', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(response.json().settings).toEqual([]);
  });

  it('round-trips a value', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings/app.timezone',
      payload: { value: 'Europe/Berlin' },
    });
    const response = await app.inject({ method: 'GET', url: '/api/settings/app.timezone' });
    expect(response.json().value).toBe('Europe/Berlin');
  });

  it('stores non-string values with their type', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings/app.weekStartsOn',
      payload: { value: 0 },
    });
    const response = await app.inject({ method: 'GET', url: '/api/settings/app.weekStartsOn' });
    expect(response.json().value).toBe(0);
  });

  it('overwrites an existing value', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings/x', payload: { value: 1 } });
    await app.inject({ method: 'PUT', url: '/api/settings/x', payload: { value: 2 } });
    const response = await app.inject({ method: 'GET', url: '/api/settings/x' });
    expect(response.json().value).toBe(2);
  });

  it('returns 404 for a missing setting', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings/nope' });
    expect(response.statusCode).toBe(404);
  });

  it('reads a known setting with a typed endpoint', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings/app.timezone',
      payload: { value: 'UTC' },
    });
    const response = await app.inject({ method: 'GET', url: '/api/settings-known/app.timezone' });
    expect(response.json().value).toBe('UTC');
  });

  it('rejects an unknown key on the typed endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings-known/made.up' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('unknown_setting');
  });

  it('flips setup status once marked complete', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/status' })).json().setupCompleted).toBe(
      false,
    );
    await app.inject({
      method: 'PUT',
      url: '/api/settings/setup.completed',
      payload: { value: true },
    });
    expect((await app.inject({ method: 'GET', url: '/api/status' })).json().setupCompleted).toBe(
      true,
    );
  });

  it('deletes a setting', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings/x', payload: { value: 1 } });
    expect((await app.inject({ method: 'DELETE', url: '/api/settings/x' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/settings/x' })).statusCode).toBe(404);
  });
});

describe('error handling', () => {
  it('returns a structured 404 for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('route_not_found');
  });

  it('includes field-level detail on a validation failure', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: '' },
    });
    expect(response.json().error.details).toEqual([{ path: 'name', message: expect.any(String) }]);
  });

  it('does not leak internals in a constraint message', async () => {
    await createCategory('Work');
    const response = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Other', key: 'work' },
    });
    expect(response.statusCode).toBe(409);
    // The message is ours, not SQLite's.
    expect(JSON.stringify(response.json())).not.toContain('UNIQUE constraint');
    expect(JSON.stringify(response.json())).not.toContain('categories.key');
  });

  it('returns a 422 for a reference to something that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { categoryId: 'missing', title: 'x' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('invalid_reference');
    expect(response.json().error.message).toBe('That category does not exist.');
  });
});

describe('describeError', () => {
  it('describes an unknown error as an opaque 500', () => {
    const mapping = describeError(new TypeError('cannot read property of undefined'));
    expect(mapping.status).toBe(500);
    expect(mapping.code).toBe('internal_error');
    expect(mapping.message).toBe('Something went wrong');
  });

  it('never echoes the original message of an unknown error', () => {
    const secret = '/Users/someone/.gtd/gtd.sqlite: UNIQUE constraint failed';
    const mapping = describeError(new Error(secret));
    expect(mapping.message).not.toContain('.gtd');
    expect(mapping.message).not.toContain('UNIQUE');
    expect(JSON.stringify(mapping)).not.toContain('someone');
  });

  it('describes a Zod failure with field detail', () => {
    const result = z.object({ a: z.string() }).safeParse({});
    if (!result.success) {
      const mapping = describeError(result.error);
      expect(mapping.status).toBe(400);
      expect(mapping.code).toBe('validation_failed');
      expect(mapping.details).toEqual([{ path: 'a', message: expect.any(String) }]);
    }
  });

  it('describes an invalid query with its path', () => {
    const mapping = describeError(new InvalidQueryError('nope', 'filter[1]'));
    expect(mapping.status).toBe(400);
    expect(mapping.code).toBe('invalid_query');
    expect(mapping.details).toEqual({ path: 'filter[1]' });
  });
});
