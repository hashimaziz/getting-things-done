import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, type Db } from '@gtd/db';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

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

function widget(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    type: 'health.summary',
    title: null,
    x: 0,
    y: 0,
    width: 4,
    height: 2,
    props: {},
    ...overrides,
  };
}

describe('reading dashboards', () => {
  it('starts empty', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dashboards' });

    expect(response.statusCode).toBe(200);
    expect(response.json().dashboards).toEqual([]);
  });

  it('creates one', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home', widgets: [widget()] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().dashboard.name).toBe('Home');
  });

  it('derives a key from the name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'My Work' },
    });

    expect(response.json().dashboard.key).toBe('my-work');
  });

  /*
   * Two dashboards called "Work" must both exist. The unique index is on the key, and
   * failing the second request with an error about a field the person never set is a
   * confusing way to say "you already have one of those".
   */
  it('de-duplicates a derived key rather than rejecting the second', async () => {
    await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: 'Work' } });
    const second = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Work' },
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().dashboard.key).toBe('work-2');
  });

  it('falls back to a key for a name with nothing usable in it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: '***' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().dashboard.key).toBe('dashboard');
  });

  it('makes the first dashboard the default', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home' },
    });

    expect(response.json().dashboard.isDefault).toBe(true);
  });

  it('returns one by id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/dashboards/${created.json().dashboard.id}`,
    });

    expect(response.json().dashboard.name).toBe('Home');
  });

  it('404s for an unknown id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dashboards/nope' });

    expect(response.statusCode).toBe(404);
  });
});

describe('saving layouts', () => {
  it('saves a layout', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home' },
    });
    const id = created.json().dashboard.id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/dashboards/${id}`,
      payload: {
        widgets: [
          widget({ id: 'a', type: 'inbox.backlog' }),
          widget({ id: 'b', type: 'overdue.count' }),
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().dashboard.widgets.map((entry: { id: string }) => entry.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('round-trips widget props', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home' },
    });
    const id = created.json().dashboard.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/dashboards/${id}`,
      payload: { widgets: [widget({ props: { days: 7 } })] },
    });

    const response = await app.inject({ method: 'GET', url: `/api/dashboards/${id}` });
    expect(response.json().dashboard.widgets[0].props).toEqual({ days: 7 });
  });

  it('accepts any widget type, because the server does not know the registry', async () => {
    // Validating widget types here would make a layout unreadable by an older build of
    // the app, which is the wrong trade for a single-user local database.
    const created = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home' },
    });
    const id = created.json().dashboard.id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/dashboards/${id}`,
      payload: { widgets: [widget({ type: 'a.widget.from.the.future' })] },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects a layout that is not a list', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home', widgets: { nope: true } },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a widget with a negative position', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home', widgets: [widget({ x: -1 })] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a widget with no id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: {
        name: 'Home',
        widgets: [{ type: 'health.summary', x: 0, y: 0, width: 1, height: 1 }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: '  ' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('the default dashboard', () => {
  it('promotes one, demoting the other', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'A' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'B' },
    });

    await app.inject({
      method: 'PATCH',
      url: `/api/dashboards/${second.json().dashboard.id}`,
      payload: { isDefault: true },
    });

    const response = await app.inject({ method: 'GET', url: '/api/dashboards' });
    const defaults = response
      .json()
      .dashboards.filter((entry: { isDefault: boolean }) => entry.isDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.json().dashboard.id);
    expect(defaults[0].id).not.toBe(first.json().dashboard.id);
  });
});

describe('deleting', () => {
  it('removes one', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'Home' },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/dashboards/${created.json().dashboard.id}`,
    });

    expect(response.statusCode).toBe(204);
  });

  it('404s for an unknown id', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/dashboards/nope' });

    expect(response.statusCode).toBe(404);
  });

  it('leaves a replacement default behind', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      payload: { name: 'A' },
    });
    await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: 'B' } });

    await app.inject({ method: 'DELETE', url: `/api/dashboards/${first.json().dashboard.id}` });

    const response = await app.inject({ method: 'GET', url: '/api/dashboards' });
    expect(
      response.json().dashboards.filter((entry: { isDefault: boolean }) => entry.isDefault),
    ).toHaveLength(1);
  });
});
