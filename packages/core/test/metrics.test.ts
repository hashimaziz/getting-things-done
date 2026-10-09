import { describe, expect, it } from 'vitest';
import {
  AGING_BUCKETS,
  ageingBuckets,
  assessSystem,
  completionsPerDay,
  countBy,
  projectsWithoutNextAction,
  recentCompletions,
  sumEstimates,
  throughputWindow,
  type Grouping,
  type MetricLookups,
} from '../src/metrics/index.js';
import type { Item, Project } from '../src/entities.js';
import { addDays } from '../src/dates/index.js';

const TODAY = '2026-03-02' as const;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: 'cat-work',
    title: 'A thing',
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
    createdAt: `${TODAY}T09:00:00.000Z`,
    updatedAt: `${TODAY}T09:00:00.000Z`,
    completedAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Health',
    outcome: null,
    categoryId: 'cat-work',
    status: 'active',
    reviewAt: null,
    completedAt: null,
    createdAt: `${TODAY}T09:00:00.000Z`,
    updatedAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

const LOOKUPS: MetricLookups = {
  categories: new Map([['cat-work', { name: 'Work' } as never]]),
  projects: new Map([['p1', { name: 'Health' } as never]]),
  people: new Map([['person-1', { name: 'Dana' } as never]]),
};

describe('countBy', () => {
  it('groups by container', () => {
    const points = countBy(
      [
        item({ container: 'next_action' }),
        item({ container: 'next_action' }),
        item({ container: 'someday' }),
      ],
      { kind: 'container' },
    );
    expect(points).toEqual([
      { key: 'next_action', label: 'next_action', count: 2, minutes: 0, estimated: 0 },
      { key: 'someday', label: 'someday', count: 1, minutes: 0, estimated: 0 },
    ]);
  });

  it('groups by category using the supplied labels', () => {
    const points = countBy([item()], { kind: 'category' }, LOOKUPS);
    expect(points[0]).toMatchObject({ key: 'cat-work', label: 'Work', count: 1 });
  });

  it('falls back to the raw key for an unknown category', () => {
    const points = countBy([item({ categoryId: 'ghost' })], { kind: 'category' }, LOOKUPS);
    expect(points[0]?.label).toBe('ghost');
  });

  it('groups by project and names the no-project bucket', () => {
    const points = countBy([item(), item({ projectId: 'p1' })], { kind: 'project' }, LOOKUPS);
    expect(points.map((point) => point.label).sort()).toEqual(['Health', 'No project']);
  });

  it('groups by the waiting-on person', () => {
    const points = countBy([item({ waitingOnPersonId: 'person-1' })], { kind: 'person' }, LOOKUPS);
    expect(points[0]).toMatchObject({ key: 'person-1', label: 'Dana' });
  });

  it('groups by a user-defined field', () => {
    const points = countBy(
      [item({ data: { poc: 'Dana' } })],
      { kind: 'field', key: 'poc' },
      LOOKUPS,
    );
    expect(points[0]).toMatchObject({ key: 'Dana', count: 1 });
  });

  it('resolves a choice label for a field grouping', () => {
    const points = countBy(
      [item({ data: { priority: 'high' } })],
      { kind: 'field', key: 'priority' },
      {
        definitions: new Map([
          [
            'priority',
            {
              options: {
                kind: 'choices',
                choices: [
                  { value: 'low', label: 'Low', color: null, order: 0 },
                  { value: 'high', label: 'High', color: null, order: 1 },
                ],
              },
            } as never,
          ],
        ]),
      },
    );
    expect(points[0]?.label).toBe('High');
  });

  it('omits items with no value for the field', () => {
    const points = countBy([item(), item({ data: { poc: 'Dana' } })], {
      kind: 'field',
      key: 'poc',
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.count).toBe(1);
  });

  it('counts a multi-valued item once per value', () => {
    // "How much is tagged urgent" should count every item carrying the tag, not
    // the items that carry nothing but that tag.
    const points = countBy([item({ data: { tags: ['a', 'b'] } })], { kind: 'field', key: 'tags' });
    expect(points.map((point) => point.key).sort()).toEqual(['a', 'b']);
  });

  it('sums estimates and counts how many items had one', () => {
    const points = countBy(
      [
        item({ estimateMinutes: 30 }),
        item({ estimateMinutes: 10 }),
        item({ estimateMinutes: null }),
      ],
      { kind: 'container' },
    );
    expect(points[0]).toMatchObject({ count: 3, minutes: 40, estimated: 2 });
  });

  it('sorts by count descending, so the largest bucket is first', () => {
    const points = countBy(
      [
        item({ container: 'inbox' }),
        item({ container: 'calendar' }),
        item({ container: 'calendar' }),
      ],
      { kind: 'container' },
    );
    expect(points.map((point) => point.key)).toEqual(['calendar', 'inbox']);
  });

  it('breaks a count tie alphabetically, so the order is stable', () => {
    const points = countBy([item({ container: 'someday' }), item({ container: 'inbox' })], {
      kind: 'container',
    });
    expect(points.map((point) => point.key)).toEqual(['inbox', 'someday']);
  });

  it('returns nothing for an empty collection', () => {
    expect(countBy([], { kind: 'container' })).toEqual([]);
  });
});

describe('sumEstimates', () => {
  it('ignores items with no estimate', () => {
    expect(sumEstimates([item({ estimateMinutes: 30 }), item()])).toBe(30);
  });

  it('treats a zero estimate as absent', () => {
    expect(sumEstimates([item({ estimateMinutes: 0 })])).toBe(0);
  });
});

describe('completionsPerDay', () => {
  it('counts completions per day', () => {
    const points = completionsPerDay(
      [
        item({ completedAt: '2026-03-01T09:00:00.000Z' }),
        item({ completedAt: '2026-03-01T17:00:00.000Z' }),
        item({ completedAt: '2026-03-02T09:00:00.000Z' }),
      ],
      { from: '2026-03-01', to: '2026-03-02' },
    );
    expect(points).toEqual([
      { date: '2026-03-01', count: 2, minutes: 0 },
      { date: '2026-03-02', count: 1, minutes: 0 },
    ]);
  });

  it('zero-fills days with no completions', () => {
    // A gap in the data renders as a broken line rather than as "nothing
    // happened", which is the difference between a readable chart and a wrong one.
    const points = completionsPerDay([item({ completedAt: '2026-03-01T09:00:00.000Z' })], {
      from: '2026-03-01',
      to: '2026-03-05',
    });
    expect(points).toHaveLength(5);
    expect(points.map((point) => point.count)).toEqual([1, 0, 0, 0, 0]);
  });

  it('excludes completions outside the window', () => {
    const points = completionsPerDay(
      [
        item({ completedAt: '2026-02-28T09:00:00.000Z' }),
        item({ completedAt: '2026-03-02T09:00:00.000Z' }),
        item({ completedAt: '2026-03-10T09:00:00.000Z' }),
      ],
      { from: '2026-03-01', to: '2026-03-05' },
    );
    expect(points.reduce((total, point) => total + point.count, 0)).toBe(1);
  });

  it('ignores items that are not completed', () => {
    const points = completionsPerDay([item()], { from: '2026-03-01', to: '2026-03-01' });
    expect(points[0]?.count).toBe(0);
  });

  it('sums estimates per day', () => {
    const points = completionsPerDay(
      [
        item({ completedAt: '2026-03-01T09:00:00.000Z', estimateMinutes: 30 }),
        item({ completedAt: '2026-03-01T10:00:00.000Z', estimateMinutes: 15 }),
      ],
      { from: '2026-03-01', to: '2026-03-01' },
    );
    expect(points[0]).toEqual({ date: '2026-03-01', count: 2, minutes: 45 });
  });

  it('uses the local completion day, not the UTC day', () => {
    // An item completed at 23:30 local belongs to that local day.
    const points = completionsPerDay([item({ completedAt: '2026-03-02T23:30:00.000Z' })], {
      from: '2026-03-01',
      to: '2026-03-03',
    });
    expect(points.find((point) => point.count === 1)?.date).toBe('2026-03-02');
  });
});

describe('throughputWindow', () => {
  it('includes today as the last day', () => {
    expect(throughputWindow(7, TODAY)).toEqual({ from: '2026-02-24', to: '2026-03-02' });
  });

  it('returns a single day for a window of one', () => {
    expect(throughputWindow(1, TODAY)).toEqual({ from: '2026-03-02', to: '2026-03-02' });
  });

  it('never produces a negative span', () => {
    expect(throughputWindow(0, TODAY).from).toBe('2026-03-02');
  });
});

describe('ageingBuckets', () => {
  it('bands open items by how long they have been sitting', () => {
    const points = ageingBuckets(
      [
        item({ createdAt: `${TODAY}T09:00:00.000Z` }),
        item({ createdAt: `${addDays(TODAY, -10)}T09:00:00.000Z` }),
        item({ createdAt: `${addDays(TODAY, -60)}T09:00:00.000Z` }),
        item({ createdAt: `${addDays(TODAY, -200)}T09:00:00.000Z` }),
      ],
      TODAY,
    );
    expect(points.map((point) => point.count)).toEqual([1, 1, 1, 1]);
  });

  it('excludes completed and trashed items', () => {
    const points = ageingBuckets(
      [
        item({ container: 'done', createdAt: `${addDays(TODAY, -60)}T09:00:00.000Z` }),
        item({ container: 'trash', createdAt: `${addDays(TODAY, -60)}T09:00:00.000Z` }),
      ],
      TODAY,
    );
    expect(points.reduce((total, point) => total + point.count, 0)).toBe(0);
  });

  it('counts every open item exactly once', () => {
    const items = [0, 1, 2, 5, 10, 45, 200].map((days) =>
      item({ createdAt: `${addDays(TODAY, -days)}T09:00:00.000Z` }),
    );
    const total = ageingBuckets(items, TODAY).reduce((sum, point) => sum + point.count, 0);
    expect(total).toBe(items.length);
  });

  it('has contiguous bands, so nothing falls between them', () => {
    for (let i = 1; i < AGING_BUCKETS.length; i += 1) {
      expect(AGING_BUCKETS[i]!.minDays).toBe(AGING_BUCKETS[i - 1]!.maxDays);
    }
    expect(AGING_BUCKETS.at(-1)?.maxDays).toBeNull();
  });
});

describe('assessSystem', () => {
  it('reports an empty system', () => {
    expect(assessSystem([], { today: TODAY })).toMatchObject({
      inboxBacklog: 0,
      inboxOldest: null,
      overdue: 0,
      dueSoon: 0,
      waiting: 0,
      openMinutes: 0,
    });
  });

  it('counts the inbox backlog', () => {
    const health = assessSystem([item({ container: 'inbox' }), item({ container: 'inbox' })], {
      today: TODAY,
    });
    expect(health.inboxBacklog).toBe(2);
  });

  it('reports the oldest unclarified item', () => {
    const health = assessSystem(
      [
        item({ container: 'inbox', createdAt: '2026-02-01T09:00:00.000Z' }),
        item({ container: 'inbox', createdAt: '2026-03-01T09:00:00.000Z' }),
      ],
      { today: TODAY },
    );
    expect(health.inboxOldest).toBe('2026-02-01');
  });

  it('separates overdue from due soon', () => {
    const health = assessSystem(
      [
        item({ deadlineOn: '2026-03-01' }),
        item({ deadlineOn: '2026-03-03' }),
        item({ deadlineOn: '2026-12-01' }),
        item({ deadlineOn: TODAY }),
      ],
      { today: TODAY, dueSoonDays: 7 },
    );
    expect(health.overdue).toBe(1);
    expect(health.dueSoon).toBe(2);
  });

  it('treats today as due soon rather than overdue', () => {
    expect(assessSystem([item({ deadlineOn: TODAY })], { today: TODAY }).overdue).toBe(0);
  });

  it('counts calendar commitments on a given day', () => {
    const health = assessSystem(
      [
        item({ container: 'calendar', whenAt: `${TODAY}T09:00:00.000Z` }),
        item({ container: 'calendar', whenAt: `${TODAY}T14:00:00.000Z` }),
        item({ container: 'calendar', whenAt: '2026-03-05T09:00:00.000Z' }),
      ],
      { today: TODAY, scheduledDay: TODAY },
    );
    expect(health.scheduledCount).toBe(2);
  });

  it('counts waiting items and those past their follow-up date', () => {
    const health = assessSystem(
      [
        item({ container: 'waiting', followUpAt: '2026-03-01T09:00:00.000Z' }),
        item({ container: 'waiting', followUpAt: '2026-03-10T09:00:00.000Z' }),
        item({ container: 'waiting', followUpAt: null }),
      ],
      { today: TODAY },
    );
    expect(health.waiting).toBe(3);
    expect(health.waitingOverdue).toBe(1);
  });

  it('reports how long something has been waiting', () => {
    const health = assessSystem(
      [
        item({
          container: 'waiting',
          createdAt: `${addDays(TODAY, -40)}T09:00:00.000Z`,
          followUpAt: '2026-03-10T09:00:00.000Z',
        }),
      ],
      { today: TODAY },
    );
    expect(health.waitingOldestDays).toBe(40);
  });

  it('excludes completed and trashed items from open measures', () => {
    const health = assessSystem(
      [
        item({ container: 'done', deadlineOn: '2026-01-01', estimateMinutes: 60 }),
        item({ container: 'trash', estimateMinutes: 60 }),
      ],
      { today: TODAY },
    );
    expect(health.overdue).toBe(0);
    expect(health.openMinutes).toBe(0);
  });

  it('counts open items with no estimate', () => {
    const health = assessSystem(
      [
        item({ estimateMinutes: 30 }),
        item({ estimateMinutes: null }),
        item({ estimateMinutes: 0 }),
      ],
      { today: TODAY },
    );
    expect(health.openMinutes).toBe(30);
    expect(health.openWithoutEstimate).toBe(2);
  });

  it('counts open items with no project', () => {
    const health = assessSystem([item({ projectId: null }), item({ projectId: 'p1' })], {
      today: TODAY,
    });
    expect(health.openWithoutProject).toBe(1);
  });

  it('counts someday items', () => {
    expect(assessSystem([item({ container: 'someday' })], { today: TODAY }).someday).toBe(1);
  });

  it('does not double-count an inbox item as overdue and as open', () => {
    const health = assessSystem(
      [item({ container: 'inbox', deadlineOn: '2026-01-01', estimateMinutes: 15 })],
      { today: TODAY },
    );
    expect(health.inboxBacklog).toBe(1);
    expect(health.overdue).toBe(1);
    expect(health.openMinutes).toBe(15);
  });
});

describe('projectsWithoutNextAction', () => {
  it('reports an active project with nothing to do', () => {
    // The GTD invariant: a project with no next action has silently stopped.
    const ids = projectsWithoutNextAction([], [project({ id: 'p1' })]);
    expect(ids).toEqual(['p1']);
  });

  it('is satisfied by any open item on the project', () => {
    const ids = projectsWithoutNextAction(
      [item({ projectId: 'p1', container: 'next_action' })],
      [project({ id: 'p1' })],
    );
    expect(ids).toEqual([]);
  });

  it('does not count a completed item as a next action', () => {
    const ids = projectsWithoutNextAction(
      [item({ projectId: 'p1', container: 'done' })],
      [project({ id: 'p1' })],
    );
    expect(ids).toEqual(['p1']);
  });

  it('does not count a trashed item as a next action', () => {
    const ids = projectsWithoutNextAction(
      [item({ projectId: 'p1', container: 'trash' })],
      [project({ id: 'p1' })],
    );
    expect(ids).toEqual(['p1']);
  });

  it('counts a calendar item as a next action', () => {
    const ids = projectsWithoutNextAction(
      [item({ projectId: 'p1', container: 'calendar' })],
      [project({ id: 'p1' })],
    );
    expect(ids).toEqual([]);
  });

  it('ignores projects that are not active', () => {
    const ids = projectsWithoutNextAction(
      [],
      [
        project({ id: 'p1', status: 'someday' }),
        project({ id: 'p2', status: 'completed' }),
        project({ id: 'p3', status: 'dropped' }),
      ],
    );
    expect(ids).toEqual([]);
  });
});

describe('recentCompletions', () => {
  it('returns the most recent first', () => {
    const items = [
      item({ completedAt: '2026-03-01T09:00:00.000Z' }),
      item({ completedAt: '2026-03-02T09:00:00.000Z' }),
    ];
    expect(recentCompletions(items, 7, TODAY).map((i) => i.completedAt)).toEqual([
      '2026-03-02T09:00:00.000Z',
      '2026-03-01T09:00:00.000Z',
    ]);
  });

  it('respects the window', () => {
    const items = [item({ completedAt: '2026-01-01T09:00:00.000Z' })];
    expect(recentCompletions(items, 7, TODAY)).toEqual([]);
  });

  it('ignores open items', () => {
    expect(recentCompletions([item()], 7, TODAY)).toEqual([]);
  });
});

export type { Grouping };
