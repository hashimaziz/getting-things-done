import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, type Db } from '@gtd/db';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let db: Db;
let app: FastifyInstance;
let categoryId: string;

/**
 * A pinned "today".
 *
 * Recurrence materialisation generates dates relative to today, so a test that
 * asserts on generated dates is worthless without a way to pin it. 2026-03-02 is a
 * Monday, which makes weekly expectations readable.
 */
const TODAY = '2026-03-02' as const;

beforeEach(async () => {
  db = openMemoryDb();
  migrate(db);
  app = await buildApp({
    db,
    logger: false,
    reconcileIndexes: false,
    now: () => TODAY,
  });
  await app.ready();
  const created = await app.inject({
    method: 'POST',
    url: '/api/categories',
    payload: { name: 'Home' },
  });
  categoryId = created.json().category.id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function newItem(title = 'Water the plants'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/items',
    payload: { categoryId, title },
  });
  expect(response.statusCode).toBe(201);
  return response.json().item.id;
}

describe('recurrence presets', () => {
  it('lists the presets for the picker', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/recurrence/presets' });
    const keys = response.json().presets.map((p: { key: string }) => p.key);
    expect(keys).toContain('daily');
    expect(keys).toContain('weekly');
    expect(keys).toContain('weekdays');
  });

  it('gives every preset a label', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/recurrence/presets' });
    for (const preset of response.json().presets) {
      expect(preset.label).toBeTruthy();
    }
  });
});

describe('preview', () => {
  it('shows the next occurrences without saving', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/preview',
      payload: { rrule: 'FREQ=WEEKLY;BYDAY=MO', anchorDate: '2026-03-02' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().description).toBe('Every week on Mon');
    expect(response.json().occurrences[0].date).toBe('2026-03-02');
  });

  it('supplies a DTSTART when the rule omits one', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/preview',
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02' },
    });
    expect(response.json().rrule).toContain('DTSTART');
  });

  it('rejects a malformed rule with a 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/preview',
      payload: { rrule: 'FREQ=NEVER' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unsupported part with a 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/preview',
      payload: { rrule: 'FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO', anchorDate: '2026-03-02' },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('BYSETPOS');
  });

  it('requires an rrule', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/preview',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('attaching a series', () => {
  it('marks the item as a template and creates occurrences', async () => {
    const id = await newItem();
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=WEEKLY;BYDAY=MO', anchorDate: '2026-03-02', horizonDays: 28 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().item.isTemplate).toBe(true);
    expect(response.json().occurrences.length).toBeGreaterThan(0);
  });

  it('keeps the template out of the item list', async () => {
    const id = await newItem();
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02', horizonDays: 3 },
    });
    const list = await app.inject({ method: 'GET', url: '/api/items' });
    expect(list.json().items.map((i: { id: string }) => i.id)).not.toContain(id);
    // The occurrences are real tasks and are listed.
    expect(list.json().total).toBe(3);
  });

  it('rejects a malformed rule with a 400', async () => {
    const id = await newItem();
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=FORTNIGHTLY' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects attaching twice', async () => {
    const id = await newItem();
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02' },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=WEEKLY' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects attaching to a missing item', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/items/nope/recurrence',
      payload: { rrule: 'FREQ=DAILY' },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('inherits custom field values onto occurrences', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/categories/${categoryId}/fields`,
      payload: { label: 'For Who', type: 'text' },
    });
    const id = await newItem();
    await app.inject({
      method: 'PATCH',
      url: `/api/items/${id}`,
      payload: { data: { for_who: 'Alex' } },
    });
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02', horizonDays: 1 },
    });

    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/occurrences` });
    expect(response.json().occurrences[0].data.for_who).toBe('Alex');
  });
});

describe('listing occurrences', () => {
  it('returns them with a human description', async () => {
    const id = await newItem();
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', anchorDate: '2026-03-02', horizonDays: 28 },
    });
    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/occurrences` });
    expect(response.json().description).toBe('Every week on Mon, Wed');
    expect(
      response.json().occurrences.map((o: { occurrenceDate: string }) => o.occurrenceDate),
    ).toEqual([
      '2026-03-02',
      '2026-03-04',
      '2026-03-09',
      '2026-03-11',
      '2026-03-16',
      '2026-03-18',
      '2026-03-23',
      '2026-03-25',
    ]);
  });

  it('rejects listing occurrences of an item that is not a series', async () => {
    const id = await newItem();
    const response = await app.inject({ method: 'GET', url: `/api/items/${id}/occurrences` });
    expect(response.statusCode).toBe(422);
  });
});

describe('materialising', () => {
  it('tops up one series without duplicating', async () => {
    const id = await newItem();
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02', horizonDays: 3 },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence/materialize`,
      payload: { horizonDays: 3 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().createdCount).toBe(0);
    expect(response.json().skipped).toBe(3);
  });

  it('tops up every series', async () => {
    const first = await newItem('Water the plants');
    const second = await newItem('Take out the bins');
    await app.inject({
      method: 'POST',
      url: `/api/items/${first}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02', horizonDays: 1 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/items/${second}/recurrence`,
      payload: { rrule: 'FREQ=WEEKLY;BYDAY=MO', anchorDate: '2026-03-02', horizonDays: 1 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/materialize',
      payload: { horizonDays: 10 },
    });
    expect(response.json().series).toBe(2);
    expect(response.json().created).toBeGreaterThan(0);
    expect(response.json().truncated).toBe(false);
  });

  it('reports zero series when there are none', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/materialize',
      payload: {},
    });
    expect(response.json()).toEqual({ series: 0, created: 0, truncated: false });
  });

  it('rejects an out-of-range horizon', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recurrence/materialize',
      payload: { horizonDays: 5_000 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('completing an occurrence', () => {
  it('completes it and returns the next', async () => {
    const id = await newItem();
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02', horizonDays: 1 },
    });
    const occurrences = (
      await app.inject({ method: 'GET', url: `/api/items/${id}/occurrences` })
    ).json().occurrences;
    const first = occurrences[0];

    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${first.id}/occurrence/complete`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().occurrence.container).toBe('done');
    expect(response.json().next.occurrenceDate).toBe('2026-03-03');
  });

  it('rejects completing an item that is not an occurrence', async () => {
    const id = await newItem();
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/occurrence/complete`,
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses to run out of occurrences', async () => {
    const id = await newItem();
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: {
        rrule: 'DTSTART;TZID=UTC:20260302T000000\nRRULE:FREQ=DAILY;COUNT=1',
        anchorDate: '2026-03-02',
      },
    });
    const occurrences = (
      await app.inject({ method: 'GET', url: `/api/items/${id}/occurrences` })
    ).json().occurrences;

    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${occurrences[0].id}/occurrence/complete`,
    });
    expect(response.json().next).toBeNull();
  });
});

describe('detaching a series', () => {
  it('removes the occurrences and restores the item', async () => {
    const id = await newItem();
    await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02', horizonDays: 3 },
    });

    const response = await app.inject({ method: 'DELETE', url: `/api/items/${id}/recurrence` });
    expect(response.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/items' });
    expect(list.json().total).toBe(1);
    expect(list.json().items[0].id).toBe(id);

    const item = await app.inject({ method: 'GET', url: `/api/items/${id}` });
    expect(item.json().item.isTemplate).toBe(false);
    expect(item.json().item.recurrenceId).toBeNull();
  });
});

describe('timezone setting', () => {
  it('is used when a rule does not name a zone', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings/app.timezone',
      payload: { value: 'Europe/Berlin' },
    });
    const id = await newItem();
    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${id}/recurrence`,
      payload: { rrule: 'FREQ=DAILY', anchorDate: '2026-03-02', horizonDays: 1 },
    });
    expect(response.statusCode).toBe(201);
    const occurrences = await app.inject({ method: 'GET', url: `/api/items/${id}/occurrences` });
    expect(occurrences.json().rrule).toContain('TZID=Europe/Berlin');
  });
});
