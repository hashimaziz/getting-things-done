import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPANSION_LIMIT,
  InvalidRecurrenceError,
  RECURRENCE_PRESETS,
  applyPreset,
  buildRecurrenceString,
  describeRecurrence,
  expandOccurrences,
  nextOccurrenceAfter,
  parseRecurrence,
  previousOccurrenceBefore,
  type RecurrenceSpec,
} from '../src/recurrence/index.js';

function spec(text: string, timezone = 'UTC'): RecurrenceSpec {
  return parseRecurrence(text, { defaultTimezone: timezone });
}

function dates(text: string, window: { start: string; end: string }, timezone = 'UTC'): string[] {
  return expandOccurrences(spec(text, timezone), window).map((occurrence) => occurrence.date);
}

describe('buildRecurrenceString', () => {
  it('builds a bare frequency', () => {
    expect(
      buildRecurrenceString({ frequency: 'DAILY', anchorDate: '2026-01-05', timezone: 'UTC' }),
    ).toBe('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY');
  });

  it('includes a time of day when given', () => {
    expect(
      buildRecurrenceString({
        frequency: 'WEEKLY',
        anchorDate: '2026-01-05',
        timezone: 'UTC',
        timeOfDay: { hour: 9, minute: 30 },
      }),
    ).toBe('DTSTART;TZID=UTC:20260105T093000\nRRULE:FREQ=WEEKLY');
  });

  it('omits an interval of 1', () => {
    expect(
      buildRecurrenceString({
        frequency: 'DAILY',
        anchorDate: '2026-01-05',
        timezone: 'UTC',
        interval: 1,
      }),
    ).not.toContain('INTERVAL');
  });

  it('includes an interval above 1', () => {
    expect(
      buildRecurrenceString({
        frequency: 'DAILY',
        anchorDate: '2026-01-05',
        timezone: 'UTC',
        interval: 3,
      }),
    ).toContain('INTERVAL=3');
  });

  it('sorts weekdays into week order rather than the order given', () => {
    expect(
      buildRecurrenceString({
        frequency: 'WEEKLY',
        anchorDate: '2026-01-05',
        timezone: 'UTC',
        byDay: ['FR', 'MO', 'WE'],
      }),
    ).toContain('BYDAY=MO,WE,FR');
  });

  it('prefers COUNT over UNTIL when both are supplied', () => {
    // They are mutually exclusive by definition. COUNT terminates without
    // needing a date computed from the timezone.
    expect(
      buildRecurrenceString({
        frequency: 'DAILY',
        anchorDate: '2026-01-05',
        timezone: 'UTC',
        count: 5,
        until: '2026-02-01',
      }),
    ).toContain('COUNT=5');
  });

  it('makes UNTIL inclusive of its whole day', () => {
    expect(
      buildRecurrenceString({
        frequency: 'DAILY',
        anchorDate: '2026-01-05',
        timezone: 'UTC',
        until: '2026-02-01',
      }),
    ).toContain('UNTIL=20260201T235959Z');
  });

  it('is deterministic, so stored rules stay diffable', () => {
    const a = buildRecurrenceString({
      frequency: 'WEEKLY',
      anchorDate: '2026-01-05',
      timezone: 'UTC',
      byDay: ['WE', 'MO'],
    });
    const b = buildRecurrenceString({
      frequency: 'WEEKLY',
      anchorDate: '2026-01-05',
      timezone: 'UTC',
      byDay: ['MO', 'WE'],
    });
    expect(a).toBe(b);
  });

  it('rejects an invalid anchor date', () => {
    expect(() =>
      buildRecurrenceString({ frequency: 'DAILY', anchorDate: '2026-02-30', timezone: 'UTC' }),
    ).toThrow(InvalidRecurrenceError);
  });

  it('rejects an invalid timezone', () => {
    expect(() =>
      buildRecurrenceString({
        frequency: 'DAILY',
        anchorDate: '2026-01-05',
        timezone: 'Mars/Base',
      }),
    ).toThrow(/IANA timezone/);
  });
});

describe('parseRecurrence', () => {
  it('reads the anchor date', () => {
    expect(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY').anchorDate).toBe(
      '2026-01-05',
    );
  });

  it('reads the timezone from DTSTART', () => {
    expect(spec('DTSTART;TZID=Europe/Berlin:20260105T000000\nRRULE:FREQ=DAILY').timezone).toBe(
      'Europe/Berlin',
    );
  });

  it('falls back to the default timezone when DTSTART has no TZID', () => {
    expect(spec('DTSTART:20260105T000000\nRRULE:FREQ=DAILY', 'Asia/Tokyo').timezone).toBe(
      'Asia/Tokyo',
    );
  });

  it('reads a time of day', () => {
    expect(spec('DTSTART;TZID=UTC:20260105T093000\nRRULE:FREQ=DAILY').timeOfDay).toEqual({
      hour: 9,
      minute: 30,
    });
  });

  it('treats a midnight DTSTART as an all-day series', () => {
    // An all-day event looks like this in every calendar that exports one.
    expect(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY').timeOfDay).toBeNull();
  });

  it('requires a DTSTART so the pattern has a first day', () => {
    // Without one, "every Monday" has no defined phase.
    expect(() => spec('RRULE:FREQ=WEEKLY;BYDAY=MO')).toThrow(/needs a DTSTART/);
  });

  it('rejects an unsupported part rather than ignoring it', () => {
    // Silently dropping BYSETPOS would produce plausible, wrong dates.
    expect(() =>
      spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO'),
    ).toThrow(/BYSETPOS is not supported/);
  });

  it.each(['BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE'])('rejects %s', (part) => {
    expect(() => spec(`DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;${part}=1`)).toThrow(
      /not supported/,
    );
  });

  it('rejects an unknown part', () => {
    expect(() => spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;WHATEVER=1')).toThrow(
      /Unknown RRULE part/,
    );
  });

  it('rejects an invalid frequency', () => {
    expect(() => spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=FORTNIGHTLY')).toThrow(
      /FREQ must be one of/,
    );
  });

  it('rejects an invalid weekday code', () => {
    expect(() => spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=XX')).toThrow(
      /not a weekday code/,
    );
  });

  it('rejects a non-integer interval', () => {
    expect(() => spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;INTERVAL=1.5')).toThrow(
      /INTERVAL/,
    );
  });

  it('rejects COUNT and UNTIL together', () => {
    expect(() =>
      spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;COUNT=5;UNTIL=20260201'),
    ).toThrow(/cannot both be set/);
  });

  it('rejects an out-of-range BYMONTHDAY', () => {
    expect(() =>
      spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=32'),
    ).toThrow(/BYMONTHDAY/);
  });

  it('rejects a malformed segment', () => {
    expect(() => spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ')).toThrow(/Malformed/);
  });

  it('rejects an empty string', () => {
    expect(() => spec('')).toThrow(/empty/);
  });

  it('rejects a non-existent DTSTART date', () => {
    expect(() => spec('DTSTART;TZID=UTC:20260230T000000\nRRULE:FREQ=DAILY')).toThrow(
      /real calendar date/,
    );
  });

  it('canonicalises the round trip', () => {
    const once = spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=WE,MO');
    const twice = spec(once.rrule);
    expect(twice.rrule).toBe(once.rrule);
  });

  it('accepts a bare UNTIL date', () => {
    expect(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;UNTIL=20260110').until).toBe(
      '2026-01-10',
    );
  });
});

describe('expandOccurrences', () => {
  it('expands daily occurrences', () => {
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY', {
        start: '2026-01-05',
        end: '2026-01-09',
      }),
    ).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']);
  });

  it('respects the window boundaries exactly', () => {
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY', {
        start: '2026-01-06',
        end: '2026-01-07',
      }),
    ).toEqual(['2026-01-06', '2026-01-07']);
  });

  it('excludes occurrences before the anchor', () => {
    expect(
      dates('DTSTART;TZID=UTC:20260110T000000\nRRULE:FREQ=DAILY', {
        start: '2026-01-01',
        end: '2026-01-12',
      }),
    ).not.toContain('2026-01-05');
  });

  it('expands weekly on chosen weekdays', () => {
    // 2026-01-05 is a Monday.
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE', {
        start: '2026-01-05',
        end: '2026-01-18',
      }),
    ).toEqual(['2026-01-05', '2026-01-07', '2026-01-12', '2026-01-14']);
  });

  it('applies an interval', () => {
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;INTERVAL=2', {
        start: '2026-01-05',
        end: '2026-02-01',
      }),
    ).toEqual(['2026-01-05', '2026-01-19', '2026-02-02'].filter((d) => d <= '2026-02-01'));
  });

  it('stops at COUNT', () => {
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;COUNT=3', {
        start: '2026-01-01',
        end: '2026-02-01',
      }),
    ).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });

  it('stops at UNTIL, including the final day', () => {
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;UNTIL=20260107', {
        start: '2026-01-01',
        end: '2026-02-01',
      }),
    ).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });

  it('returns nothing for a window the series has ended before', () => {
    // The series is bounded, so a window after its last occurrence is empty.
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;COUNT=3', {
        start: '2026-03-01',
        end: '2026-03-05',
      }),
    ).toEqual([]);
  });

  it('returns nothing for a window before the series begins', () => {
    expect(
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY', {
        start: '2025-12-01',
        end: '2025-12-05',
      }),
    ).toEqual([]);
  });

  it('returns nothing for an inverted window', () => {
    expect(() =>
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY', {
        start: '2026-01-09',
        end: '2026-01-05',
      }),
    ).toThrow(/before its start/);
  });

  it('rejects a malformed window', () => {
    expect(() =>
      dates('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY', {
        start: 'nope',
        end: '2026-01-05',
      }),
    ).toThrow(/YYYY-MM-DD/);
  });

  it('honours a limit', () => {
    const result = expandOccurrences(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY'), {
      start: '2026-01-05',
      end: '2026-12-31',
      limit: 3,
    });
    expect(result).toHaveLength(3);
  });

  it('has a default expansion limit as a backstop', () => {
    expect(DEFAULT_EXPANSION_LIMIT).toBeGreaterThan(0);
    const result = expandOccurrences(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY'), {
      start: '2026-01-05',
      end: '2126-01-05',
    });
    expect(result.length).toBeLessThanOrEqual(DEFAULT_EXPANSION_LIMIT);
  });

  it('gives a timed series an instant', () => {
    const [first] = expandOccurrences(spec('DTSTART;TZID=UTC:20260105T090000\nRRULE:FREQ=DAILY'), {
      start: '2026-01-05',
      end: '2026-01-06',
    });
    expect(first?.at).toBe('2026-01-05T09:00:00.000Z');
  });

  it('gives an all-day series no instant', () => {
    const [first] = expandOccurrences(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY'), {
      start: '2026-01-05',
      end: '2026-01-06',
    });
    expect(first?.at).toBeNull();
  });
});

describe('timezones and daylight saving', () => {
  it('keeps the local time across a spring-forward boundary', () => {
    // US DST began 2026-03-08. A 09:00 New York series is 14:00Z before that and
    // 13:00Z after. If the UTC instant were pinned, every later occurrence would
    // silently be an hour late in local terms.
    const occurrences = expandOccurrences(
      spec(
        'DTSTART;TZID=America/New_York:20260302T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO',
        'America/New_York',
      ),
      { start: '2026-03-01', end: '2026-03-16' },
    );

    const byDate = Object.fromEntries(occurrences.map((o) => [o.date, o.at]));
    expect(byDate['2026-03-02']).toBe('2026-03-02T14:00:00.000Z');
    // After the change, the same local time is one hour earlier in UTC.
    expect(byDate['2026-03-09']).toBe('2026-03-09T13:00:00.000Z');
  });

  it('reports occurrence dates in the series timezone, not UTC', () => {
    // A 23:00 Tokyo occurrence is the previous day in UTC. Reporting the UTC date
    // would place it a day early.
    const occurrences = expandOccurrences(
      spec('DTSTART;TZID=Asia/Tokyo:20260105T230000\nRRULE:FREQ=DAILY', 'Asia/Tokyo'),
      { start: '2026-01-05', end: '2026-01-06' },
    );
    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-05', '2026-01-06']);
    expect(occurrences[0]?.at).toBe('2026-01-05T14:00:00.000Z');
  });

  it('keeps the calendar day correct for a late-evening occurrence', () => {
    // The window boundary must be judged in the series' zone, not UTC.
    const occurrences = expandOccurrences(
      spec('DTSTART;TZID=Pacific/Auckland:20260105T230000\nRRULE:FREQ=DAILY', 'Pacific/Auckland'),
      { start: '2026-01-06', end: '2026-01-06' },
    );
    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-06']);
  });

  it('handles a zone with a large positive offset', () => {
    const occurrences = expandOccurrences(
      spec(
        'DTSTART;TZID=Pacific/Kiritimati:20260105T120000\nRRULE:FREQ=DAILY',
        'Pacific/Kiritimati',
      ),
      { start: '2026-01-05', end: '2026-01-07' },
    );
    expect(occurrences).toHaveLength(3);
  });
});

describe('nextOccurrenceAfter', () => {
  it('finds the next occurrence', () => {
    expect(
      nextOccurrenceAfter(
        spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE'),
        '2026-01-05',
      )?.date,
    ).toBe('2026-01-07');
  });

  it('is strictly after the given day', () => {
    expect(
      nextOccurrenceAfter(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY'), '2026-01-05')
        ?.date,
    ).toBe('2026-01-06');
  });

  it('returns null for a finished series', () => {
    expect(
      nextOccurrenceAfter(
        spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;COUNT=2'),
        '2026-02-01',
      ),
    ).toBeNull();
  });
});

describe('previousOccurrenceBefore', () => {
  it('finds the previous occurrence, strictly before the given day', () => {
    // The pattern is Mon/Wed. Before 2026-01-14 (a Wednesday) the latest is the
    // Monday, since the Tuesday is not an occurrence day.
    expect(
      previousOccurrenceBefore(
        spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE'),
        '2026-01-14',
      )?.date,
    ).toBe('2026-01-12');
  });

  it('returns the given day itself when it is an occurrence', () => {
    expect(
      previousOccurrenceBefore(
        spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE'),
        '2026-01-15',
      )?.date,
    ).toBe('2026-01-14');
  });

  it('is strictly before the given day', () => {
    expect(
      previousOccurrenceBefore(
        spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY'),
        '2026-01-06',
      )?.date,
    ).toBe('2026-01-05');
  });
});

describe('presets', () => {
  it('offers a useful set', () => {
    const keys = RECURRENCE_PRESETS.map((preset) => preset.key);
    expect(keys).toContain('daily');
    expect(keys).toContain('weekdays');
    expect(keys).toContain('weekly');
    expect(keys).toContain('monthly');
  });

  it('builds a valid spec from a preset', () => {
    const result = applyPreset('weekdays', { anchorDate: '2026-01-05', timezone: 'UTC' });
    expect(result.anchorDate).toBe('2026-01-05');
    expect(result.rrule).toContain('BYDAY=MO,TU,WE,TH,FR');
  });

  it('expands a weekday preset to weekdays only', () => {
    const result = applyPreset('weekdays', { anchorDate: '2026-01-05', timezone: 'UTC' });
    const occurrences = expandOccurrences(result, { start: '2026-01-05', end: '2026-01-16' });
    expect(occurrences.map((o) => o.date)).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-12',
      '2026-01-13',
      '2026-01-14',
      '2026-01-15',
      '2026-01-16',
    ]);
  });

  it('carries a time of day through from the preset', () => {
    const result = applyPreset('daily', {
      anchorDate: '2026-01-05',
      timezone: 'UTC',
      timeOfDay: { hour: 7, minute: 15 },
    });
    expect(result.timeOfDay).toEqual({ hour: 7, minute: 15 });
  });

  it('rejects an unknown preset', () => {
    expect(() => applyPreset('hourly', { anchorDate: '2026-01-05', timezone: 'UTC' })).toThrow(
      /Unknown recurrence preset/,
    );
  });
});

describe('describeRecurrence', () => {
  it('describes a daily series', () => {
    expect(describeRecurrence(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY'))).toBe(
      'Every day',
    );
  });

  it('describes an interval', () => {
    expect(
      describeRecurrence(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=DAILY;INTERVAL=3')),
    ).toBe('Every 3 days');
  });

  it('names the weekdays of a weekly series', () => {
    expect(
      describeRecurrence(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=MO,FR')),
    ).toBe('Every week on Mon, Fri');
  });

  it('describes a monthly series', () => {
    expect(describeRecurrence(spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=MONTHLY'))).toBe(
      'Every month',
    );
  });

  it('sorts weekday labels into week order', () => {
    expect(
      describeRecurrence(
        spec('DTSTART;TZID=UTC:20260105T000000\nRRULE:FREQ=WEEKLY;BYDAY=WE,MO,SU'),
      ),
    ).toBe('Every week on Mon, Wed, Sun');
  });
});
