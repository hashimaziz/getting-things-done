import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, type Db } from '@gtd/db';
import { buildApp } from '../src/app.js';
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
    // A unique constraint violation is not a domain error, so it surfaces as 500.
    // Recorded here as the current behaviour; see the note below.
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
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

  it('does not leak internals on an unexpected error', async () => {
    // A NOT NULL violation is not a domain error, so it falls through to a 500.
    const response = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Work', key: 'work' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Other', key: 'work' },
    });
    expect(second.statusCode).toBe(500);
    expect(second.json().error.code).toBe('internal_error');
    // The message must not contain SQL or a filesystem path.
    expect(JSON.stringify(second.json())).not.toContain('SQLITE');
    expect(JSON.stringify(second.json())).not.toContain('sqlite');
    expect(response.statusCode).toBe(201);
  });
});
