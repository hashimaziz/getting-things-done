import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, type Db } from '@gtd/db';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let db: Db;
let app: FastifyInstance;
let categoryId: string;

beforeEach(async () => {
  db = openMemoryDb();
  migrate(db);
  app = await buildApp({ db, logger: false, reconcileIndexes: false });
  await app.ready();
  const created = await app.inject({
    method: 'POST',
    url: '/api/categories',
    payload: { name: 'Work' },
  });
  categoryId = created.json().category.id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function addField(label: string, type: string, extra: object = {}) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/categories/${categoryId}/fields`,
    payload: { label, type, ...extra },
  });
  expect(response.statusCode).toBe(201);
  return response.json().field;
}

async function createItem(payload: object) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/items',
    payload: { categoryId, title: 'A thing', ...payload },
  });
  return response;
}

async function itemById(id: string) {
  const response = await app.inject({ method: 'GET', url: `/api/items/${id}` });
  return response.json().item;
}

describe('creating items', () => {
  it('creates an item', async () => {
    const response = await createItem({ title: 'Call the dentist' });
    expect(response.statusCode).toBe(201);
    expect(response.json().item).toMatchObject({
      title: 'Call the dentist',
      container: 'next_action',
      categoryId,
    });
  });

  it('rejects an empty title', async () => {
    const response = await createItem({ title: '   ' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed datetime', async () => {
    const response = await createItem({ whenAt: '2026-10-08 09:00' });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('ISO 8601');
  });

  it('rejects a malformed calendar date', async () => {
    const response = await createItem({ deadlineOn: '08-10-2026' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown container', async () => {
    const response = await createItem({ container: 'nope' });
    expect(response.statusCode).toBe(400);
  });

  it('routes to the calendar when a hard date is given', async () => {
    const response = await createItem({ whenAt: '2026-10-08T09:00:00.000Z' });
    expect(response.json().item.container).toBe('calendar');
  });

  it('keeps a deadline out of the calendar', async () => {
    const response = await createItem({ deadlineOn: '2026-10-08' });
    expect(response.json().item.container).toBe('next_action');
  });

  it('normalises a null context list to empty', async () => {
    const response = await createItem({ contextIds: null });
    expect(response.json().item.contextIds).toEqual([]);
  });

  it('rejects an item for a category that does not exist', async () => {
    const response = await createItem({ categoryId: 'missing' });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('dynamic field values', () => {
  it('stores a value for a defined field', async () => {
    await addField('Assigner', 'text');
    const response = await createItem({ data: { assigner: 'Dana' } });
    expect(response.json().item.data.assigner).toBe('Dana');
  });

  it('normalises a loosely typed value', async () => {
    await addField('Estimate', 'duration');
    const response = await createItem({ data: { estimate: '1h 30m' } });
    expect(response.json().item.data.estimate).toBe(90);
  });

  it('rejects a value of the wrong type', async () => {
    await addField('Estimate', 'duration');
    const response = await createItem({ data: { estimate: 'a while' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('bad_request');
  });

  it('rejects a value for an unknown field rather than storing it', async () => {
    const response = await createItem({ data: { nonexistent: 'x' } });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('Unknown field');
  });

  it('rejects a select value outside its configured options', async () => {
    await addField('Priority', 'priority', {
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 0 },
          { value: 'high', label: 'High', color: null, order: 1 },
        ],
      },
    });
    const response = await createItem({ data: { priority: 'urgent' } });
    expect(response.statusCode).toBe(400);
  });

  it('applies a field default when the value is absent', async () => {
    await addField('Priority', 'priority', {
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 0 },
          { value: 'high', label: 'High', color: null, order: 1 },
        ],
      },
      defaultValue: 'low',
    });
    const response = await createItem({});
    expect(response.json().item.data.priority).toBe('low');
  });

  it('lets an explicit value win over the default', async () => {
    await addField('Priority', 'priority', {
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 0 },
          { value: 'high', label: 'High', color: null, order: 1 },
        ],
      },
      defaultValue: 'low',
    });
    const response = await createItem({ data: { priority: 'high' } });
    expect(response.json().item.data.priority).toBe('high');
  });

  it('enforces a required field', async () => {
    await addField('Assigner', 'text', { required: true });
    const response = await createItem({});
    expect(response.statusCode).toBe(400);
  });

  it('returns every field problem at once', async () => {
    await addField('Assigner', 'text', { required: true });
    await addField('Estimate', 'duration');
    const response = await createItem({ data: { estimate: 'nope', other: 1 } });
    expect(response.statusCode).toBe(400);
    const details = response.json().error.details as Array<{ key: string }>;
    expect(details.map((issue) => issue.key).sort()).toEqual(['assigner', 'estimate', 'other']);
  });

  it('does not accept a field defined only for another category', async () => {
    const home = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Home' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/categories/${home.json().category.id}/fields`,
      payload: { label: 'For Who', type: 'text' },
    });
    const response = await createItem({ data: { for_who: 'Alex' } });
    expect(response.statusCode).toBe(400);
  });

  it('accepts a global field from any category', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const fieldId = (await app.inject({ method: 'GET', url: '/api/fields' })).json().fields[0].id;
    await app.inject({
      method: 'PATCH',
      url: `/api/fields/${fieldId}?categoryId=null`,
      payload: {},
    });

    const home = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Home' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { categoryId: home.json().category.id, title: 'x', data: { assigner: 'Alex' } },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe('reading items', () => {
  it('expands an item with its applicable fields', async () => {
    await addField('Assigner', 'text');
    const created = await createItem({ data: { assigner: 'Dana' } });
    const item = await itemById(created.json().item.id);
    expect(item.values.assigner).toBe('Dana');
  });

  it('reports an unset field as its empty value', async () => {
    await addField('Assigner', 'text');
    await addField('Estimate', 'duration');
    const created = await createItem({});
    const item = await itemById(created.json().item.id);
    expect(item.values.assigner).toBe('');
    expect(item.values.estimate).toBeNull();
  });

  it('returns 404 for a missing item', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/items/nope' });
    expect(response.statusCode).toBe(404);
  });

  it('returns the applicable definitions for an item', async () => {
    await addField('Assigner', 'text');
    const created = await createItem({});
    const response = await app.inject({
      method: 'GET',
      url: `/api/items/${created.json().item.id}/fields`,
    });
    expect(response.json().fields.map((f: { key: string }) => f.key)).toEqual(['assigner']);
  });
});

describe('updating items', () => {
  it('updates the title', async () => {
    const created = await createItem({});
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/items/${created.json().item.id}`,
      payload: { title: 'New title' },
    });
    expect(response.json().item.title).toBe('New title');
  });

  it('leaves unspecified fields alone', async () => {
    await addField('Assigner', 'text');
    const created = await createItem({ data: { assigner: 'Dana' } });
    await app.inject({
      method: 'PATCH',
      url: `/api/items/${created.json().item.id}`,
      payload: { title: 'New title' },
    });
    const item = await itemById(created.json().item.id);
    expect(item.data.assigner).toBe('Dana');
  });

  it('merges partial field data rather than replacing it', async () => {
    await addField('Assigner', 'text');
    await addField('Point Of Contact', 'text');
    const created = await createItem({ data: { assigner: 'Dana', poc: 'Sam' } });
    await app.inject({
      method: 'PATCH',
      url: `/api/items/${created.json().item.id}`,
      payload: { data: { assigner: 'Alex' } },
    });
    const item = await itemById(created.json().item.id);
    expect(item.data.assigner).toBe('Alex');
    expect(item.data.poc).toBe('Sam');
  });

  it('validates field data on update', async () => {
    await addField('Estimate', 'duration');
    const created = await createItem({});
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/items/${created.json().item.id}`,
      payload: { data: { estimate: 'soon' } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('clears a field sent as null', async () => {
    await addField('Assigner', 'text');
    const created = await createItem({ data: { assigner: 'Dana' } });
    await app.inject({
      method: 'PATCH',
      url: `/api/items/${created.json().item.id}`,
      payload: { data: { assigner: null } },
    });
    expect((await itemById(created.json().item.id)).data.assigner).toBe('');
  });

  it('rejects an illegal container move with a conflict', async () => {
    const created = await createItem({});
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/items/${created.json().item.id}`,
      payload: { container: 'inbox' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('illegal_transition');
  });
});

describe('lifecycle actions', () => {
  it('completes an item', async () => {
    const created = await createItem({});
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${created.json().item.id}/complete`,
    });
    expect(response.json().item.container).toBe('done');
    expect(response.json().item.completedAt).toBeTruthy();
  });

  it('reopens a completed item', async () => {
    const created = await createItem({});
    await app.inject({ method: 'POST', url: `/api/items/${created.json().item.id}/complete` });
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${created.json().item.id}/reopen`,
    });
    expect(response.json().item.container).toBe('next_action');
    expect(response.json().item.completedAt).toBeNull();
  });

  it('trashes and restores an item', async () => {
    const created = await createItem({});
    await app.inject({ method: 'POST', url: `/api/items/${created.json().item.id}/trash` });
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${created.json().item.id}/restore`,
    });
    expect(response.json().item.container).toBe('inbox');
  });

  it('moves an item between containers', async () => {
    const created = await createItem({});
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${created.json().item.id}/move`,
      payload: { container: 'someday' },
    });
    expect(response.json().item.container).toBe('someday');
  });

  it('refuses an illegal move with a conflict', async () => {
    const created = await createItem({});
    await app.inject({ method: 'POST', url: `/api/items/${created.json().item.id}/trash` });
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${created.json().item.id}/move`,
      payload: { container: 'done' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('deletes an item outright', async () => {
    const created = await createItem({});
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/items/${created.json().item.id}` }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: `/api/items/${created.json().item.id}` })).statusCode,
    ).toBe(404);
  });
});

describe('querying items', () => {
  beforeEach(async () => {
    await addField('Assigner', 'text');
    await addField('Priority', 'priority', {
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 0 },
          { value: 'high', label: 'High', color: null, order: 1 },
        ],
      },
    });
    await createItem({ title: 'Alpha', data: { assigner: 'Dana', priority: 'high' } });
    await createItem({ title: 'Beta', data: { assigner: 'Sam', priority: 'low' } });
    await createItem({ title: 'Gamma', whenAt: '2026-10-08T09:00:00.000Z' });
  });

  it('lists all items with a total', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/items' });
    expect(response.json().items).toHaveLength(3);
    expect(response.json().total).toBe(3);
  });

  it('filters by container', async () => {
    const filter = JSON.stringify({
      kind: 'condition',
      field: 'container',
      operator: 'equals',
      value: 'calendar',
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/items?filter=${encodeURIComponent(filter)}`,
    });
    expect(response.json().items.map((i: { title: string }) => i.title)).toEqual(['Gamma']);
  });

  it('filters on a custom field', async () => {
    const filter = JSON.stringify({
      kind: 'condition',
      field: 'assigner',
      operator: 'equals',
      value: 'Dana',
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/items?filter=${encodeURIComponent(filter)}`,
    });
    expect(response.json().items.map((i: { title: string }) => i.title)).toEqual(['Alpha']);
  });

  it('sorts on a custom field', async () => {
    const sort = JSON.stringify([{ field: 'assigner', direction: 'asc' }]);
    const response = await app.inject({
      method: 'GET',
      url: `/api/items?sort=${encodeURIComponent(sort)}`,
    });
    expect(response.json().items.map((i: { title: string }) => i.title)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('reports the unpaged total alongside a limited page', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/items?limit=1' });
    expect(response.json().items).toHaveLength(1);
    expect(response.json().total).toBe(3);
  });

  it('pages with an offset', async () => {
    const sort = JSON.stringify([{ field: 'title', direction: 'asc' }]);
    const response = await app.inject({
      method: 'GET',
      url: `/api/items?sort=${encodeURIComponent(sort)}&limit=1&offset=1`,
    });
    expect(response.json().items.map((i: { title: string }) => i.title)).toEqual(['Beta']);
  });

  it('rejects a malformed filter with a 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/items?filter=notjson' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_query');
  });

  it('rejects a malformed sort with a 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/items?sort=notjson' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a filter naming an unknown field', async () => {
    const filter = JSON.stringify({
      kind: 'condition',
      field: 'nope',
      operator: 'equals',
      value: 'x',
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/items?filter=${encodeURIComponent(filter)}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_query');
  });

  it('scopes the available fields to a category when asked', async () => {
    const home = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Home' },
    });
    const filter = JSON.stringify({
      kind: 'condition',
      field: 'assigner',
      operator: 'equals',
      value: 'Dana',
    });
    // assigner belongs to Work, so it is not a filterable field of Home.
    const response = await app.inject({
      method: 'GET',
      url: `/api/items?categoryId=${home.json().category.id}&filter=${encodeURIComponent(filter)}`,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('metadata endpoints', () => {
  it('lists containers with their metadata', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/containers' });
    const containers = response.json().containers;
    expect(containers).toHaveLength(8);
    expect(containers.find((c: { container: string }) => c.container === 'inbox')).toMatchObject({
      isTransient: true,
      isActionContainer: false,
    });
  });

  it('lists field types', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/field-types' });
    expect(response.json().fieldTypes).toContain('duration');
    expect(response.json().fieldTypes).toContain('checklist');
  });
});
