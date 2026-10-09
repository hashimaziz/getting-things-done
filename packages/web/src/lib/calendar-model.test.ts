import { describe, expect, it } from 'vitest';
import {
  buildCalendarModel,
  explainDeadlineOnly,
  isOnCalendar,
  type DayEntry,
} from './calendar-model';
import { buildCalendar } from './calendar';
import type { Item } from './types';

/**
 * Filing items onto calendar days.
 *
 * One rule dominates this file: **deadlines never enter the calendar.** They are shown,
 * in a separate row, dashed — but they are never filed as commitments. The moment they
 * share a cell with hard dates, the calendar stops being the hard landscape and becomes
 * a to-do list, and the person who built it stops trusting it.
 */

const TODAY = '2026-03-04';

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    categoryId: 'c1',
    title: 'Untitled',
    container: 'calendar',
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
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    completedAt: null,
    trashedAt: null,
    ...overrides,
  } as Item;
}

/** An instant on a given local day and time, as the API would return it. */
function at(day: string, hour = 9, minute = 0): string {
  return new Date(`${day}T00:00:00`).setHours(hour, minute, 0, 0) > 0
    ? new Date(new Date(`${day}T00:00:00`).setHours(hour, minute, 0, 0)).toISOString()
    : '';
}

const dates = buildCalendar({ mode: 'week', anchor: TODAY, today: TODAY }).days.map(
  (day) => day.date,
);

function model(items: Item[]) {
  return buildCalendarModel({ dates, items, today: TODAY });
}

function titlesOn(day: CalendarDayModelLike): string[] {
  return day.scheduled.map((entry) => entry.item.title);
}

interface CalendarDayModelLike {
  date: string;
  scheduled: DayEntry[];
  deadlines: DayEntry[];
}

describe('hard dates', () => {
  it('files an item on the day of its hard date', () => {
    const result = model([item({ id: 'i1', title: 'Standup', whenAt: at('2026-03-04', 9, 30) })]);

    expect(
      titlesOn(
        result.days.find((day) => day.date === '2026-03-04') ?? {
          date: '',
          scheduled: [],
          deadlines: [],
        },
      ),
    ).toEqual(['Standup']);
  });

  it('keeps the time of day', () => {
    const result = model([item({ id: 'i1', title: 'Standup', whenAt: at('2026-03-04', 9, 30) })]);
    const entry = result.days.find((day) => day.date === '2026-03-04')?.scheduled.at(0);

    expect(entry?.time).toBe('09:30');
    expect(entry?.isAllDay).toBe(false);
  });

  it('sorts by time within a day', () => {
    const result = model([
      item({ id: 'i1', title: 'Later', whenAt: at('2026-03-04', 17) }),
      item({ id: 'i2', title: 'Earlier', whenAt: at('2026-03-04', 9) }),
    ]);

    expect(
      titlesOn(
        result.days.find((day) => day.date === '2026-03-04') ?? {
          date: '',
          scheduled: [],
          deadlines: [],
        },
      ),
    ).toEqual(['Earlier', 'Later']);
  });

  it('puts an all-day entry first', () => {
    // All-day entries are the container the day is really about, and burying one under
    // a 17:00 meeting hides the day's shape.
    const result = model([
      item({ id: 'i1', title: 'Meeting', whenAt: at('2026-03-04', 17) }),
      item({ id: 'i2', title: 'All day', whenAt: at('2026-03-04', 0) }),
    ]);

    expect(
      titlesOn(
        result.days.find((day) => day.date === '2026-03-04') ?? {
          date: '',
          scheduled: [],
          deadlines: [],
        },
      ),
    ).toEqual(['All day', 'Meeting']);
  });

  it('ignores an item outside the visible range', () => {
    const result = model([item({ id: 'i1', whenAt: at('2026-04-30', 9) })]);

    expect(result.days.flatMap((day) => day.scheduled)).toHaveLength(0);
  });
});

describe('deadlines stay off the calendar', () => {
  /*
   * The whole point of having two date fields. A deadline is a soft promise; putting it
   * on the calendar turns it into a commitment, and Allen's warning about the calendar
   * is that it should hold only hard landscape.
   */
  it('never files a deadline as a scheduled entry', () => {
    const result = model([item({ id: 'i1', title: 'Pay the invoice', deadlineOn: '2026-03-04' })]);

    expect(result.days.flatMap((day) => day.scheduled)).toHaveLength(0);
  });

  it('shows it on its day, separately', () => {
    const result = model([item({ id: 'i1', title: 'Pay the invoice', deadlineOn: '2026-03-04' })]);
    const day = result.days.find((entry) => entry.date === '2026-03-04');

    expect(day?.deadlines.map((entry) => entry.item.title)).toEqual(['Pay the invoice']);
    expect(day?.scheduled).toHaveLength(0);
  });

  it('does not mix the two rows together', () => {
    // One cell with both is how the calendar quietly becomes a to-do list.
    const result = model([
      item({ id: 'i1', title: 'Appointment', whenAt: at('2026-03-04', 9) }),
      item({ id: 'i2', title: 'Deadline', deadlineOn: '2026-03-04' }),
    ]);
    const day = result.days.find((entry) => entry.date === '2026-03-04');

    expect(day?.scheduled).toHaveLength(1);
    expect(day?.deadlines).toHaveLength(1);
  });

  it('collects overdue deadlines outside the range, because they belong to no day shown', () => {
    const result = model([item({ id: 'i1', title: 'Late', deadlineOn: '2026-02-01' })]);

    expect(result.overdue.map((entry) => entry.item.title)).toEqual(['Late']);
    expect(result.overdue.at(0)?.isOverdue).toBe(true);
  });

  it('does not call a future deadline overdue', () => {
    const result = model([item({ id: 'i1', title: 'Soon', deadlineOn: '2026-03-06' })]);

    expect(result.overdue).toHaveLength(0);
  });

  it('sorts overdue deadlines oldest first', () => {
    const result = model([
      item({ id: 'i1', title: 'Newer', deadlineOn: '2026-02-10' }),
      item({ id: 'i2', title: 'Older', deadlineOn: '2026-01-10' }),
    ]);

    expect(result.overdue.map((entry) => entry.item.title)).toEqual(['Older', 'Newer']);
  });

  it('gives an overdue deadline a date outside the shown range', () => {
    const result = model([item({ id: 'i1', deadlineOn: '2026-02-01' })]);

    expect(result.overdue.at(0)?.date).toBe('2026-02-01');
  });
});

describe('items that belong on neither', () => {
  /*
   * An item in the calendar container with no hard date is an invariant violation. The
   * server reports it too, but showing it here means the person sees it where they
   * created it instead of in a review weeks later.
   */
  it('lists a calendar item with no hard date rather than dropping it', () => {
    const result = model([item({ id: 'i1', title: 'Vague commitment' })]);

    expect(result.undated.map((entry) => entry.item.title)).toEqual(['Vague commitment']);
  });

  it('does not treat a plain next action as undated', () => {
    const result = model([item({ id: 'i1', container: 'next_action' })]);

    expect(result.undated).toHaveLength(0);
  });

  it('ignores a completed item', () => {
    const result = model([
      item({
        id: 'i1',
        container: 'done',
        whenAt: at('2026-03-04', 9),
        completedAt: '2026-03-04T10:00:00.000Z',
      }),
    ]);

    expect(result.days.flatMap((day) => day.scheduled)).toHaveLength(0);
  });

  it('ignores a trashed item', () => {
    // History, not a commitment.
    const result = model([item({ id: 'i1', container: 'trash', whenAt: at('2026-03-04', 9) })]);

    expect(result.days.flatMap((day) => day.scheduled)).toHaveLength(0);
  });

  it('ignores an item with neither date', () => {
    const result = model([item({ id: 'i1', container: 'next_action' })]);

    expect(result.days.flatMap((day) => day.scheduled)).toHaveLength(0);
    expect(result.days.flatMap((day) => day.deadlines)).toHaveLength(0);
  });
});

describe('an item with both dates', () => {
  /*
   * The hard date wins, and the deadline is not shown. Two rows for one item would
   * imply two things to do, and it is one thing to do.
   */
  it('is filed once, by its hard date', () => {
    const result = model([
      item({ id: 'i1', title: 'Both', whenAt: at('2026-03-05', 9), deadlineOn: '2026-03-04' }),
    ]);

    expect(result.days.flatMap((day) => day.scheduled)).toHaveLength(1);
    expect(result.days.flatMap((day) => day.deadlines)).toHaveLength(0);
  });
});

describe('answering why something is not on the calendar', () => {
  it('says an item without a hard date is not on it', () => {
    expect(isOnCalendar(item({ id: 'i1', deadlineOn: '2026-03-04' }))).toBe(false);
  });

  it('says an item with a hard date is', () => {
    expect(isOnCalendar(item({ id: 'i1', whenAt: at('2026-03-04', 9) }))).toBe(true);
  });

  it('does not put history on the calendar', () => {
    expect(isOnCalendar(item({ id: 'i1', container: 'done', whenAt: at('2026-03-04', 9) }))).toBe(
      false,
    );
  });

  it('explains the difference in a sentence', () => {
    // Answering "why isn't this here?" where the question is asked is worth more than a
    // legend somewhere else.
    expect(explainDeadlineOnly()).toContain('soft');
    expect(explainDeadlineOnly()).toContain('hard date');
  });
});

describe('an empty range', () => {
  it('produces days with nothing in them', () => {
    const result = model([]);

    expect(result.days).toHaveLength(7);
    expect(
      result.days.every((day) => day.scheduled.length === 0 && day.deadlines.length === 0),
    ).toBe(true);
  });
});
