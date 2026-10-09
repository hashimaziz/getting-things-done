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
    payload: { categoryId, title: 'A thing', estimateMinutes: 15, ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return response.json().item.id;
}

async function newPerson(name: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/people', payload: { name } });
  return response.json().person.id;
}

async function newProject(name = 'Health'): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/projects', payload: { name } });
  return response.json().project.id;
}

function kinds(body: { violations: Array<{ kind: string }> }): string[] {
  return body.violations.map((violation) => violation.kind);
}

describe('invariants', () => {
  it('reports a clean system', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/invariants' });
    expect(response.json().violations).toEqual([]);
  });

  it('reports a stalled project', async () => {
    await newProject();
    const response = await app.inject({ method: 'GET', url: '/api/invariants' });
    expect(kinds(response.json())).toContain('project_without_next_action');
  });

  it('clears the violation once the project has a next action', async () => {
    const projectId = await newProject();
    await newItem({ projectId });
    const response = await app.inject({ method: 'GET', url: '/api/invariants' });
    expect(kinds(response.json())).not.toContain('project_without_next_action');
  });

  it('reports waiting work with no follow-up date', async () => {
    // Reachable only by writing directly, since the transition rules clear the
    // field. Reported anyway, because a database edited by hand still needs it.
    const personId = await newPerson('Dana');
    await newItem({ container: 'waiting', waitingOnPersonId: personId, followUpAt: null });
    app.db.run("UPDATE items SET follow_up_at = NULL WHERE container = 'waiting'");
    const response = await app.inject({ method: 'GET', url: '/api/invariants' });
    expect(kinds(response.json())).toContain('waiting_without_follow_up');
  });

  it('reports a stale inbox item', async () => {
    await newItem({ container: 'inbox' });
    clock = '2026-03-30T00:00:00.000Z';
    const response = await app.inject({ method: 'GET', url: '/api/invariants' });
    expect(kinds(response.json())).toContain('stale_inbox_item');
  });

  it('honours a staleness threshold', async () => {
    await newItem({ container: 'inbox' });
    clock = '2026-03-05T00:00:00.000Z';
    const strict = await app.inject({ method: 'GET', url: '/api/invariants?staleInboxDays=2' });
    const lax = await app.inject({ method: 'GET', url: '/api/invariants?staleInboxDays=30' });
    expect(kinds(strict.json())).toContain('stale_inbox_item');
    expect(kinds(lax.json())).not.toContain('stale_inbox_item');
  });

  it('separates errors from warnings in the summary', async () => {
    await newProject();
    await newItem({ container: 'inbox', estimateMinutes: null });
    const response = await app.inject({ method: 'GET', url: '/api/invariants/ok' });
    expect(response.json().ok).toBe(false);
    expect(response.json().errors).toBeGreaterThan(0);
  });

  it('reports ok for a healthy system', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/invariants/ok' });
    expect(response.json()).toEqual({ ok: true, errors: 0, warnings: 0 });
  });

  it('rejects a malformed today', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/invariants?today=nope' });
    expect(response.statusCode).toBe(400);
  });
});

describe('the waiting-for list', () => {
  it('is empty when nothing is delegated', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/waiting' });
    expect(response.json().groups).toEqual([]);
  });

  it('groups by person, named', async () => {
    const dana = await newPerson('Dana');
    await newItem({
      container: 'waiting',
      waitingOnPersonId: dana,
      followUpAt: '2026-03-10T09:00:00.000Z',
    });

    const response = await app.inject({ method: 'GET', url: '/api/waiting' });
    expect(response.json().groups).toHaveLength(1);
    expect(response.json().groups[0].personName).toBe('Dana');
    expect(response.json().groups[0].items).toHaveLength(1);
  });

  it('labels items waiting on nobody in particular', async () => {
    await newItem({
      container: 'waiting',
      waitingOnPersonId: null,
      followUpAt: '2026-03-10T09:00:00.000Z',
    });
    const response = await app.inject({ method: 'GET', url: '/api/waiting' });
    expect(response.json().groups[0].personName).toBe('Nobody in particular');
  });

  it('counts items past their follow-up date', async () => {
    const dana = await newPerson('Dana');
    await newItem({
      container: 'waiting',
      waitingOnPersonId: dana,
      followUpAt: '2026-03-01T09:00:00.000Z',
    });
    const response = await app.inject({ method: 'GET', url: '/api/waiting' });
    expect(response.json().groups[0].overdue).toBe(1);
    expect(response.json().groups[0].needsAttention).toBe(true);
  });

  it('can hide settled groups', async () => {
    const dana = await newPerson('Dana');
    await newItem({
      container: 'waiting',
      waitingOnPersonId: dana,
      followUpAt: '2026-03-20T09:00:00.000Z',
    });
    const all = await app.inject({ method: 'GET', url: '/api/waiting' });
    const focused = await app.inject({ method: 'GET', url: '/api/waiting?includeSettled=false' });
    expect(all.json().groups).toHaveLength(1);
    expect(focused.json().groups).toEqual([]);
  });

  it('expands each item with its resolved fields', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'Reason', type: 'text' },
    });
    const dana = await newPerson('Dana');
    await newItem({
      container: 'waiting',
      waitingOnPersonId: dana,
      followUpAt: '2026-03-10T09:00:00.000Z',
      data: { reason: 'Awaiting quote' },
    });
    const response = await app.inject({ method: 'GET', url: '/api/waiting' });
    expect(response.json().groups[0].items[0].values.reason).toBe('Awaiting quote');
  });
});

describe('the weekly review', () => {
  it('returns the phases, the steps and their progress', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/review' });
    expect(response.statusCode).toBe(200);
    expect(response.json().phases.map((p: { id: string }) => p.id)).toEqual([
      'get_clear',
      'get_current',
      'get_creative',
    ]);
    expect(response.json().steps.length).toBeGreaterThan(8);
    expect(response.json().progress).toHaveLength(response.json().steps.length);
  });

  it('reports every step satisfied on an empty system', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/review' });
    expect(response.json().outstanding).toBe(0);
    expect(response.json().progress.every((e: { satisfied: boolean }) => e.satisfied)).toBe(true);
  });

  it('counts the inbox backlog', async () => {
    await newItem({ container: 'inbox' });
    await newItem({ container: 'inbox' });
    const response = await app.inject({ method: 'GET', url: '/api/review' });
    const step = response
      .json()
      .progress.find((e: { step: { id: string } }) => e.step.id === 'process_inbox');
    expect(step?.pending).toBe(2);
    expect(response.json().outstanding).toBeGreaterThan(0);
  });

  it('flags a stalled project on the projects step', async () => {
    await newProject();
    const response = await app.inject({ method: 'GET', url: '/api/review' });
    const step = response
      .json()
      .progress.find((e: { step: { id: string } }) => e.step.id === 'review_projects');
    expect(step?.problems).toBe(1);
    expect(step?.satisfied).toBe(false);
  });

  it('includes the invariant violations alongside the progress', async () => {
    await newProject();
    const response = await app.inject({ method: 'GET', url: '/api/review' });
    expect(kinds(response.json())).toContain('project_without_next_action');
  });

  it('reports no previous review on a fresh database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/review' });
    expect(response.json().lastReviewAt).toBeNull();
  });

  it('records that a review ran', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/review/complete' });
    expect(response.statusCode).toBe(201);
    expect(response.json().lastReviewAt).toBeTruthy();

    const after = await app.inject({ method: 'GET', url: '/api/review' });
    expect(after.json().lastReviewAt).toBeTruthy();
  });

  it('schedules the next review a week out', async () => {
    await app.inject({ method: 'POST', url: '/api/review/complete' });
    const next = app.repos.settings.getKnown('review.next_weekly_at');
    expect(next).toBeTruthy();
    const due = new Date(next as string).getTime();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    expect(due - Date.now()).toBeGreaterThan(weekMs - 60_000);
    expect(due - Date.now()).toBeLessThan(weekMs + 60_000);
  });

  it('stamps the review with a valid instant', async () => {
    await app.inject({ method: 'POST', url: '/api/review/complete' });
    const recorded = app.repos.settings.getKnown('review.last_weekly_at');
    expect(new Date(recorded as string).toISOString()).toBe(recorded);
  });
});
