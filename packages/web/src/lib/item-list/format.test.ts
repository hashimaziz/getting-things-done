import { describe, expect, it } from 'vitest';
import {
  cellValue,
  deadlineUrgency,
  daysUntil,
  formatCellValue,
  formatDate,
  formatDateTime,
  formatDuration,
} from './format';
import type { FieldDefinition, Item } from '../types';

/**
 * Cell formatting.
 *
 * The rule worth defending is the date one. `new Date('2026-03-01')` is midnight
 * UTC, which is the previous day anywhere west of Greenwich, so formatting a
 * deadline through it displays a day early. A deadline shown one day early is not a
 * formatting bug; it is a lie about when something is due.
 */

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
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    completedAt: null,
    trashedAt: null,
    ...overrides,
  } as Item;
}

function definition(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    key: 'my_field',
    label: 'My field',
    type: 'text',
    options: { kind: 'none' },
    ...overrides,
  } as FieldDefinition;
}

describe('durations', () => {
  it('leaves short ones alone', () => {
    expect(formatDuration(45)).toBe('45m');
  });

  it('shortens whole hours', () => {
    expect(formatDuration(60)).toBe('1h');
  });

  it('shows both parts when there are both', () => {
    // "90m" is read faster than "1 hour 30 minutes" in a column.
    expect(formatDuration(90)).toBe('1h 30m');
  });

  it('handles a long day', () => {
    expect(formatDuration(600)).toBe('10h');
  });

  it('rounds, because a stored estimate of 29.7 minutes is not a real precision', () => {
    expect(formatDuration(29.7)).toBe('30m');
  });

  it('renders nothing for an absent estimate', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });

  it('renders nothing rather than NaN', () => {
    expect(formatDuration(Number.NaN)).toBe('');
  });
});

describe('dates', () => {
  it('formats a calendar day without shifting it', () => {
    // Midnight UTC would be the previous day for anyone west of Greenwich.
    expect(formatDate('2026-03-01')).toBe('1 Mar');
  });

  it('formats the first and last of a year', () => {
    expect(formatDate('2026-01-01')).toBe('1 Jan');
    expect(formatDate('2026-12-31')).toBe('31 Dec');
  });

  it('ignores a time component', () => {
    expect(formatDate('2026-03-01T23:30:00.000Z')).toBe('1 Mar');
  });

  it('renders nothing for no date', () => {
    expect(formatDate(null)).toBe('');
  });

  it('passes through something unparseable rather than showing NaN', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formats a date and time in the local zone', () => {
    const formatted = formatDateTime('2026-03-01T14:30:00.000Z');

    expect(formatted).toMatch(/1 Mar \d{2}:\d{2}$/);
  });
});

describe('days until', () => {
  it('counts forward', () => {
    expect(daysUntil('2026-03-05', '2026-03-02')).toBe(3);
  });

  it('counts backward', () => {
    expect(daysUntil('2026-02-28', '2026-03-02')).toBe(-2);
  });

  it('is zero for today', () => {
    expect(daysUntil('2026-03-02', '2026-03-02')).toBe(0);
  });

  it('is null with no date', () => {
    expect(daysUntil(null, '2026-03-02')).toBeNull();
  });

  it('crosses a month boundary', () => {
    expect(daysUntil('2026-04-01', '2026-03-30')).toBe(2);
  });
});

describe('deadline urgency', () => {
  const today = '2026-03-02';

  it('calls past deadlines overdue', () => {
    expect(deadlineUrgency('2026-03-01', today)).toBe('overdue');
  });

  it('calls today today', () => {
    expect(deadlineUrgency(today, today)).toBe('today');
  });

  it('calls the next week soon', () => {
    expect(deadlineUrgency('2026-03-07', today)).toBe('soon');
  });

  it('calls anything beyond that later', () => {
    expect(deadlineUrgency('2026-04-01', today)).toBe('later');
  });

  it('has no urgency without a date', () => {
    expect(deadlineUrgency(null, today)).toBe('none');
  });

  /*
   * A column where everything is equally red is a column nobody reads, and the one
   * item that is actually overdue is the reason the column exists.
   */
  it('distinguishes the four cases so styling can escalate', () => {
    expect(deadlineUrgency('2026-01-01', today)).not.toBe(deadlineUrgency('2026-03-20', today));
  });
});

describe('cell values', () => {
  it('reads a core column from the item', () => {
    expect(cellValue(item({ deadlineOn: '2026-03-05' }), 'deadlineOn')).toBe('2026-03-05');
  });

  it('reads a custom column from the resolved values', () => {
    expect(cellValue(item({ values: { my_field: 'hello' } }), 'my_field')).toBe('hello');
  });

  it('is undefined for a column the item does not have', () => {
    expect(cellValue(item(), 'mystery')).toBeUndefined();
  });

  it('reads contexts from the id array', () => {
    expect(cellValue(item({ contextIds: ['c1', 'c2'] }), 'contexts')).toEqual(['c1', 'c2']);
  });
});

describe('rendering values', () => {
  it('renders nothing for an absent value', () => {
    expect(formatCellValue(null, undefined)).toBe('');
    expect(formatCellValue(undefined, undefined)).toBe('');
    expect(formatCellValue('', undefined)).toBe('');
  });

  it('renders a duration using the duration rules', () => {
    expect(formatCellValue(90, definition({ type: 'duration' }))).toBe('1h 30m');
  });

  it('renders a plain number', () => {
    expect(formatCellValue(7, definition({ type: 'number' }))).toBe('7');
  });

  it('renders a boolean as words', () => {
    expect(formatCellValue(true, definition({ type: 'boolean' }))).toBe('Yes');
    expect(formatCellValue(false, definition({ type: 'boolean' }))).toBe('No');
  });

  it('renders a date field as a date', () => {
    expect(formatCellValue('2026-03-01', definition({ type: 'date' }))).toBe('1 Mar');
  });

  /*
   * The stored value is a slug; the label is what the person chose. Showing "high"
   * when they wrote "Urgent" makes the choice field look broken.
   */
  it('renders a choice using its label', () => {
    const priority = definition({
      type: 'priority',
      options: {
        kind: 'choices',
        choices: [
          { value: 'urgent', label: 'Urgent', color: null, order: 0 },
          { value: 'someday', label: 'When there is time', color: null, order: 1 },
        ],
      },
    });

    expect(formatCellValue('urgent', priority)).toBe('Urgent');
  });

  it('falls back to the stored value when the choice is unknown', () => {
    expect(
      formatCellValue(
        'mystery',
        definition({ type: 'select', options: { kind: 'choices', choices: [] } }),
      ),
    ).toBe('mystery');
  });

  it('resolves ids to names for people', () => {
    expect(formatCellValue('p1', definition({ type: 'person' }), { people: { p1: 'Dana' } })).toBe(
      'Dana',
    );
  });

  it('shows an id rather than a blank when the label is missing', () => {
    // A silent blank reads as "no project", which is a different and wrong claim.
    expect(formatCellValue('p1', definition({ type: 'person' }), {})).toBe('p1');
  });

  it('resolves a project reference by key, not only by type', () => {
    // Someone adding a project field calls it "project" or "project_name", not
    // "projectId".
    expect(
      formatCellValue('pr1', definition({ key: 'project_name', type: 'text' }), {
        projects: { pr1: 'Move house' },
      }),
    ).toBe('Move house');
  });

  it('resolves a list of context ids to names', () => {
    expect(
      formatCellValue(['c1', 'c2'], undefined, { contexts: { c1: '@office', c2: '@phone' } }),
    ).toBe('@office, @phone');
  });

  it('renders a checklist as progress', () => {
    const checklist = [
      { id: '1', label: 'One', done: true },
      { id: '2', label: 'Two', done: false },
    ];

    expect(formatCellValue(checklist, definition({ type: 'checklist' }))).toBe('1/2');
  });

  it('renders nothing for an empty list', () => {
    expect(formatCellValue([], undefined)).toBe('');
  });
});
