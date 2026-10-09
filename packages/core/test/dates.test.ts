import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  eachDayInclusive,
  isIsoDate,
  isIsoDateTime,
  parseIsoDate,
  parseIsoDateTime,
  startOfWeekIso,
  toIsoDate,
} from '../src/dates/index.js';

describe('isIsoDate', () => {
  it.each(['2026-10-08', '2024-02-29', '2000-01-01'])('accepts %s', (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each([
    ['a malformed string', '08-10-2026'],
    ['a datetime', '2026-10-08T10:00:00Z'],
    ['a non-existent day', '2026-02-30'],
    ['a non-existent leap day', '2023-02-29'],
    ['an empty string', ''],
    ['a number', 20261008],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isIsoDate(value)).toBe(false);
  });

  it('accepts a real leap day', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
  });
});

describe('isIsoDateTime', () => {
  it.each([
    '2026-10-08T10:00:00Z',
    '2026-10-08T10:00:00.000Z',
    '2026-10-08T10:00:00+05:30',
    '2026-10-08T10:00Z',
  ])('accepts %s', (value) => {
    expect(isIsoDateTime(value)).toBe(true);
  });

  it.each([
    ['a bare calendar day, which has no offset', '2026-10-08'],
    ['a local datetime with no offset', '2026-10-08T10:00:00'],
    ['a space-separated date with no offset', '2026-10-08 10:00:00'],
    ['a malformed string', 'yesterday'],
  ])('rejects %s', (_label, value) => {
    expect(isIsoDateTime(value)).toBe(false);
  });
});

describe('parseIsoDate', () => {
  it('parses a calendar day at UTC midnight', () => {
    expect(parseIsoDate('2026-10-08')?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('returns null for an invalid day', () => {
    expect(parseIsoDate('2026-13-01')).toBeNull();
  });
});

describe('parseIsoDateTime', () => {
  it('parses an instant with an offset', () => {
    expect(parseIsoDateTime('2026-10-08T10:00:00+05:30')?.toISOString()).toBe(
      '2026-10-08T04:30:00.000Z',
    );
  });

  it('returns null when the offset is missing', () => {
    expect(parseIsoDateTime('2026-10-08T10:00:00')).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('uses the calendar day in the requested timezone', () => {
    // 23:30 UTC is already the next day in Tokyo.
    const instant = new Date('2026-10-08T23:30:00.000Z');
    expect(toIsoDate(instant, 'UTC')).toBe('2026-10-08');
    expect(toIsoDate(instant, 'Asia/Tokyo')).toBe('2026-10-09');
    expect(toIsoDate(instant, 'America/New_York')).toBe('2026-10-08');
  });
});

describe('daysBetween', () => {
  it('counts whole days forwards', () => {
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
  });

  it('counts whole days backwards', () => {
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7);
  });

  it('returns 0 for the same day', () => {
    expect(daysBetween('2026-10-08', '2026-10-08')).toBe(0);
  });

  it('crosses a month boundary', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
  });

  it('crosses a leap day', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('returns null for an invalid endpoint', () => {
    expect(daysBetween('nope', '2026-10-08')).toBeNull();
  });
});

describe('addDays', () => {
  it('adds forwards', () => {
    expect(addDays('2026-10-08', 7)).toBe('2026-10-15');
  });

  it('subtracts for negative amounts', () => {
    expect(addDays('2026-10-08', -8)).toBe('2026-09-30');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('throws on an invalid input', () => {
    expect(() => addDays('not-a-date', 1)).toThrow(RangeError);
  });
});

describe('startOfWeekIso', () => {
  it('finds the Monday of the containing week', () => {
    // 2026-10-08 is a Thursday.
    expect(startOfWeekIso('2026-10-08', 1)).toBe('2026-10-05');
  });

  it('honours a Sunday week start', () => {
    expect(startOfWeekIso('2026-10-08', 0)).toBe('2026-10-04');
  });

  it('returns the same day when it is already the first day', () => {
    expect(startOfWeekIso('2026-10-05', 1)).toBe('2026-10-05');
  });
});

describe('eachDayInclusive', () => {
  it('includes both endpoints', () => {
    expect(eachDayInclusive('2026-10-01', '2026-10-04')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('returns a single day when start equals end', () => {
    expect(eachDayInclusive('2026-10-01', '2026-10-01')).toEqual(['2026-10-01']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(eachDayInclusive('2026-10-04', '2026-10-01')).toEqual([]);
  });
});
