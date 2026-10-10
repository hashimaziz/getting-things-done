import { describe, expect, it } from 'vitest';
import {
  buildAttachBody,
  defaultChoice,
  describeChoice,
  estimatedOccurrences,
  frequencyPerDay,
  horizonExplanation,
  validateChoice,
  type RecurrenceChoice,
} from '@/lib/recurrence';

/**
 * Describing a series.
 *
 * The screen's job is to say what is about to happen before it happens. A raw ISO date
 * in that sentence defeats the purpose — "from 2026-10-09" is read as a serial number,
 * not a Thursday — so the formatting is worth asserting on rather than trusting.
 */

function choice(overrides: Partial<RecurrenceChoice> = {}): RecurrenceChoice {
  return { ...defaultChoice('2026-10-09'), ...overrides };
}

describe('defaultChoice', () => {
  it('starts weekly, from today, with no time and no end', () => {
    expect(defaultChoice('2026-10-09')).toEqual({
      preset: 'weekly',
      anchorDate: '2026-10-09',
      startTime: '',
      end: { kind: 'never' },
      horizonDays: 90,
    });
  });
});

describe('describeChoice', () => {
  it('says the frequency, the first day, and that it never stops', () => {
    expect(describeChoice(choice(), 'Every week')).toBe(
      'Every week, from 9 Oct, all day, forever.',
    );
  });

  it('says the time when one is given', () => {
    expect(describeChoice(choice({ startTime: '09:00' }), 'Every week')).toContain('at 09:00');
  });

  it('names the last day when the series ends on one', () => {
    expect(describeChoice(choice({ end: { kind: 'on', date: '2026-12-24' } }), 'Every week')).toBe(
      'Every week, from 9 Oct, all day, until 24 Dec.',
    );
  });

  it('names the count when the series ends after a number of times', () => {
    expect(describeChoice(choice({ end: { kind: 'after', count: 12 } }), 'Every week')).toContain(
      '12 times',
    );
  });

  it('adds the year only where it disambiguates', () => {
    // Same year as the start: repeating "2026" on both ends is noise.
    expect(
      describeChoice(choice({ end: { kind: 'on', date: '2026-11-02' } }), 'Every week'),
    ).toContain('until 2 Nov');

    // A different year is the whole point of the end date.
    expect(describeChoice(choice({ end: { kind: 'on', date: '2027-01-04' } }), 'Every week')).toBe(
      'Every week, from 9 Oct, all day, until 4 Jan 2027.',
    );
  });

  it('admits when the date has not been chosen yet', () => {
    expect(describeChoice(choice({ anchorDate: '' }), 'Every week')).toContain(
      'a date not chosen yet',
    );
  });
});

describe('buildAttachBody', () => {
  it('sends only the fields that apply', () => {
    expect(buildAttachBody(choice())).toEqual({
      preset: 'weekly',
      anchorDate: '2026-10-09',
      horizonDays: 90,
    });
  });

  it('sends the timezone when it is known', () => {
    expect(buildAttachBody(choice(), { timezone: 'Europe/London' })['timezone']).toBe(
      'Europe/London',
    );
  });

  it('never sends both ways of stopping', () => {
    const onDate = buildAttachBody(choice({ end: { kind: 'on', date: '2026-12-24' } }));
    expect(onDate['until']).toBe('2026-12-24');
    expect(onDate['count']).toBeUndefined();

    const afterCount = buildAttachBody(choice({ end: { kind: 'after', count: 5 } }));
    expect(afterCount['count']).toBe(5);
    expect(afterCount['until']).toBeUndefined();
  });

  it('sends a start time only when one was given', () => {
    expect(buildAttachBody(choice())['startTime']).toBeUndefined();
    expect(buildAttachBody(choice({ startTime: '09:00' }))['startTime']).toBe('09:00');
  });
});

describe('validateChoice', () => {
  it('accepts the default', () => {
    expect(validateChoice(choice())).toBeNull();
  });

  it('refuses without an anchor date', () => {
    expect(validateChoice(choice({ anchorDate: '' }))).not.toBeNull();
  });

  it('refuses an end date before the start', () => {
    expect(validateChoice(choice({ end: { kind: 'on', date: '2026-01-01' } }))).not.toBeNull();
  });

  it('refuses a count of zero', () => {
    expect(validateChoice(choice({ end: { kind: 'after', count: 0 } }))).not.toBeNull();
  });
});

describe('estimatedOccurrences', () => {
  it('is the frequency times the horizon', () => {
    expect(estimatedOccurrences(choice({ preset: 'daily' }), frequencyPerDay('daily'))).toBe(90);
    expect(estimatedOccurrences(choice(), frequencyPerDay('weekly'))).toBe(13);
  });

  it('never overstates what a count limit will allow', () => {
    expect(
      estimatedOccurrences(choice({ preset: 'daily', end: { kind: 'after', count: 4 } }), 1),
    ).toBe(4);
    // A count larger than the horizon is bounded by the horizon, not the other way round.
    expect(
      estimatedOccurrences(
        choice({ preset: 'daily', horizonDays: 10, end: { kind: 'after', count: 400 } }),
        1,
      ),
    ).toBe(10);
  });

  it('stops at an end date inside the horizon', () => {
    expect(
      estimatedOccurrences(choice({ preset: 'daily', end: { kind: 'on', date: '2026-10-12' } }), 1),
    ).toBe(4);
  });

  it('is zero for a horizon of nothing', () => {
    expect(estimatedOccurrences(choice({ horizonDays: 0 }), 1)).toBe(0);
    expect(estimatedOccurrences(choice({ horizonDays: -5 }), 1)).toBe(0);
  });
});

describe('frequencyPerDay', () => {
  it('counts weekdays as five days in seven', () => {
    expect(frequencyPerDay('weekdays')).toBeCloseTo(5 / 7, 10);
  });

  it('assumes monthly for presets it has not heard of', () => {
    // "First day of the month" and "last day of the month" both fire once a month.
    expect(frequencyPerDay('first-of-month')).toBe(1 / 30);
  });
});

describe('horizonExplanation', () => {
  it('says what a horizon of nothing means', () => {
    expect(horizonExplanation(0)).toBe('No future occurrences will be created.');
  });

  it('says why there is a horizon at all', () => {
    expect(horizonExplanation(90)).toContain('never runs out');
  });
});
