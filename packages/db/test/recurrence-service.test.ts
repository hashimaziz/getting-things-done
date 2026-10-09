import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_HORIZON_DAYS,
  MAX_OCCURRENCES_PER_RUN,
  createRecurrenceRulesRepo,
  createRecurrenceService,
  createRepositories,
  migrate,
  openMemoryDb,
  type Db,
  type ItemsRepo,
  type RecurrenceService,
} from '../src/index.js';
import type { Item } from '@gtd/core';

let db: Db;
let items: ItemsRepo;
let categoryId: string;
let service: RecurrenceService;

/** Frozen clock, so materialisation is deterministic. */
const TODAY = '2026-03-02' as const;

function build(now: string = TODAY): RecurrenceService {
  return createRecurrenceService({
    items,
    rules: createRecurrenceRulesRepo(db),
    defaultTimezone: 'UTC',
    now: () => now as never,
  });
}

/** Synchronous on purpose: an un-awaited helper here silently passes `undefined`
 *  as an id, which surfaces as a baffling SQLite bind error rather than a type
 *  error. */
function newItem(overrides: Partial<Parameters<typeof items.create>[0]> = {}): Item {
  return items.create({ categoryId, title: 'Water the plants', ...overrides });
}

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
  const repos = createRepositories(db);
  items = repos.items;
  categoryId = repos.categories.create({ key: 'work', name: 'Work' }).id;
  service = build();
});

describe('attaching a series', () => {
  it('marks the item as a template', () => {
    const item = newItem();
    const result = service.attachSeries(item.id, { rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(result.item.isTemplate).toBe(true);
    expect(result.item.recurrenceId).toBeTruthy();
  });

  it('keeps the template itself out of every list', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=WEEKLY;BYDAY=MO', horizonDays: 28 });

    // The occurrences are real tasks and should be listed; the template is a
    // series definition and should not, or it would double-count the series.
    const listed = items.listByContainer('next_action');
    expect(listed.map((i) => i.id)).not.toContain(item.id);
    expect(listed.length).toBeGreaterThan(0);
    expect(items.query({ resolver: resolver() }).items.map((i) => i.id)).not.toContain(item.id);
  });

  it('still exposes templates through the dedicated read', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(items.listTemplates().map((t) => t.id)).toEqual([item.id]);
  });

  it('creates occurrences within the horizon', () => {
    const item = newItem();
    const result = service.attachSeries(item.id, {
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      horizonDays: 28,
    });
    // 2026-03-02 is a Monday, and a 28-day window from it holds four of them.
    expect(result.created).toBe(4);
    expect(items.occurrencesOf(item.id).map((o) => o.occurrenceDate)).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
    ]);
  });

  it('inherits the template fields onto each occurrence', () => {
    const item = newItem({
      estimateMinutes: 10,
      notes: 'Use the watering can',
      data: { poc: 'Dana' },
    } as never);
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 2 });

    const [first] = items.occurrencesOf(item.id);
    expect(first?.estimateMinutes).toBe(10);
    expect(first?.notes).toBe('Use the watering can');
    expect(first?.data.poc).toBe('Dana');
    expect(first?.title).toBe('Water the plants');
  });

  it('does not copy a soft deadline onto occurrences', () => {
    // A deadline on the template would put every future occurrence past due the
    // moment it was created, which means nothing for a repeating task.
    const item = newItem({ deadlineOn: '2026-01-01' });
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 2 });
    for (const occurrence of items.occurrencesOf(item.id)) {
      expect(occurrence.deadlineOn).toBeNull();
    }
    expect(items.getById(item.id)?.deadlineOn).toBe('2026-01-01');
  });

  it('places an all-day series in next actions, not the calendar', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });
    expect(items.occurrencesOf(item.id)[0]?.container).toBe('next_action');
  });

  it('places a timed series on the calendar', () => {
    const item = newItem();
    // A DTSTART with a time makes the series a hard commitment.
    service.attachSeries(item.id, {
      rrule: 'DTSTART;TZID=UTC:20260302T090000\nRRULE:FREQ=DAILY',
      horizonDays: 1,
    });
    const [first] = items.occurrencesOf(item.id);
    expect(first?.container).toBe('calendar');
    expect(first?.whenAt).toBe('2026-03-02T09:00:00.000Z');
  });

  it('injects a DTSTART when the rule omits one', () => {
    // Someone picking "every 2 weeks" should not have to think about what anchors it.
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=WEEKLY;INTERVAL=2', horizonDays: 20 });
    expect(service.specFor(item.id).rrule).toContain('DTSTART');
    expect(items.occurrencesOf(item.id).length).toBeGreaterThan(0);
  });

  it('does not backfill history', () => {
    // Attaching a daily rule must not produce a backlog of tasks the user never
    // intended to create.
    const item = newItem();
    service.attachSeries(item.id, {
      rrule: 'DTSTART;TZID=UTC:20260101T000000\nRRULE:FREQ=DAILY',
      horizonDays: 10,
    });
    for (const occurrence of items.occurrencesOf(item.id)) {
      expect((occurrence.occurrenceDate as string) >= TODAY).toBe(true);
    }
  });

  it('rejects a malformed rule at attach time, not at run time', () => {
    const item = newItem();
    expect(() => service.attachSeries(item.id, { rrule: 'FREQ=NEVER' })).toThrow(/FREQ/);
  });

  it('rejects an unsupported part', () => {
    const item = newItem();
    expect(() =>
      service.attachSeries(item.id, {
        rrule: 'DTSTART;TZID=UTC:20260302T000000\nRRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO',
      }),
    ).toThrow(/BYSETPOS/);
  });

  it('refuses to attach a second series to the same item', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=WEEKLY' });
    expect(() => service.attachSeries(item.id, { rrule: 'FREQ=DAILY' })).toThrow(
      /recurring series/,
    );
  });

  it('throws for a missing item', () => {
    expect(() => service.attachSeries('nope', { rrule: 'FREQ=DAILY' })).toThrow(/does not exist/);
  });
});

describe('de-duplication', () => {
  it('is idempotent across repeated runs', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 10 });

    const before = items.occurrencesOf(item.id).length;
    const second = service.materialize(item.id, { horizonDays: 10 });
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBe(before);
    expect(items.occurrencesOf(item.id)).toHaveLength(before);
  });

  it('skips an occurrence that already exists', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 5 });
    const result = service.materialize(item.id, { horizonDays: 5 });
    expect(result.created).toHaveLength(0);
  });

  it('re-materialising after a day adds only the newly-reached days', () => {
    const item = newItem();
    // A three-day horizon on the 2nd: the 2nd, 3rd and 4th exist.
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 3 });

    const tomorrow = build('2026-03-03');
    const result = tomorrow.materialize(item.id, { horizonDays: 5 });

    // The window is now the 3rd to the 7th. Three of those already exist, so only
    // the 5th, 6th and 7th are new.
    expect(result.created.map((o) => o.occurrenceDate)).toEqual([
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
    ]);
  });

  it('does not recreate a trashed occurrence', () => {
    // Trashing an occurrence means "not this time". Recreating it would undo the
    // user's decision, and the unique index agrees.
    const item = newItem();
    // A one-day horizon so the 2nd is the only occurrence to begin with.
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });
    const [first] = items.occurrencesOf(item.id);
    items.trash(first!.id);

    const result = service.materialize(item.id, { horizonDays: 2 });
    expect(result.created.map((o) => o.occurrenceDate)).toEqual(['2026-03-03']);
    expect(items.occurrencesOf(item.id)).toHaveLength(2);
  });

  it('has a unique index backing the invariant even across trash', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });
    const [first] = items.occurrencesOf(item.id);
    items.trash(first!.id);
    expect(() =>
      items.create({
        categoryId,
        title: 'Duplicate',
        parentItemId: item.id,
        occurrenceDate: first!.occurrenceDate,
      }),
    ).toThrow();
  });

  it('has a unique index backing the invariant', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });
    const [first] = items.occurrencesOf(item.id);
    expect(() =>
      items.create({
        categoryId,
        title: 'Duplicate',
        parentItemId: item.id,
        occurrenceDate: first!.occurrenceDate,
      }),
    ).toThrow();
  });
});

describe('the backstop', () => {
  it('stops at the per-run ceiling and reports it', () => {
    const item = newItem();
    // Attached with no horizon, so the ceiling is what stops the run rather than
    // the window.
    // A one-day horizon, so only today's occurrence exists to begin with.
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });

    const result = service.materialize(item.id, { horizonDays: MAX_OCCURRENCES_PER_RUN + 50 });
    // Today's occurrence already existed, so the ceiling is reached one short.
    expect(result.created).toHaveLength(MAX_OCCURRENCES_PER_RUN - 1);
    expect(items.occurrencesOf(item.id)).toHaveLength(MAX_OCCURRENCES_PER_RUN);
    expect(result.truncated).toBe(true);
  });

  it('does not report truncation when under the ceiling', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });
    expect(service.materialize(item.id, { horizonDays: 10 }).truncated).toBe(false);
  });

  it('refuses to materialise an item that is not a series', () => {
    const item = newItem();
    expect(() => service.materialize(item.id)).toThrow(/recurring series/);
  });

  it('has a sensible default horizon', () => {
    expect(DEFAULT_HORIZON_DAYS).toBeGreaterThan(0);
    expect(DEFAULT_HORIZON_DAYS).toBeLessThanOrEqual(365);
  });
});

describe('completing an occurrence', () => {
  it('completes it and creates the next one', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });
    const [first] = items.occurrencesOf(item.id);

    const result = service.completeOccurrence(first!.id);

    expect(result.occurrence.container).toBe('done');
    expect(result.occurrence.completedAt).toBeTruthy();
    expect(result.next?.occurrenceDate).toBe('2026-03-03');
    expect(result.next?.container).toBe('next_action');
  });

  it('returns the already-materialised next occurrence rather than duplicating', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 3 });
    const [first] = items.occurrencesOf(item.id);
    const before = items.occurrencesOf(item.id).length;

    const result = service.completeOccurrence(first!.id);

    expect(result.next?.occurrenceDate).toBe('2026-03-03');
    expect(items.occurrencesOf(item.id)).toHaveLength(before);
  });

  it('returns no next occurrence for a finished series', () => {
    const item = newItem();
    service.attachSeries(item.id, {
      rrule: 'DTSTART;TZID=UTC:20260302T000000\nRRULE:FREQ=DAILY;COUNT=1',
      horizonDays: 30,
    });
    const [first] = items.occurrencesOf(item.id);
    expect(service.completeOccurrence(first!.id).next).toBeNull();
  });

  it('completes the occurrence that was completed, not another', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 3 });
    const [, second] = items.occurrencesOf(item.id);
    const result = service.completeOccurrence(second!.id);
    expect(result.occurrence.id).toBe(second!.id);
    expect(result.occurrence.occurrenceDate).toBe('2026-03-03');
  });

  it('refuses to complete an item that is not an occurrence', () => {
    const item = newItem();
    expect(() => service.completeOccurrence(item.id)).toThrow(/recurring occurrence/);
  });
});

describe('detaching a series', () => {
  it('removes every occurrence and the rule', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 5 });
    expect(items.occurrencesOf(item.id).length).toBeGreaterThan(0);

    service.detachSeries(item.id);

    expect(items.occurrencesOf(item.id)).toHaveLength(0);
    expect(items.getById(item.id)?.recurrenceId).toBeNull();
    expect(items.getById(item.id)?.isTemplate).toBe(false);
  });

  it('returns the item to being a normal task', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=DAILY', horizonDays: 3 });
    service.detachSeries(item.id);
    expect(items.listByContainer('next_action').map((i) => i.id)).toEqual([item.id]);
  });

  it('throws for a missing item', () => {
    expect(() => service.detachSeries('nope')).toThrow(/does not exist/);
  });
});

describe('materializeAll', () => {
  it('tops up every series', () => {
    const first = newItem({ title: 'Water the plants' });
    const second = newItem({ title: 'Take out the bins' });
    service.attachSeries(first.id, { rrule: 'FREQ=DAILY', horizonDays: 1 });
    service.attachSeries(second.id, { rrule: 'FREQ=WEEKLY;BYDAY=MO', horizonDays: 1 });

    // Extend each horizon; each gains more than it started with.
    const results = build().materializeAll({ horizonDays: 10 });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.created.length > 0)).toBe(true);
  });

  it('skips items that are not series', () => {
    newItem();
    expect(service.materializeAll({ horizonDays: 5 })).toEqual([]);
  });

  it('reports zero series on an empty database', () => {
    expect(service.materializeAll()).toEqual([]);
  });
});

describe('specFor', () => {
  it('returns the stored rule', () => {
    const item = newItem();
    service.attachSeries(item.id, { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' });
    expect(service.specFor(item.id).rrule).toContain('BYDAY=MO,WE');
  });

  it('throws for an item that is not a series', () => {
    const item = newItem();
    expect(() => service.specFor(item.id)).toThrow(/recurring series/);
  });
});

/** Minimal resolver, sufficient for the unfiltered queries used here. */
function resolver() {
  return {
    expression: (key: string) => key,
    type: () => 'text' as const,
    isCore: () => true,
  };
}
