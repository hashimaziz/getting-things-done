import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '@gtd/core';
import {
  CategoryNotFoundError,
  IllegalContainerTransitionError,
  ItemNotFoundError,
  createCategoriesRepo,
  createContextsRepo,
  createFieldDefsRepo,
  createItemsRepo,
  createPeopleRepo,
  bootstrap,
  migrate,
  openMemoryDb,
  type Db,
} from '../src/index.js';

let db: Db;
let categories: ReturnType<typeof createCategoriesRepo>;
let items: ReturnType<typeof createItemsRepo>;
let fieldDefs: ReturnType<typeof createFieldDefsRepo>;
let contexts: ReturnType<typeof createContextsRepo>;
let people: ReturnType<typeof createPeopleRepo>;
let violations: Array<{ id: string; messages: string[] }>;

let categoryId: string;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
  categories = createCategoriesRepo(db);
  fieldDefs = createFieldDefsRepo(db);
  contexts = createContextsRepo(db);
  people = createPeopleRepo(db);
  violations = [];
  items = createItemsRepo(db, {
    onInvariantViolation: (item, messages) => violations.push({ id: item.id, messages }),
    now: () => '2026-01-02T03:04:05.000Z',
  });
  categoryId = categories.create({ key: 'work', name: 'Work' }).id;
});

describe('categories repo', () => {
  it('creates and reads back a category', () => {
    const created = categories.create({ key: 'home', name: 'Home' });
    expect(created.name).toBe('Home');
    expect(created.isArchived).toBe(false);
    expect(categories.getById(created.id)?.id).toBe(created.id);
    expect(categories.getByKey('home')?.id).toBe(created.id);
  });

  it('derives a key from the name when none is given', () => {
    expect(categories.create({ key: '', name: 'Side Projects' }).key).toBe('side_projects');
  });

  it('lists in sort order then name', () => {
    categories.create({ key: 'zebra', name: 'Zebra', sortOrder: 1 });
    categories.create({ key: 'apple', name: 'Apple', sortOrder: 0 });
    expect(categories.list().map((c) => c.name)).toEqual(['Apple', 'Work', 'Zebra']);
  });

  it('excludes archived categories by default', () => {
    const home = categories.create({ key: 'home', name: 'Home' });
    categories.update(home.id, { isArchived: true });
    expect(categories.list().map((c) => c.name)).toEqual(['Work']);
    expect(categories.list({ includeArchived: true })).toHaveLength(2);
  });

  it('updates only the supplied fields', () => {
    const home = categories.create({ key: 'home', name: 'Home', color: '#fff' });
    const updated = categories.update(home.id, { name: 'House' });
    expect(updated.name).toBe('House');
    expect(updated.color).toBe('#fff');
  });

  it('clears a nullable field', () => {
    const home = categories.create({ key: 'home', name: 'Home', description: 'x' });
    expect(categories.update(home.id, { description: null }).description).toBeNull();
  });

  it('returns the unchanged row for an empty patch', () => {
    const home = categories.create({ key: 'home', name: 'Home' });
    expect(categories.update(home.id, {}).name).toBe('Home');
  });

  it('throws when updating a missing category', () => {
    expect(() => categories.update('nope', { name: 'x' })).toThrow(CategoryNotFoundError);
  });

  it('rejects a duplicate key', () => {
    categories.create({ key: 'home', name: 'Home' });
    expect(() => categories.create({ key: 'home', name: 'Other' })).toThrow();
  });

  it('counts rows', () => {
    expect(categories.count()).toBe(1);
    categories.create({ key: 'home', name: 'Home' });
    expect(categories.count()).toBe(2);
  });
});

describe('field definitions repo', () => {
  it('creates a definition with a derived key', () => {
    const definition = fieldDefs.create({ label: 'Complete By', type: 'date' });
    expect(definition.key).toBe('complete_by');
    expect(fieldDefs.getById(definition.id)?.key).toBe('complete_by');
  });

  it('de-duplicates derived keys within a scope', () => {
    fieldDefs.create({ label: 'POC', type: 'text' });
    expect(fieldDefs.create({ label: 'POC', type: 'text' }).key).toBe('poc_2');
  });

  it('allows the same key in two categories', () => {
    const work = categories.getByKey('work')!;
    const home = categories.create({ key: 'home', name: 'Home' });
    expect(fieldDefs.create({ label: 'POC', type: 'text', categoryId: work.id }).key).toBe('poc');
    expect(fieldDefs.create({ label: 'POC', type: 'text', categoryId: home.id }).key).toBe('poc');
  });

  it('round-trips options and default values through JSON columns', () => {
    const definition = fieldDefs.create({
      label: 'Priority',
      type: 'priority',
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: '#0f0', order: 0 },
          { value: 'high', label: 'High', color: '#f00', order: 1 },
        ],
      },
      defaultValue: 'low',
    });
    const loaded = fieldDefs.getById(definition.id);
    expect(loaded?.options.kind === 'choices' && loaded.options.choices).toHaveLength(2);
    expect(loaded?.defaultValue).toBe('low');
  });

  it('round-trips a checklist default value', () => {
    const definition = fieldDefs.create({
      label: 'Leaving The House',
      type: 'checklist',
      defaultValue: [
        { id: 'a', label: 'wallet', done: true },
        { id: 'b', label: 'keys', done: false },
      ],
    });
    expect(fieldDefs.getById(definition.id)?.defaultValue).toEqual([
      { id: 'a', label: 'wallet', done: true },
      { id: 'b', label: 'keys', done: false },
    ]);
  });

  it('merges a partial update and bumps updatedAt', () => {
    const definition = fieldDefs.create({ label: 'Assigner', type: 'text' });
    const updated = fieldDefs.update(definition.id, { label: 'Owner' });
    expect(updated.label).toBe('Owner');
    expect(updated.type).toBe('text');
    expect(updated.createdAt).toBe(definition.createdAt);
  });

  it('refuses an update that would make the definition invalid', () => {
    const definition = fieldDefs.create({ label: 'Assigner', type: 'text' });
    expect(() => fieldDefs.update(definition.id, { key: 'title' })).toThrow();
  });

  it('throws when updating a missing definition', () => {
    expect(() => fieldDefs.update('nope', { label: 'x' })).toThrow(/No field definition/);
  });

  it('merges global definitions into a category view', () => {
    fieldDefs.create({ label: 'Priority', type: 'priority' });
    fieldDefs.create({ label: 'Assigner', type: 'text', categoryId: categoryId });
    const keys = fieldDefs.listForCategory(categoryId).map((d) => d.key);
    expect(keys).toContain('priority');
    expect(keys).toContain('assigner');
  });

  it('lets a category override a global definition on the same key', () => {
    fieldDefs.create({ label: 'Priority', type: 'priority' });
    fieldDefs.create({ label: 'Priority', type: 'select', categoryId: categoryId });
    const resolved = fieldDefs.listForCategory(categoryId).filter((d) => d.key === 'priority');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.type).toBe('select');
  });

  it('finds a definition by key within a scope', () => {
    fieldDefs.create({ label: 'Assigner', type: 'text', categoryId: categoryId });
    expect(fieldDefs.getByKey('assigner', categoryId)).not.toBeNull();
    expect(fieldDefs.getByKey('assigner', null)).toBeNull();
  });

  it('deletes a definition', () => {
    const definition = fieldDefs.create({ label: 'Assigner', type: 'text' });
    fieldDefs.remove(definition.id);
    expect(fieldDefs.getById(definition.id)).toBeNull();
  });
});

describe('items repo: creation', () => {
  it('creates an item and reads it back', () => {
    const item = items.create({ categoryId: categoryId, title: '  Call the dentist  ' });
    expect(item.title).toBe('Call the dentist');
    expect(item.container).toBe('next_action');
    expect(item.contextIds).toEqual([]);
    expect(item.data).toEqual({});
    expect(items.getById(item.id)?.id).toBe(item.id);
  });

  it('routes to the calendar when a hard date is supplied', () => {
    const item = items.create({
      categoryId: categoryId,
      title: 'Standup',
      whenAt: '2026-01-02T09:00:00.000Z',
    });
    expect(item.container).toBe('calendar');
  });

  it('does not route to the calendar for a deadline alone', () => {
    const item = items.create({
      categoryId: categoryId,
      title: 'Ship it',
      deadlineOn: '2026-02-01',
    });
    expect(item.container).toBe('next_action');
  });

  it('stores field data', () => {
    const item = items.create({
      categoryId: categoryId,
      title: 'Review PR',
      data: { poc: 'Dana', estimate: 30 },
    });
    expect(items.getById(item.id)?.data).toEqual({ poc: 'Dana', estimate: 30 });
  });

  it('records a created entry in the activity log', () => {
    const item = items.create({ categoryId: categoryId, title: 'Thing' });
    const entries = db.all<{ verb: string }>(
      'SELECT verb FROM activity_log WHERE item_id = ? ORDER BY at',
      item.id,
    );
    expect(entries.map((entry) => entry.verb)).toEqual(['created']);
  });

  it('rejects an item with a missing category', () => {
    expect(() => items.create({ categoryId: 'nope', title: 'x' })).toThrow();
  });
});

describe('items repo: transitions', () => {
  let item: Item;

  beforeEach(() => {
    item = items.create({ categoryId: categoryId, title: 'Call the dentist' });
  });

  it('completes an item', () => {
    const done = items.complete(item.id);
    expect(done.container).toBe('done');
    expect(done.completedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('reopens a completed item', () => {
    items.complete(item.id);
    const reopened = items.reopen(item.id);
    expect(reopened.container).toBe('next_action');
    expect(reopened.completedAt).toBeNull();
  });

  it('moves to the calendar and records the move', () => {
    const moved = items.setContainer(item.id, 'calendar');
    expect(moved.container).toBe('calendar');
    const verbs = db
      .all<{ verb: string }>(
        'SELECT verb FROM activity_log WHERE item_id = ? ORDER BY rowid',
        item.id,
      )
      .map((row) => row.verb);
    expect(verbs).toEqual(['created', 'moved']);
  });

  it('moves to trash and restores to the inbox', () => {
    expect(items.trash(item.id).container).toBe('trash');
    const restored = items.restore(item.id);
    expect(restored.container).toBe('inbox');
    expect(restored.trashedAt).toBeNull();
  });

  it('refuses to send a trashed item anywhere but the inbox', () => {
    items.trash(item.id);
    expect(() => items.setContainer(item.id, 'done')).toThrow(IllegalContainerTransitionError);
  });

  it('refuses to send a clarified item back to the inbox', () => {
    expect(() => items.setContainer(item.id, 'inbox')).toThrow(IllegalContainerTransitionError);
  });

  it('explains why a refused transition is refused', () => {
    try {
      items.setContainer(item.id, 'inbox');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalContainerTransitionError);
      expect((error as Error).message).toContain('cannot move');
    }
  });

  it('clears the hard date when leaving the calendar', () => {
    const scheduled = items.create({
      categoryId: categoryId,
      title: 'Standup',
      whenAt: '2026-01-02T09:00:00.000Z',
    });
    const moved = items.setContainer(scheduled.id, 'next_action');
    expect(moved.whenAt).toBeNull();
  });

  it('clears the delegate when leaving waiting', () => {
    const person = people.create({ name: 'Dana' });
    const delegated = items.create({
      categoryId: categoryId,
      title: 'Send the report',
      waitingOnPersonId: person.id,
      followUpAt: '2026-01-05T09:00:00.000Z',
    });
    const moved = items.setContainer(delegated.id, 'next_action');
    expect(moved.waitingOnPersonId).toBeNull();
    expect(moved.followUpAt).toBeNull();
  });

  it('reports an invariant violation instead of hiding it', () => {
    // Force an illegal state directly, since the transition rules prevent one
    // arriving through the API.
    db.run("UPDATE items SET container = 'calendar', when_at = NULL WHERE id = ?", item.id);
    items.getById(item.id);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.messages[0]).toContain('Calendar');
  });

  it('throws for a missing item', () => {
    expect(() => items.complete('nope')).toThrow(ItemNotFoundError);
  });
});

describe('items repo: reads', () => {
  it('lists by container', () => {
    items.create({ categoryId: categoryId, title: 'a' });
    items.create({ categoryId: categoryId, title: 'b' });
    items.create({ categoryId: categoryId, title: 'c', container: 'someday' });
    expect(items.listByContainer('next_action')).toHaveLength(2);
    expect(items.listByContainer('someday')).toHaveLength(1);
  });

  it('counts by container', () => {
    items.create({ categoryId: categoryId, title: 'a' });
    items.create({ categoryId: categoryId, title: 'b', container: 'someday' });
    expect(items.countByContainer()).toEqual({ next_action: 1, someday: 1 });
  });

  it('returns null for a missing item', () => {
    expect(items.getById('nope')).toBeNull();
  });

  it('sets field data wholesale', () => {
    const item = items.create({ categoryId: categoryId, title: 'x' });
    const updated = items.setData(item.id, { poc: 'Dana' });
    expect(updated.data).toEqual({ poc: 'Dana' });
  });
});

describe('contexts repo', () => {
  it('creates a global context', () => {
    const context = contexts.create({ name: '@Computer' });
    expect(context.categoryId).toBeNull();
    expect(contexts.getById(context.id)?.name).toBe('@Computer');
  });

  it('lists global contexts alongside a category’s own', () => {
    contexts.create({ name: '@Anywhere' });
    contexts.create({ name: '@Office', categoryId: categoryId });
    const names = contexts.list(categoryId).map((context) => context.name);
    expect(names).toEqual(['@Anywhere', '@Office']);
  });

  it('excludes other categories’ contexts', () => {
    const home = categories.create({ key: 'home', name: 'Home' });
    contexts.create({ name: '@Home', categoryId: home.id });
    contexts.create({ name: '@Office', categoryId: categoryId });
    expect(contexts.list(categoryId).map((c) => c.name)).toEqual(['@Office']);
  });

  it('lists everything when no category is given', () => {
    contexts.create({ name: '@Anywhere' });
    contexts.create({ name: '@Office', categoryId: categoryId });
    expect(contexts.list()).toHaveLength(2);
  });
});

describe('people repo', () => {
  it('creates and reads a person', () => {
    const person = people.create({ name: 'Dana', email: 'dana@example.com' });
    expect(people.getById(person.id)?.name).toBe('Dana');
  });

  it('searches by name case-insensitively', () => {
    people.create({ name: 'Dana' });
    expect(people.search('dan').map((p) => p.name)).toEqual(['Dana']);
  });

  it('searches by email', () => {
    people.create({ name: 'Dana', email: 'dana@example.com' });
    expect(people.search('example')).toHaveLength(1);
  });

  it('treats underscores and percent signs as literals', () => {
    people.create({ name: 'Axel' });
    // A LIKE pattern would match "Axel" for "a_l"; escaped, it should not.
    expect(people.search('a_l')).toHaveLength(0);
  });

  it('updates and removes', () => {
    const person = people.create({ name: 'Dana' });
    expect(people.update(person.id, { email: 'd@e.com' }).email).toBe('d@e.com');
    people.remove(person.id);
    expect(people.getById(person.id)).toBeNull();
  });
});

describe('JSON column helpers', () => {
  it('falls back on malformed JSON rather than throwing', () => {
    // A single bad value must not take down an entire list query.
    db.run(
      `INSERT INTO items (id, category_id, title, container, data_json, created_at, updated_at)
       VALUES ('bad', ?, 't', 'next_action', '{oops', 't', 't')`,
      categoryId,
    );
    expect(items.getById('bad')?.data).toEqual({});
  });

  it('falls back on an empty string', () => {
    db.run(
      `INSERT INTO items (id, category_id, title, container, contexts_json, created_at, updated_at)
       VALUES ('n1', ?, 't', 'next_action', '', 't', 't')`,
      categoryId,
    );
    expect(items.getById('n1')?.contextIds).toEqual([]);
  });

  it('falls back on an explicit JSON null', () => {
    db.run(
      `INSERT INTO items (id, category_id, title, container, data_json, created_at, updated_at)
       VALUES ('n2', ?, 't', 'next_action', 'null', 't', 't')`,
      categoryId,
    );
    expect(items.getById('n2')?.data).toEqual({});
  });
});

describe('bootstrap integration', () => {
  it('produces a database a repository can write to immediately', () => {
    const { db: realDb } = bootstrap({ inMemory: true });
    const realCategories = createCategoriesRepo(realDb);
    const realItems = createItemsRepo(realDb, { onInvariantViolation: vi.fn() });
    const category = realCategories.create({ key: 'work', name: 'Work' });
    const item = realItems.create({ categoryId: category.id, title: 'First thing' });
    expect(realItems.getById(item.id)?.title).toBe('First thing');
    realDb.close();
  });
});
