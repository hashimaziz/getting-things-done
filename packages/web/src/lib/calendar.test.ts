import { describe, expect, it } from 'vitest';
import {
  DAY_NAMES,
  addDays,
  addMonths,
  buildCalendar,
  daysBetween,
  daysInMonth,
  dayOfWeek,
  endOfMonth,
  formatDayNumber,
  formatMonthYear,
  isIsoDate,
  localDateOf,
  localTimeOf,
  sameView,
  shiftAnchor,
  startOfMonth,
  startOfWeek,
  todayIso,
} from './calendar';

/**
 * Calendar arithmetic.
 *
 * A calendar is the one screen where a date bug is invisible. A grid that starts on a
 * Tuesday still looks like a calendar; a deadline rendered a day early looks like data
 * that says the wrong day. So the arithmetic is tested at the boundaries that produce
 * those failures: month ends, year ends, leap days, and the timezone trap.
 */

describe('validating dates', () => {
  it('recognises a plain calendar day', () => {
    expect(isIsoDate('2026-03-01')).toBe(true);
  });

  it('rejects anything else', () => {
    // Including a full timestamp: a date with a time in it is a different thing, and
    // accepting it would let a UTC instant leak into calendar-day arithmetic.
    expect(isIsoDate('2026-03-01T10:00:00Z')).toBe(false);
    expect(isIsoDate('not a date')).toBe(false);
    expect(isIsoDate(20260301)).toBe(false);
  });
});

describe('adding days', () => {
  it('moves forward', () => {
    expect(addDays('2026-03-01', 1)).toBe('2026-03-02');
  });

  it('moves backward', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('skips the leap day in a common year', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  /*
   * The reason dates are split into parts rather than round-tripped through `new Date`.
   * `new Date('2026-03-01')` is midnight UTC, which in London is the 28th of February
   * at 11pm the night before. Adding a day to that gives the wrong calendar day for
   * anyone west of Greenwich.
   */
  it('is unaffected by the local timezone', () => {
    expect(addDays('2026-03-01', 7)).toBe('2026-03-08');
  });

  it('refuses a malformed date rather than guessing', () => {
    expect(() => addDays('nonsense', 1)).toThrow(/not an iso calendar date/i);
  });
});

describe('adding months', () => {
  it('moves forward', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });

  it('moves backward', () => {
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
  });

  it('crosses a year boundary', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  /*
   * Clamped rather than overflowing. "31 January, one month later" is the end of
   * February, not the 3rd of March: an event on a month's end should stay on a month's
   * end when that is what the person meant.
   */
  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps onto a leap day', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('does not clamp a day that fits', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });

  it('keeps a month end a month end across a year', () => {
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-31');
  });
});

describe('days between', () => {
  it('counts forward', () => {
    expect(daysBetween('2026-03-01', '2026-03-08')).toBe(7);
  });

  it('counts backward as negative', () => {
    expect(daysBetween('2026-03-08', '2026-03-01')).toBe(-7);
  });

  it('is zero for the same day', () => {
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
  });

  it('crosses a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});

describe('days in a month', () => {
  it('knows the lengths', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('rejects a month that does not exist', () => {
    expect(daysInMonth(2026, 13)).toBeNull();
    expect(daysInMonth(2026, 0)).toBeNull();
  });
});

describe('days of the week', () => {
  it('numbers Sunday as zero', () => {
    expect(dayOfWeek('2026-03-01')).toBe(0);
  });

  it('numbers Monday as one', () => {
    expect(dayOfWeek('2026-03-02')).toBe(1);
  });

  it('numbers Saturday as six', () => {
    expect(dayOfWeek('2026-03-07')).toBe(6);
  });
});

describe('the start of a week', () => {
  it('defaults to Monday', () => {
    expect(startOfWeek('2026-03-04')).toBe('2026-03-02');
  });

  it('can start on Sunday', () => {
    // Hard-coding Monday is wrong for the United States, and the first day of the week
    // is a setting for exactly that reason.
    expect(startOfWeek('2026-03-04', 0)).toBe('2026-03-01');
  });

  it('leaves a day that is already the first alone', () => {
    expect(startOfWeek('2026-03-02')).toBe('2026-03-02');
    expect(startOfWeek('2026-03-01', 0)).toBe('2026-03-01');
  });

  it('goes back a whole week for a Sunday with a Monday start', () => {
    expect(startOfWeek('2026-03-01')).toBe('2026-02-23');
  });
});

describe('month boundaries', () => {
  it('starts on the first', () => {
    expect(startOfMonth('2026-03-15')).toBe('2026-03-01');
  });

  it('ends on the last', () => {
    expect(endOfMonth('2026-03-15')).toBe('2026-03-31');
    expect(endOfMonth('2026-02-15')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-15')).toBe('2028-02-29');
  });
});

describe('building a week', () => {
  const range = buildCalendar({ mode: 'week', anchor: '2026-03-04', today: '2026-03-04' });

  it('covers seven days', () => {
    expect(range.days).toHaveLength(7);
  });

  it('starts on the configured first day', () => {
    expect(range.start).toBe('2026-03-02');
    expect(range.end).toBe('2026-03-08');
  });

  it('marks today', () => {
    expect(range.days.filter((day) => day.isToday)).toHaveLength(1);
  });

  it('treats every day as in range', () => {
    expect(range.days.every((day) => day.isInRange)).toBe(true);
  });

  it('marks weekends', () => {
    const weekend = range.days.filter((day) => day.isWeekend).map((day) => day.date);
    expect(weekend).toEqual(['2026-03-07', '2026-03-08']);
  });

  it('honours a Sunday start', () => {
    const sunday = buildCalendar({
      mode: 'week',
      anchor: '2026-03-04',
      weekStartsOn: 0,
      today: '2026-03-04',
    });

    expect(sunday.start).toBe('2026-03-01');
  });
});

describe('building a month', () => {
  it('shows whole weeks so the columns line up', () => {
    // A ragged month grid shifts on every month, and the week headers stop matching the
    // days they sit over.
    expect(
      buildCalendar({ mode: 'month', anchor: '2026-03-15', today: '2026-03-15' }).days.length % 7,
    ).toBe(0);
  });

  it('covers the whole month inside the range', () => {
    const range = buildCalendar({ mode: 'month', anchor: '2026-03-15', today: '2026-03-15' });
    const inRange = range.days.filter((day) => day.isInRange).map((day) => day.date);

    expect(inRange.at(0)).toBe('2026-03-01');
    expect(inRange.at(-1)).toBe('2026-03-31');
  });

  it('pads the ends with days outside the month', () => {
    // Dimmed rather than hidden: hiding them makes the grid jump as you page months.
    const range = buildCalendar({ mode: 'month', anchor: '2026-03-15', today: '2026-03-15' });

    expect(range.days.some((day) => !day.isInRange)).toBe(true);
  });

  it('starts on the configured first day', () => {
    const range = buildCalendar({
      mode: 'month',
      anchor: '2026-03-15',
      weekStartsOn: 0,
      today: '2026-03-15',
    });

    expect(range.start).toBe('2026-03-01');
  });

  it('handles a February that starts on the first day of a week', () => {
    const range = buildCalendar({ mode: 'month', anchor: '2026-02-10', today: '2026-02-10' });

    expect(range.days.filter((day) => day.isInRange)).toHaveLength(28);
  });
});

describe('moving through time', () => {
  it('steps a week by seven days', () => {
    expect(shiftAnchor('2026-03-04', 'week', 1)).toBe('2026-03-11');
    expect(shiftAnchor('2026-03-04', 'week', -1)).toBe('2026-02-25');
  });

  it('steps a month by a month', () => {
    expect(shiftAnchor('2026-03-15', 'month', 1)).toBe('2026-04-15');
    expect(shiftAnchor('2026-03-15', 'month', -1)).toBe('2026-02-15');
  });
});

describe('knowing when the view changed', () => {
  it('treats two days of the same week as the same view', () => {
    expect(sameView('2026-03-02', '2026-03-08', 'week')).toBe(true);
  });

  it('treats different weeks as different views', () => {
    expect(sameView('2026-03-02', '2026-03-09', 'week')).toBe(false);
  });

  it('treats two days of the same month as the same view', () => {
    expect(sameView('2026-03-01', '2026-03-31', 'month')).toBe(true);
  });

  it('treats different months as different views', () => {
    expect(sameView('2026-03-31', '2026-04-01', 'month')).toBe(false);
  });

  it('distinguishes years', () => {
    expect(sameView('2026-03-01', '2027-03-01', 'month')).toBe(false);
  });
});

describe('formatting', () => {
  it('writes a day number', () => {
    expect(formatDayNumber('2026-03-07')).toBe('7');
  });

  it('writes a month and year', () => {
    expect(formatMonthYear('2026-03-15')).toBe('March 2026');
  });

  it('names all seven days', () => {
    expect(DAY_NAMES).toHaveLength(7);
    expect(DAY_NAMES[0]).toBe('Sun');
  });
});

describe('instants in the viewer timezone', () => {
  /*
   * A hard date is an instant, and which calendar day it lands on depends on who is
   * looking. Read from the viewer's own clock rather than from UTC, so a 23:00 event is
   * shown on the day the person is actually living through.
   */
  it('reads the local calendar day of an instant', () => {
    const instant = new Date(2026, 2, 4, 23, 30).toISOString();
    expect(localDateOf(instant)).toBe('2026-03-04');
  });

  it('reads the local time of an instant', () => {
    const instant = new Date(2026, 2, 4, 23, 30).toISOString();
    expect(localTimeOf(instant)).toBe('23:30');
  });

  it('pads the time', () => {
    const instant = new Date(2026, 2, 4, 9, 5).toISOString();
    expect(localTimeOf(instant)).toBe('09:05');
  });

  it('renders nothing for an unparseable instant', () => {
    expect(localDateOf('nonsense')).toBe('');
    expect(localTimeOf('nonsense')).toBe('');
  });
});

describe('today', () => {
  it('is the viewer local date', () => {
    expect(isIsoDate(todayIso())).toBe(true);
    expect(todayIso()).toBe(todayIso(new Date()));
  });
});
