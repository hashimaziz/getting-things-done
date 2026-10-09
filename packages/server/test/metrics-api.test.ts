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
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function newItem(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/items',
    payload: { categoryId, title: 'A thing', ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return response.json().item.id;
}

describe('health', () => {
  it('reports an empty system', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.inboxBacklog).toBe(0);
    expect(body.overdue).toBe(0);
    expect(body.openMinutes).toBe(0);
    expect(body.ageing).toHaveLength(4);
    expect(body.projectsWithoutNextAction).toEqual([]);
  });

  it('counts the inbox backlog', async () => {
    await newItem({ container: 'inbox' });
    await newItem({ container: 'inbox' });
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().inboxBacklog).toBe(2);
  });

  it('separates overdue from due soon', async () => {
    await newItem({ deadlineOn: '2026-03-01' });
    await newItem({ deadlineOn: '2026-03-04' });
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().overdue).toBe(1);
    expect(response.json().dueSoon).toBe(1);
  });

  it('honours a custom due-soon window', async () => {
    await newItem({ deadlineOn: '2026-03-20' });
    const narrow = await app.inject({ method: 'GET', url: '/api/metrics/health?dueSoonDays=7' });
    const wide = await app.inject({ method: 'GET', url: '/api/metrics/health?dueSoonDays=30' });
    expect(narrow.json().dueSoon).toBe(0);
    expect(wide.json().dueSoon).toBe(1);
  });

  it('sums open estimates and counts the ones missing them', async () => {
    await newItem({ estimateMinutes: 30 });
    await newItem({ estimateMinutes: 15 });
    await newItem({});
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().openMinutes).toBe(45);
    expect(response.json().openWithoutEstimate).toBe(1);
  });

  it('counts waiting items and those past their follow-up', async () => {
    const person = await app.inject({
      method: 'POST',
      url: '/api/people',
      payload: { name: 'Dana' },
    });
    const personId = person.json().person.id;

    await newItem({
      container: 'waiting',
      waitingOnPersonId: personId,
      followUpAt: '2026-03-01T09:00:00.000Z',
    });
    await newItem({
      container: 'waiting',
      waitingOnPersonId: personId,
      followUpAt: '2026-03-20T09:00:00.000Z',
    });

    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().waiting).toBe(2);
    expect(response.json().waitingOverdue).toBe(1);
  });

  it('counts hard commitments on today', async () => {
    await newItem({ container: 'calendar', whenAt: '2026-03-02T09:00:00.000Z' });
    await newItem({ container: 'calendar', whenAt: '2026-03-05T09:00:00.000Z' });
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().scheduledCount).toBe(1);
    expect(response.json().scheduledOn).toBe('2026-03-02');
  });

  it('excludes completed items from open measures', async () => {
    const id = await newItem({ deadlineOn: '2026-01-01', estimateMinutes: 60 });
    await app.inject({ method: 'POST', url: `/api/items/${id}/complete` });
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().overdue).toBe(0);
    expect(response.json().openMinutes).toBe(0);
  });

  it('reports projects with no next action, by name', async () => {
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Health' },
    });
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().projectsWithoutNextAction).toEqual([
      { id: project.json().project.id, name: 'Health' },
    ]);
  });

  it('stops reporting a project once it has a next action', async () => {
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Health' },
    });
    await newItem({ projectId: project.json().project.id });
    const response = await app.inject({ method: 'GET', url: '/api/metrics/health' });
    expect(response.json().projectsWithoutNextAction).toEqual([]);
  });

  it('rejects a nonsense due-soon window', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/health?dueSoonDays=9999',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('breakdown', () => {
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
  });

  it('returns nothing without a grouping', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/metrics/breakdown' });
    expect(response.json().points).toEqual([]);
  });

  it('groups by container', async () => {
    await newItem({ container: 'next_action' });
    await newItem({ container: 'someday' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=container',
    });
    expect(
      response
        .json()
        .points.map((p: { key: string }) => p.key)
        .sort(),
    ).toEqual(['next_action', 'someday']);
  });

  it('labels categories by name', async () => {
    await newItem();
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=category',
    });
    expect(response.json().points[0].label).toBe('Work');
  });

  it('groups by a user-defined field with its choice labels', async () => {
    await newItem({ data: { priority: 'high' } });
    await newItem({ data: { priority: 'low' } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=field&fieldKey=priority',
    });
    const labels = response
      .json()
      .points.map((p: { label: string }) => p.label)
      .sort();
    expect(labels).toEqual(['High', 'Low']);
  });

  it('includes a no-project bucket', async () => {
    await newItem();
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=project',
    });
    expect(response.json().points[0].label).toBe('No project');
  });

  it('reports a bucket for completed items only when asked', async () => {
    const open = await newItem();
    const done = await newItem();
    await app.inject({ method: 'POST', url: `/api/items/${done}/complete` });

    const all = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=container',
    });
    const openOnly = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=container&scope=open',
    });
    const doneOnly = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=container&scope=done',
    });

    expect(all.json().points).toHaveLength(2);
    expect(openOnly.json().points.map((p: { key: string }) => p.key)).toEqual(['next_action']);
    expect(doneOnly.json().points.map((p: { key: string }) => p.key)).toEqual(['done']);
    expect(open).toBeTruthy();
  });

  it('requires a fieldKey when grouping by field', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=field',
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('fieldKey');
  });

  it('rejects an unsupported grouping', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=phase-of-moon',
    });
    expect(response.statusCode).toBe(400);
  });

  it('totals estimates per bucket', async () => {
    await newItem({ estimateMinutes: 30 });
    await newItem({ estimateMinutes: 10 });
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/breakdown?grouping=container',
    });
    expect(response.json().points[0]).toMatchObject({ minutes: 40, estimated: 2 });
  });
});

describe('throughput', () => {
  it('zero-fills the window', async () => {
    const id = await newItem();
    await app.inject({ method: 'POST', url: `/api/items/${id}/complete` });

    const response = await app.inject({ method: 'GET', url: '/api/metrics/throughput?days=7' });
    expect(response.json().window).toEqual({ from: '2026-02-24', to: '2026-03-02' });
    expect(response.json().days).toHaveLength(7);
    expect(response.json().days.at(-1)).toEqual({ date: '2026-03-02', count: 1, minutes: 0 });
  });

  it('defaults to 30 days', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/metrics/throughput' });
    expect(response.json().days).toHaveLength(30);
  });

  it('accepts an explicit window', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/throughput?from=2026-02-01&to=2026-02-05',
    });
    expect(response.json().days).toHaveLength(5);
  });

  it('counts several completions on one day', async () => {
    const a = await newItem();
    await app.inject({ method: 'POST', url: `/api/items/${a}/complete` });
    clock = '2026-03-02T12:00:00.000Z';
    const b = await newItem();
    await app.inject({ method: 'POST', url: `/api/items/${b}/complete` });

    const response = await app.inject({ method: 'GET', url: '/api/metrics/throughput?days=1' });
    expect(response.json().days[0]).toMatchObject({ date: '2026-03-02', count: 2 });
  });

  it('rejects an out-of-range window', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/metrics/throughput?days=9999' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed date', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/throughput?from=nope',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('recent completions', () => {
  it('lists the newest first, with resolved fields', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'Assigner', type: 'text' },
    });
    const id = await newItem({ data: { assigner: 'Dana' } });
    await app.inject({ method: 'POST', url: `/api/items/${id}/complete` });

    const response = await app.inject({ method: 'GET', url: '/api/metrics/recent' });
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0].values.assigner).toBe('Dana');
  });

  it('excludes items completed outside the window', async () => {
    const id = await newItem();
    await app.inject({ method: 'POST', url: `/api/items/${id}/complete` });
    const response = await app.inject({ method: 'GET', url: '/api/metrics/recent?days=1' });
    expect(response.json().items).toHaveLength(1);
  });

  it('excludes open items', async () => {
    await newItem();
    const response = await app.inject({ method: 'GET', url: '/api/metrics/recent' });
    expect(response.json().items).toEqual([]);
  });

  it('honours a limit', async () => {
    for (let i = 0; i < 4; i += 1) {
      await app.inject({ method: 'POST', url: `/api/items/${await newItem()}/complete` });
    }
    const response = await app.inject({ method: 'GET', url: '/api/metrics/recent?limit=2' });
    expect(response.json().items).toHaveLength(2);
  });
});
