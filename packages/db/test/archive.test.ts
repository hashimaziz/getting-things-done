import { beforeEach, describe, expect, it } from 'vitest';
import { createItemFieldResolver } from '@gtd/core';
import {
  createRepositories,
  migrate,
  openMemoryDb,
  type Db,
  type Repositories,
} from '../src/index.js';

let db: Db;
let repos: Repositories;
let categoryId: string;

function resolver() {
  return createItemFieldResolver({
    fieldTypes: [
      { key: 'poc', type: 'text' },
      { key: 'priority', type: 'priority' },
      { key: 'tags', type: 'multiselect' },
    ],
  });
}

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
  repos = createRepositories(db);
  categoryId = repos.categories.create({ key: 'work', name: 'Work' }).id;
});

/** An item completed at a chosen instant. */
function completed(title: string, at: string, data: Record<string, unknown> = {}): string {
  const item = repos.items.create({ categoryId, title, data: data as never });
  db.run(
    'UPDATE items SET container = ?, completed_at = ?, updated_at = ? WHERE id = ?',
    'done',
    at,
    at,
    item.id,
  );
  db.run(
    "INSERT INTO activity_log (id, item_id, verb, at, from_json, to_json) VALUES (?, ?, 'completed', ?, ?, ?)",
    `log-${title}-${at}`,
    item.id,
    at,
    JSON.stringify({ container: 'next_action' }),
    JSON.stringify({ container: 'done' }),
  );
  return item.id;
}

describe('activity recording', () => {
  it('records creation', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    const entries = repos.activity.listForItem(item.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.verb).toBe('created');
  });

  it('records a field-level diff rather than a bare edit', () => {
    // An edit logged with null from/to makes the history view and undo useless.
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.update(item.id, { title: 'Renamed' });

    const [entry] = repos.activity.listForItem(item.id);
    expect(entry?.verb).toBe('updated');
    expect(entry?.from).toEqual({ title: 'Thing' });
    expect(entry?.to).toEqual({ title: 'Renamed' });
  });

  it('records only the fields that changed', () => {
    const item = repos.items.create({ categoryId, title: 'Thing', notes: 'keep me' });
    repos.items.update(item.id, { title: 'Renamed' });
    const [entry] = repos.activity.listForItem(item.id);
    expect(Object.keys(entry?.from ?? {})).toEqual(['title']);
  });

  it('records nothing for an update that changes nothing', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.update(item.id, { title: 'Thing' });
    expect(repos.activity.listForItem(item.id)).toHaveLength(1);
  });

  it('records a user-defined field change', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.setData(item.id, { poc: 'Dana' });
    const [entry] = repos.activity.listForItem(item.id);
    expect(entry?.from).toEqual({ poc: null });
    expect(entry?.to).toEqual({ poc: 'Dana' });
  });

  it('records a container change as moved', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.setContainer(item.id, 'someday');
    expect(repos.activity.listForItem(item.id)[0]?.verb).toBe('moved');
  });

  it('records lifecycle verbs with the containers on both sides', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.complete(item.id);
    const entry = repos.activity.listForItem(item.id)[0];
    expect(entry?.verb).toBe('completed');
    expect(entry?.from).toEqual({ container: 'next_action' });
    expect(entry?.to).toEqual({ container: 'done' });
  });

  it('records trashed and restored', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.trash(item.id);
    expect(repos.activity.listForItem(item.id)[0]?.verb).toBe('trashed');
    repos.items.restore(item.id);
    expect(repos.activity.listForItem(item.id)[0]?.verb).toBe('restored');
  });
});

describe('activity reading', () => {
  it('returns newest first', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    db.run("UPDATE activity_log SET at = '2026-01-01T00:00:00.000Z' WHERE item_id = ?", item.id);
    repos.items.update(item.id, { title: 'A' });
    repos.items.update(item.id, { title: 'B' });

    // Newest first. The oldest entry is the creation, which records the container
    // it landed in rather than a title, so compare verbs rather than payloads.
    const entries = repos.activity.listForItem(item.id);
    expect(entries.map((entry) => entry.verb)).toEqual(['updated', 'updated', 'created']);
    expect(entries.slice(0, 2).map((entry) => entry.to?.title)).toEqual(['B', 'A']);
  });

  it('filters by verb', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.complete(item.id);
    expect(repos.activity.listRecent({ verb: 'completed' })).toHaveLength(1);
    expect(repos.activity.listRecent({ verb: 'trashed' })).toHaveLength(0);
  });

  it('filters by since', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    db.run("UPDATE activity_log SET at = '2026-01-01T00:00:00.000Z' WHERE item_id = ?", item.id);
    repos.items.update(item.id, { title: 'Later' });
    expect(repos.activity.listRecent({ since: '2026-06-01T00:00:00.000Z' })).toHaveLength(1);
  });

  it('clamps the limit', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    for (let i = 0; i < 5; i += 1) {
      repos.items.update(item.id, { title: `v${i}` });
    }
    expect(repos.activity.listForItem(item.id, { limit: 2 })).toHaveLength(2);
  });

  it('includes titles in the global feed', () => {
    const item = repos.items.create({ categoryId, title: 'Call the dentist' });
    repos.items.complete(item.id);
    const feed = repos.activity.listWithTitles({ limit: 1 });
    expect(feed[0]?.title).toBe('Call the dentist');
  });

  it('counts by verb', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.complete(item.id);
    repos.items.update(item.id, { title: 'x' });
    const counts = repos.activity.countByVerb();
    expect(counts.created).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.updated).toBe(1);
  });

  it('groups completions by calendar day', () => {
    completed('a', '2026-01-01T09:00:00.000Z');
    completed('b', '2026-01-01T17:00:00.000Z');
    completed('c', '2026-01-02T09:00:00.000Z');

    const counts = repos.activity.completionsPerDay('2026-01-01');
    expect(counts).toEqual([
      { date: '2026-01-01', count: 2 },
      { date: '2026-01-02', count: 1 },
    ]);
  });

  it('drops the log when the item is deleted', () => {
    const item = repos.items.create({ categoryId, title: 'Thing' });
    repos.items.remove(item.id);
    expect(repos.activity.listForItem(item.id)).toEqual([]);
  });
});

describe('archive queries', () => {
  beforeEach(() => {
    repos.fieldDefs.create({
      label: 'Priority',
      type: 'priority',
      categoryId,
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 0 },
          { value: 'high', label: 'High', color: null, order: 1 },
        ],
      },
    });
    repos.fieldDefs.create({ label: 'Tags', type: 'multiselect', categoryId });
  });

  it('lists only completed items', () => {
    repos.items.create({ categoryId, title: 'Open' });
    completed('Finished', '2026-01-01T09:00:00.000Z');

    const result = repos.archive.query({ resolver: resolver() });
    expect(result.items.map((item) => item.title)).toEqual(['Finished']);
    expect(result.total).toBe(1);
  });

  it('excludes recurring series templates', () => {
    const template = repos.items.create({ categoryId, title: 'Weekly', isTemplate: true });
    db.run("UPDATE items SET container = 'done' WHERE id = ?", template.id);
    expect(repos.archive.query({ resolver: resolver() }).total).toBe(0);
  });

  it('filters on a core field', () => {
    completed('A', '2026-01-01T09:00:00.000Z', { priority: 'high' });
    completed('B', '2026-01-02T09:00:00.000Z', { priority: 'low' });

    const result = repos.archive.query({
      resolver: resolver(),
      filter: { kind: 'condition', field: 'priority', operator: 'equals', value: 'high' },
    });
    expect(result.items.map((item) => item.title)).toEqual(['A']);
  });

  it('filters on a date field', () => {
    completed('A', '2026-01-01T09:00:00.000Z', {});
    completed('B', '2026-02-01T09:00:00.000Z', {});
    const result = repos.archive.query({
      resolver: resolver(),
      filter: {
        kind: 'group',
        conjunction: 'and',
        children: [
          {
            kind: 'condition',
            field: 'completedAt',
            operator: 'gte',
            value: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
    });
    expect(result.items.map((item) => item.title)).toEqual(['B']);
  });

  it('reports an unpaged total alongside a limited page', () => {
    completed('A', '2026-01-01T09:00:00.000Z');
    completed('B', '2026-01-02T09:00:00.000Z');
    completed('C', '2026-01-03T09:00:00.000Z');
    const result = repos.archive.query({ resolver: resolver(), limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it('sorts by completion time', () => {
    completed('A', '2026-01-03T09:00:00.000Z');
    completed('B', '2026-01-01T09:00:00.000Z');
    const result = repos.archive.query({
      resolver: resolver(),
      sort: [{ field: 'completedAt', direction: 'desc' }],
    });
    expect(result.items.map((item) => item.title)).toEqual(['A', 'B']);
  });

  it('rejects an unknown field', () => {
    expect(() =>
      repos.archive.query({
        resolver: resolver(),
        filter: { kind: 'condition', field: 'nope', operator: 'equals', value: 'x' },
      }),
    ).toThrow(/Unknown field/);
  });
});

describe('archive facets', () => {
  beforeEach(() => {
    repos.fieldDefs.create({
      label: 'Priority',
      type: 'priority',
      categoryId,
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 0 },
          { value: 'high', label: 'High', color: null, order: 1 },
        ],
      },
    });
    repos.fieldDefs.create({ label: 'Remarks', type: 'longtext', categoryId });
    repos.fieldDefs.create({ label: 'Tags', type: 'multiselect', categoryId });
  });

  it('counts values across completed items', () => {
    completed('A', '2026-01-01T09:00:00.000Z', { priority: 'high' });
    completed('B', '2026-01-02T09:00:00.000Z', { priority: 'high' });
    completed('C', '2026-01-03T09:00:00.000Z', { priority: 'low' });

    const facets = repos.archive.facets(repos.fieldDefs.listForCategory(categoryId));
    const priority = facets.find((facet) => facet.field === 'priority');
    expect(priority?.values).toEqual([
      { value: 'high', label: 'High', count: 2 },
      { value: 'low', label: 'Low', count: 1 },
    ]);
  });

  it('omits a free-text field, whose value list would be noise', () => {
    completed('A', '2026-01-01T09:00:00.000Z');
    const facets = repos.archive.facets(repos.fieldDefs.listForCategory(categoryId));
    expect(facets.map((facet) => facet.field)).not.toContain('remarks');
  });

  it('omits a field with no values present', () => {
    const facets = repos.archive.facets(repos.fieldDefs.listForCategory(categoryId));
    expect(facets.map((facet) => facet.field)).not.toContain('priority');
  });

  it('counts distinct items for a multi-valued field', () => {
    // An item tagged x,y contributes two json rows. Counting rows rather than
    // distinct items would report two items holding "x".
    const tagged = repos.items.create({ categoryId, title: 'Tagged' });
    repos.items.complete(tagged.id);
    repos.items.setData(tagged.id, { tags: ['x', 'y'] });
    completed('Plain', '2026-01-01T09:00:00.000Z', {});

    const facets = repos.archive.facets(repos.fieldDefs.listForCategory(categoryId));
    const tags = facets.find((facet) => facet.field === 'tags');
    expect(tags?.values).toEqual([
      { value: 'x', label: 'x', count: 1 },
      { value: 'y', label: 'y', count: 1 },
    ]);
  });

  it('marks a choice field as a closed list and a date field as open', () => {
    completed('A', '2026-01-01T09:00:00.000Z', { priority: 'high' });
    const definitions = [
      ...repos.fieldDefs.listForCategory(categoryId),
      repos.fieldDefs.create({ label: 'Due', type: 'date', categoryId }),
    ];
    const facets = repos.archive.facets(definitions);
    expect(facets.find((facet) => facet.field === 'priority')?.isOpen).toBe(false);
  });
});

describe('daily completions', () => {
  it('counts completions per day', () => {
    completed('A', '2026-01-01T09:00:00.000Z');
    completed('B', '2026-01-01T17:00:00.000Z');
    completed('C', '2026-01-02T09:00:00.000Z');
    expect(repos.archive.dailyCompletions('2026-01-01', '2026-01-31')).toEqual([
      { date: '2026-01-01', count: 2 },
      { date: '2026-01-02', count: 1 },
    ]);
  });

  it('respects the window', () => {
    completed('A', '2026-01-01T09:00:00.000Z');
    completed('C', '2026-01-20T09:00:00.000Z');
    expect(repos.archive.dailyCompletions('2026-01-15', '2026-01-31')).toHaveLength(1);
  });

  it('reports the latest completion', () => {
    completed('A', '2026-01-01T09:00:00.000Z');
    completed('C', '2026-01-20T09:00:00.000Z');
    expect(repos.archive.latestCompletion()).toBe('2026-01-20');
  });

  it('reports null when nothing has been completed', () => {
    expect(repos.archive.latestCompletion()).toBeNull();
  });
});
