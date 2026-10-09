import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, type Db } from '@gtd/db';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let db: Db;
let app: FastifyInstance;
let categoryId: string;
let clock: string;

beforeEach(async () => {
  db = openMemoryDb();
  migrate(db);
  clock = '2026-01-01T00:00:00.000Z';
  app = await buildApp({ db, logger: false, reconcileIndexes: false, now: () => clock as never });
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

async function newItem(title: string, data: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/items',
    payload: { categoryId, title, data },
  });
  expect(response.statusCode).toBe(201);
  return response.json().item.id;
}

async function complete(id: string): Promise<void> {
  const response = await app.inject({ method: 'POST', url: `/api/items/${id}/complete` });
  expect(response.statusCode).toBe(200);
}

describe('the archive', () => {
  it('starts empty', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/archive' });
    expect(response.json()).toEqual({ items: [], total: 0 });
  });

  it('lists only completed items', async () => {
    const open = await newItem('Still open');
    const done = await newItem('Finished');
    await complete(done);

    const response = await app.inject({ method: 'GET', url: '/api/archive' });
    expect(response.json().items.map((i: { id: string }) => i.id)).toEqual([done]);
    expect(response.json().items.map((i: { id: string }) => i.id)).not.toContain(open);
  });

  it('includes the resolved field values', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = await newItem('Finished', { assigner: 'Dana' });
    await complete(id);

    const response = await app.inject({ method: 'GET', url: '/api/archive' });
    expect(response.json().items[0].values.assigner).toBe('Dana');
  });

  it('filters by a user-defined field', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: {
        label: 'Priority',
        type: 'priority',
        options: {
          kind: 'choices',
          choices: [
            { value: 'low', label: 'Low', color: null, order: 0 },
            { value: 'high', label: 'High', color: null, order: 1 },
          ],
        },
      },
    });
    const high = await newItem('High', { priority: 'high' });
    const low = await newItem('Low', { priority: 'low' });
    await complete(high);
    await complete(low);

    const filter = encodeURIComponent(
      JSON.stringify({ kind: 'condition', field: 'priority', operator: 'equals', value: 'high' }),
    );
    const response = await app.inject({ method: 'GET', url: `/api/archive?filter=${filter}` });
    expect(response.json().items.map((i: { title: string }) => i.title)).toEqual(['High']);
  });

  it('sorts by completion time', async () => {
    const first = await newItem('First');
    const second = await newItem('Second');
    await complete(first);
    clock = '2026-02-02T00:00:00.000Z';
    await complete(second);

    const sort = encodeURIComponent(JSON.stringify([{ field: 'completedAt', direction: 'desc' }]));
    const response = await app.inject({ method: 'GET', url: `/api/archive?sort=${sort}` });
    expect(response.json().items.map((i: { title: string }) => i.title)).toEqual([
      'Second',
      'First',
    ]);
  });

  it('pages', async () => {
    for (const title of ['A', 'B', 'C']) {
      await complete(await newItem(title));
    }
    const response = await app.inject({ method: 'GET', url: '/api/archive?limit=2' });
    expect(response.json().items).toHaveLength(2);
    expect(response.json().total).toBe(3);
  });

  it('rejects a malformed filter', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/archive?filter=notjson' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('bad_request');
  });

  it('rejects a filter naming an unknown field', async () => {
    const filter = encodeURIComponent(
      JSON.stringify({ kind: 'condition', field: 'nope', operator: 'equals', value: 'x' }),
    );
    const response = await app.inject({ method: 'GET', url: `/api/archive?filter=${filter}` });
    expect(response.statusCode).toBe(400);
  });
});

describe('archive facets', () => {
  beforeEach(async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: {
        label: 'Priority',
        type: 'priority',
        options: {
          kind: 'choices',
          choices: [
            { value: 'low', label: 'Low', color: null, order: 0 },
            { value: 'high', label: 'High', color: null, order: 1 },
          ],
        },
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'Remarks', type: 'longtext' },
    });
  });

  it('reports no facets on an empty archive', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/archive/facets' });
    expect(response.json().facets).toEqual([]);
  });

  it('counts each value', async () => {
    await complete(await newItem('A', { priority: 'high' }));
    await complete(await newItem('B', { priority: 'high' }));
    await complete(await newItem('C', { priority: 'low' }));

    const response = await app.inject({ method: 'GET', url: '/api/archive/facets' });
    const priority = response.json().facets.find((f: { field: string }) => f.field === 'priority');
    expect(priority.values).toEqual([
      { value: 'high', label: 'High', count: 2 },
      { value: 'low', label: 'Low', count: 1 },
    ]);
  });

  it('omits a free-text field', async () => {
    await complete(await newItem('A', { priority: 'high', remarks: 'some free text' }));
    const response = await app.inject({ method: 'GET', url: '/api/archive/facets' });
    expect(response.json().facets.map((f: { field: string }) => f.field)).not.toContain('remarks');
  });

  it('marks a choice field as a closed list', async () => {
    await complete(await newItem('A', { priority: 'high' }));
    const response = await app.inject({ method: 'GET', url: '/api/archive/facets' });
    expect(response.json().facets[0].isOpen).toBe(false);
  });
});

describe('daily completions', () => {
  it('groups completions by day', async () => {
    await complete(await newItem('A'));
    clock = '2026-01-02T00:00:00.000Z';
    await complete(await newItem('B'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/archive/daily?from=2026-01-01&to=2026-01-31',
    });
    expect(response.json().days).toEqual([
      { date: '2026-01-01', count: 1 },
      { date: '2026-01-02', count: 1 },
    ]);
  });

  it('defaults to the last 30 days ending today', async () => {
    clock = '2026-03-02T00:00:00.000Z';
    const response = await app.inject({ method: 'GET', url: '/api/archive/daily' });
    expect(response.json().from).toBe('2026-02-01');
    expect(response.json().to).toBe('2026-03-02');
  });

  it('honours a days parameter', async () => {
    clock = '2026-03-02T00:00:00.000Z';
    const response = await app.inject({ method: 'GET', url: '/api/archive/daily?days=7' });
    expect(response.json().from).toBe('2026-02-24');
  });

  it('rejects a malformed date', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/archive/daily?from=nope' });
    expect(response.statusCode).toBe(400);
  });

  it('is empty when nothing is completed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/archive/daily?from=2026-01-01&to=2026-01-31',
    });
    expect(response.json().days).toEqual([]);
  });
});

describe('item history', () => {
  it('records creation, edits and completion', async () => {
    const id = await newItem('Thing');
    await app.inject({ method: 'PATCH', url: `/api/items/${id}`, payload: { title: 'Renamed' } });
    await complete(id);

    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/history` });
    expect(response.json().entries.map((e: { verb: string }) => e.verb)).toEqual([
      'created',
      'updated',
      'completed',
    ]);
  });

  it('returns oldest first, unlike the activity feed', async () => {
    const id = await newItem('Thing');
    await app.inject({ method: 'PATCH', url: `/api/items/${id}`, payload: { title: 'Renamed' } });
    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/history` });
    const verbs = response.json().entries.map((e: { verb: string }) => e.verb);
    expect(verbs.indexOf('created')).toBeLessThan(verbs.indexOf('updated'));
  });

  it('carries the field-level diff', async () => {
    const id = await newItem('Thing');
    await app.inject({ method: 'PATCH', url: `/api/items/${id}`, payload: { title: 'Renamed' } });

    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/history` });
    const edit = response.json().entries.find((e: { verb: string }) => e.verb === 'updated');
    expect(edit.from).toEqual({ title: 'Thing' });
    expect(edit.to).toEqual({ title: 'Renamed' });
  });

  it('shows a user-defined field changing', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = await newItem('Thing');
    await app.inject({
      method: 'PATCH',
      url: `/api/items/${id}`,
      payload: { data: { assigner: 'Dana' } },
    });

    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/history` });
    const edit = response.json().entries.find((e: { verb: string }) => e.verb === 'updated');
    expect(edit.from).toEqual({ assigner: null });
    expect(edit.to).toEqual({ assigner: 'Dana' });
  });

  it('returns 404 for a missing item', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/items/nope/history' });
    expect(response.statusCode).toBe(404);
  });

  it('is empty for an item that was just created', async () => {
    // Creation is logged, so it is never truly empty; this asserts it has only
    // that one entry.
    const id = await newItem('Thing');
    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/history` });
    expect(response.json().entries).toHaveLength(1);
  });
});

describe('activity feed', () => {
  it('lists recent activity with titles', async () => {
    await complete(await newItem('Call the dentist'));
    const response = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(response.json().entries[0].title).toBe('Call the dentist');
  });

  it('filters by verb', async () => {
    const id = await newItem('Thing');
    await complete(id);
    const response = await app.inject({ method: 'GET', url: '/api/activity?verb=completed' });
    expect(response.json().entries).toHaveLength(1);
  });

  it('summarises counts by verb', async () => {
    const id = await newItem('Thing');
    await complete(id);
    const response = await app.inject({ method: 'GET', url: '/api/activity/summary' });
    expect(response.json().counts.created).toBe(1);
    expect(response.json().counts.completed).toBe(1);
  });

  it('is newest first', async () => {
    const id = await newItem('Thing');
    await app.inject({ method: 'PATCH', url: `/api/items/${id}`, payload: { title: 'A' } });
    const response = await app.inject({ method: 'GET', url: '/api/activity?limit=1' });
    expect(response.json().entries[0].verb).toBe('updated');
  });
});
