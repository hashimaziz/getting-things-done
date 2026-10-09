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
  clock = '2026-03-02T00:00:00.000Z';
  app = await buildApp({ db, logger: false, reconcileIndexes: false, now: () => clock });
  await app.ready();
  const created = await app.inject({
    method: 'POST',
    url: '/api/categories',
    payload: { name: 'Work' },
  });
  categoryId = created.json().category.id;
  await app.inject({
    method: 'POST',
    url: `/api/categories/${categoryId}/fields`,
    payload: {
      label: 'Priority',
      type: 'priority',
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 2 },
          { value: 'high', label: 'High', color: null, order: 0 },
        ],
      },
    },
  });
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function newItem(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/items',
    payload: { categoryId, title: 'A thing', estimateMinutes: 15, ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return response.json().item.id;
}

describe('providers', () => {
  it('lists the deterministic provider', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/recommendations/providers' });
    expect(response.json().providers).toEqual([
      { id: 'rules', label: 'Built-in rules', requiresModel: false },
    ]);
    expect(response.json().default).toBe('rules');
  });
});

describe('what next', () => {
  it('suggests nothing on an empty system', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations).toEqual([]);
    expect(response.json().provider.id).toBe('rules');
  });

  it('suggests the open action list', async () => {
    await newItem({ title: 'Call the dentist' });
    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(response.json().recommendations[0].title).toBe('Call the dentist');
  });

  it('puts an overdue item first', async () => {
    await newItem({ title: 'Calm' });
    await newItem({ title: 'Overdue', deadlineOn: '2026-03-01' });
    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(response.json().recommendations[0].title).toBe('Overdue');
  });

  it('uses the user priority scale', async () => {
    await newItem({ title: 'Low one', data: { priority: 'low' } });
    await newItem({ title: 'High one', data: { priority: 'high' } });
    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(response.json().recommendations[0].title).toBe('High one');
  });

  it('honours a limit', async () => {
    for (const title of ['a', 'b', 'c']) {
      await newItem({ title });
    }
    const response = await app.inject({ method: 'GET', url: '/api/recommendations?limit=2' });
    expect(response.json().recommendations).toHaveLength(2);
  });

  it('excludes items that cannot fit the time available', async () => {
    await newItem({ title: 'Long one', estimateMinutes: 300 });
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?timeAvailableMinutes=30',
    });
    expect(response.json().recommendations[0].reason).toContain('available');
  });

  it('excludes items outside the stated context', async () => {
    const office = await app.inject({
      method: 'POST',
      url: '/api/contexts',
      payload: { name: '@Office' },
    });
    const contextId = office.json().context.id;

    await newItem({ title: 'At the office', contextIds: [contextId] });
    await newItem({ title: 'At home', contextIds: [] });

    const response = await app.inject({
      method: 'GET',
      url: `/api/recommendations?contextIds=${contextId}`,
    });
    const titles = response.json().recommendations.map((r: { title: string }) => r.title);
    expect(titles).toEqual(['At the office']);
  });

  it('treats an absent context filter as anywhere', async () => {
    await newItem({ title: 'Anywhere' });
    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(response.json().recommendations).toHaveLength(1);
  });

  it('treats an explicitly empty context as nowhere', async () => {
    await newItem({ title: 'Somewhere' });
    const response = await app.inject({ method: 'GET', url: '/api/recommendations?contextIds=' });
    expect(response.json().recommendations).toEqual([]);
  });

  it('accepts several context ids', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/api/contexts',
      payload: { name: '@Errands' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/contexts',
      payload: { name: '@Phone' },
    });
    await newItem({ title: 'Errand', contextIds: [a.json().context.id] });
    await newItem({ title: 'Call', contextIds: [b.json().context.id] });
    await newItem({ title: 'Neither', contextIds: [] });

    const response = await app.inject({
      method: 'GET',
      url: `/api/recommendations?contextIds=${a.json().context.id},${b.json().context.id}`,
    });
    expect(response.json().recommendations).toHaveLength(2);
  });

  it('prefers a short task when energy is low', async () => {
    await newItem({ title: 'Long one', estimateMinutes: 200 });
    await newItem({ title: 'Short one', estimateMinutes: 10 });
    const response = await app.inject({ method: 'GET', url: '/api/recommendations?energy=low' });
    expect(response.json().recommendations[0].title).toBe('Short one');
  });

  it('expands the item on request', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = await newItem({ title: 'Call Dana', data: { assigner: 'Dana' } });

    const plain = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(plain.json().recommendations[0].item).toBeUndefined();
    expect(plain.json().recommendations[0].itemId).toBe(id);

    const expanded = await app.inject({ method: 'GET', url: '/api/recommendations?expand=true' });
    expect(expanded.json().recommendations[0].item.values.assigner).toBe('Dana');
  });

  it('gives every recommendation a reason and a confidence', async () => {
    await newItem({ deadlineOn: '2026-03-01' });
    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    for (const entry of response.json().recommendations) {
      expect(entry.reason).toBeTruthy();
      expect(entry.confidence).toBeGreaterThan(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('excludes done and someday items', async () => {
    const done = await newItem({ title: 'Finished' });
    await app.inject({ method: 'POST', url: `/api/items/${done}/complete` });
    await newItem({ title: 'Maybe later', container: 'someday' });

    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(response.json().recommendations).toEqual([]);
  });
});

describe('other focuses', () => {
  it('reports overdue items', async () => {
    await newItem({ title: 'Late', deadlineOn: '2026-03-01' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?focus=overdue',
    });
    expect(response.json().recommendations[0].kind).toBe('flag_risk');
    expect(response.json().recommendations[0].title).toContain('overdue');
  });

  it('reports waiting items past their follow-up', async () => {
    const dana = await app.inject({
      method: 'POST',
      url: '/api/people',
      payload: { name: 'Dana' },
    });
    await newItem({
      title: 'Send the report',
      container: 'waiting',
      waitingOnPersonId: dana.json().person.id,
      followUpAt: '2026-03-01T09:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?focus=waiting',
    });
    expect(response.json().recommendations[0].title).toContain('Dana');
  });

  it('reports a stalled project', async () => {
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Health' } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?focus=stalled_projects',
    });
    expect(response.json().recommendations[0].title).toContain('Health');
  });

  it('proposes a schedule that fits', async () => {
    await newItem({ title: 'Fits', estimateMinutes: 45 });
    await newItem({ title: 'Too big', estimateMinutes: 400 });
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?focus=schedule&timeAvailableMinutes=60',
    });
    const titles = response.json().recommendations.map((r: { title: string }) => r.title);
    expect(titles.some((title: string) => title.includes('Fits'))).toBe(true);
    expect(titles.some((title: string) => title.includes('Too big'))).toBe(false);
  });

  it('combines sources for a daily review', async () => {
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Health' } });
    await newItem({ title: 'Overdue thing', deadlineOn: '2026-03-01' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?focus=daily_review&limit=5',
    });
    expect(response.json().recommendations.length).toBeGreaterThan(1);
    expect(response.json().recommendations.length).toBeLessThanOrEqual(5);
  });
});

describe('provider selection', () => {
  it('rejects an unknown provider, naming what is available', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?provider=llama',
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('rules');
  });

  it('defaults to the deterministic provider', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(response.json().provider.requiresModel).toBe(false);
  });
});

describe('validation', () => {
  it('rejects an unknown focus', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?focus=phase-of-moon',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an over-large limit', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/recommendations?limit=500' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an implausible time budget', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/recommendations?timeAvailableMinutes=0',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('acting on a recommendation', () => {
  it('moves the item', async () => {
    const id = await newItem({ title: 'Call the dentist' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/adopt`,
      payload: { container: 'someday' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().item.container).toBe('someday');
  });

  it('refuses an illegal move', async () => {
    const id = await newItem();
    await app.inject({ method: 'POST', url: `/api/items/${id}/trash` });
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/adopt`,
      payload: { container: 'done' },
    });
    expect(response.statusCode).toBe(409);
  });
});
