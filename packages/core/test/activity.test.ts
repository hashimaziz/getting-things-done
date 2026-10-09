import { describe, expect, it } from 'vitest';
import {
  diffItems,
  summariseChanges,
  transitionEntry,
  verbForTransition,
} from '../src/activity.js';
import type { Item } from '../src/entities.js';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    categoryId: 'c1',
    title: 'Call the dentist',
    container: 'next_action',
    notes: null,
    whenAt: null,
    deadlineOn: null,
    estimateMinutes: null,
    projectId: null,
    waitingOnPersonId: null,
    followUpAt: null,
    contextIds: [],
    recurrenceId: null,
    parentItemId: null,
    occurrenceDate: null,
    isTemplate: false,
    data: {},
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    trashedAt: null,
    ...overrides,
  };
}

describe('diffItems', () => {
  it('finds no changes between identical items', () => {
    expect(diffItems(item(), item())).toEqual([]);
  });

  it('reports a changed title', () => {
    const changes = diffItems(item(), item({ title: 'Call the dentist again' }));
    expect(changes).toEqual([
      { field: 'title', from: 'Call the dentist', to: 'Call the dentist again' },
    ]);
  });

  it('reports a null becoming a value', () => {
    const changes = diffItems(item(), item({ deadlineOn: '2026-10-01' }));
    expect(changes[0]).toEqual({ field: 'deadlineOn', from: null, to: '2026-10-01' });
  });

  it('reports a value becoming null', () => {
    const changes = diffItems(item({ estimateMinutes: 15 }), item());
    expect(changes[0]).toEqual({ field: 'estimateMinutes', from: 15, to: null });
  });

  it('treats reordered context ids as unchanged', () => {
    // Contexts are a set from a user's point of view, so reordering them is noise.
    expect(diffItems(item({ contextIds: ['a', 'b'] }), item({ contextIds: ['b', 'a'] }))).toEqual(
      [],
    );
  });

  it('reports added and removed context ids', () => {
    const changes = diffItems(item({ contextIds: ['a'] }), item({ contextIds: ['a', 'b'] }));
    expect(changes).toEqual([{ field: 'contextIds', from: ['a'], to: ['a', 'b'] }]);
  });

  it('reports the same context set as unchanged', () => {
    expect(diffItems(item({ contextIds: ['a', 'b'] }), item({ contextIds: ['a', 'b'] }))).toEqual(
      [],
    );
  });

  it('diffs user-defined values per key', () => {
    // Changing one field must not report the whole map as replaced.
    const changes = diffItems(
      item({ data: { poc: 'Dana', priority: 'high' } }),
      item({ data: { poc: 'Alex', priority: 'high' } }),
    );
    expect(changes).toEqual([{ field: 'poc', from: 'Dana', to: 'Alex' }]);
  });

  it('reports a removed user-defined value as null', () => {
    const changes = diffItems(item({ data: { poc: 'Dana' } }), item({ data: {} }));
    expect(changes).toEqual([{ field: 'poc', from: 'Dana', to: null }]);
  });

  it('reports an added user-defined value', () => {
    const changes = diffItems(item(), item({ data: { poc: 'Dana' } }));
    expect(changes).toEqual([{ field: 'poc', from: null, to: 'Dana' }]);
  });

  it('compares object values structurally', () => {
    const before = item({ data: { checklist: [{ id: 'a', label: 'x', done: false }] } });
    const after = item({ data: { checklist: [{ id: 'a', label: 'x', done: true }] } });
    expect(diffItems(before, after)).toHaveLength(1);
  });

  it('reports a reorder as unchanged', () => {
    const changes = diffItems(item({ sortOrder: 0 }), item({ sortOrder: 0 }));
    expect(changes).toEqual([]);
  });

  it('reports a deliberate reorder', () => {
    const changes = diffItems(item({ sortOrder: 0 }), item({ sortOrder: 3 }));
    expect(changes).toEqual([{ field: 'sortOrder', from: 0, to: 3 }]);
  });

  it('never reports the id, which cannot change', () => {
    const changes = diffItems(item({ id: 'i1' }), item({ id: 'i2' }));
    expect(changes.map((change) => change.field)).not.toContain('id');
  });

  it('reports several changes at once', () => {
    const changes = diffItems(
      item({ title: 'A', estimateMinutes: 5 }),
      item({ title: 'B', estimateMinutes: 10, deadlineOn: '2026-10-01' }),
    );
    expect(changes.map((change) => change.field)).toEqual([
      'title',
      'deadlineOn',
      'estimateMinutes',
    ]);
  });
});

describe('summariseChanges', () => {
  it('says so when nothing changed', () => {
    expect(summariseChanges([])).toBe('no changes');
  });

  it('names a single field', () => {
    expect(summariseChanges([{ field: 'title', from: 'a', to: 'b' }])).toBe('title');
  });

  it('joins two fields', () => {
    expect(
      summariseChanges([
        { field: 'title', from: 'a', to: 'b' },
        { field: 'notes', from: null, to: 'c' },
      ]),
    ).toBe('title and notes');
  });

  it('joins three fields', () => {
    expect(
      summariseChanges([
        { field: 'a', from: 1, to: 2 },
        { field: 'b', from: 1, to: 2 },
        { field: 'c', from: 1, to: 2 },
      ]),
    ).toBe('a, b and c');
  });
});

describe('verbForTransition', () => {
  it.each([
    ['next_action', 'done', 'completed'],
    ['done', 'next_action', 'reopened'],
    ['next_action', 'trash', 'trashed'],
    ['trash', 'inbox', 'restored'],
    ['inbox', 'next_action', 'moved'],
    ['next_action', 'someday', 'moved'],
  ] as const)('maps %s -> %s to %s', (from, to, expected) => {
    expect(verbForTransition(from, to)).toBe(expected);
  });

  it('reports an in-place change as updated', () => {
    expect(verbForTransition('next_action', 'next_action')).toBe('updated');
  });

  it('prefers completed over moved when an item is finished', () => {
    expect(verbForTransition('inbox', 'done')).toBe('completed');
  });
});

describe('transitionEntry', () => {
  it('names the containers on both sides', () => {
    const entry = transitionEntry(item({ container: 'inbox' }), 'next_action');
    expect(entry).toEqual({
      verb: 'moved',
      from: { container: 'inbox' },
      to: { container: 'next_action' },
    });
  });
});
