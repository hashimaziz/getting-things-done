/**
 * Recurrence: parsing, validation and expansion.
 *
 * Recurring items are stored as iCalendar RRULE strings, the same format calendar
 * systems exchange, wrapped behind this module so the rest of the codebase never
 * touches the `rrule` library's types. That keeps the dependency replaceable and
 * means the validation rules live here rather than being implied by whatever the
 * library happens to do with an unrecognised key.
 *
 * Two decisions worth stating up front:
 *
 * - The series' time of day is carried in DTSTART, not in BYHOUR/BYMINUTE. A
 *   series is either all-day or happens at one local time, and expressing that
 *   in DTSTART is what makes "every Monday at 09:00" stay 09:00 across a
 *   daylight-saving change rather than drifting to 10:00.
 * - DTSTART carries a TZID. Occurrences are anchored to a wall-clock time in a
 *   named zone, so the UTC instant of each occurrence shifts when that zone's
 *   offset changes. That is correct behaviour, not drift.
 */

import { RRule } from 'rrule';
import {
  addDays,
  isIsoDate,
  parseIsoDate,
  type IsoDate,
  type IsoDateTime,
} from '../dates/index.js';

export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * RRULE parts this module supports.
 *
 * Anything outside this list is rejected rather than ignored. Silently dropping
 * `BYSETPOS=1` would produce dates that look plausible and are wrong, which is
 * far worse than refusing the rule.
 */
export const SUPPORTED_PARTS = [
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'WKST',
] as const;

export const UNSUPPORTED_PARTS = [
  'BYSETPOS',
  'BYWEEKNO',
  'BYYEARDAY',
  'BYHOUR',
  'BYMINUTE',
  'BYSECOND',
] as const;

export interface TimeOfDay {
  hour: number;
  minute: number;
}

export interface RecurrenceSpec {
  /** Canonical iCalendar text, including a DTSTART with TZID. For storage and display. */
  rrule: string;
  /** IANA zone the wall-clock time is expressed in. */
  timezone: string;
  /** The first day of the series. Matches the date in DTSTART. */
  anchorDate: IsoDate;
  /** Local time of each occurrence, or null for an all-day series. */
  timeOfDay: TimeOfDay | null;
  /** Optional hard stop, as a calendar day in the series' own zone. */
  until: IsoDate | null;
  /** Optional maximum number of occurrences. */
  count: number | null;

  /**
   * The parsed rule, kept alongside the text.
   *
   * Expansion works from this rather than re-parsing `rrule`, because the library
   * that does the calendar arithmetic must be handed explicit parts: see
   * `toFloatingRRule` for why it cannot be given the string.
   */
  frequency: Frequency;
  interval: number;
  byDay: Weekday[];
  byMonthDay: number[];
  byMonth: number[];
  weekStart: Weekday | null;
}

export class InvalidRecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecurrenceError';
  }
}

/* --------------------------------------------------------------- building */

/**
 * Renders a DTSTART line.
 *
 * The time is written without a `Z` and qualified by TZID, which is how iCalendar
 * expresses "09:00 in New York". Writing an instant with `Z` instead would pin it
 * to one UTC offset and break the series at every daylight-saving boundary.
 */
function buildDtstart(anchorDate: IsoDate, time: TimeOfDay | null, timezone: string): string {
  const stamp = time
    ? `${anchorDate.replace(/-/g, '')}T${pad(time.hour)}${pad(time.minute)}00`
    : `${anchorDate.replace(/-/g, '')}T000000`;
  return `DTSTART;TZID=${timezone}:${stamp}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Builds a canonical recurrence string from its parts.
 *
 * Parts are emitted in a fixed order so the same logical rule always produces the
 * same string, which keeps stored rules comparable and diffable.
 */
export function buildRecurrenceString(spec: {
  frequency: Frequency;
  anchorDate: IsoDate;
  timezone: string;
  timeOfDay?: TimeOfDay | null;
  interval?: number | null;
  byDay?: Weekday[];
  byMonthDay?: number[];
  byMonth?: number[];
  weekStart?: Weekday;
  count?: number | null;
  until?: IsoDate | null;
}): string {
  const {
    frequency,
    anchorDate,
    timezone,
    timeOfDay = null,
    interval = null,
    byDay = [],
    byMonthDay = [],
    byMonth = [],
    weekStart,
    count = null,
    until = null,
  } = spec;

  if (!isIsoDate(anchorDate)) {
    throw new InvalidRecurrenceError(`"${anchorDate}" is not a calendar date in YYYY-MM-DD`);
  }
  assertTimezone(timezone);

  const parts: string[] = [`FREQ=${frequency}`];
  if (interval !== null && interval > 1) {
    parts.push(`INTERVAL=${interval}`);
  }
  if (byDay.length > 0) {
    parts.push(`BYDAY=${[...byDay].sort(byWeekdayOrder).join(',')}`);
  }
  if (byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${[...byMonthDay].sort((a, b) => a - b).join(',')}`);
  }
  if (byMonth.length > 0) {
    parts.push(`BYMONTH=${[...byMonth].sort((a, b) => a - b).join(',')}`);
  }
  if (weekStart) {
    parts.push(`WKST=${weekStart}`);
  }
  // COUNT and UNTIL are mutually exclusive by definition. COUNT wins because the
  // series then terminates on its own without needing a date computed from the
  // timezone.
  if (count !== null && count > 0) {
    parts.push(`COUNT=${Math.floor(count)}`);
  } else if (until !== null) {
    if (!isIsoDate(until)) {
      throw new InvalidRecurrenceError(`"${until}" is not a calendar date in YYYY-MM-DD`);
    }
    // UNTIL is inclusive, so an occurrence on that day still counts.
    parts.push(`UNTIL=${until.replace(/-/g, '')}T235959Z`);
  }

  return `${buildDtstart(anchorDate, timeOfDay, timezone)}\nRRULE:${parts.join(';')}`;
}

function byWeekdayOrder(a: Weekday, b: Weekday): number {
  return WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b);
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new InvalidRecurrenceError(`"${timezone}" is not a valid IANA timezone`);
  }
}

/* --------------------------------------------------------------- parsing */

interface ParsedParts {
  [key: string]: string;
}

/**
 * Parses and validates a recurrence string.
 *
 * Accepts a bare `RRULE:` line or a full two-line value with DTSTART. The returned
 * spec is the canonical form, so storing the result makes stored rules stable
 * regardless of how the client spelled them.
 */
export function parseRecurrence(
  input: string,
  options: { defaultTimezone: string },
): RecurrenceSpec {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (lines.length === 0) {
    throw new InvalidRecurrenceError('Recurrence string is empty');
  }
  if (lines.length > 2) {
    throw new InvalidRecurrenceError('Recurrence string must be DTSTART followed by RRULE');
  }

  const dtstartLine = lines.find((line) => line.toUpperCase().startsWith('DTSTART'));
  const rruleLine = lines.find((line) => line.toUpperCase().startsWith('RRULE'));

  if (!rruleLine) {
    throw new InvalidRecurrenceError('Recurrence string is missing its RRULE line');
  }

  const parsed: ParsedParts = {};
  for (const segment of rruleLine.slice('RRULE:'.length).split(';')) {
    if (segment === '') {
      continue;
    }
    const separator = segment.indexOf('=');
    if (separator === -1) {
      throw new InvalidRecurrenceError(`Malformed RRULE segment "${segment}"`);
    }
    const name = segment.slice(0, separator).toUpperCase();
    const value = segment.slice(separator + 1);
    parsed[name] = value;

    if ((UNSUPPORTED_PARTS as readonly string[]).includes(name)) {
      throw new InvalidRecurrenceError(
        `${name} is not supported. Supported parts: ${SUPPORTED_PARTS.join(', ')}`,
      );
    }
    if (!(SUPPORTED_PARTS as readonly string[]).includes(name)) {
      throw new InvalidRecurrenceError(
        `Unknown RRULE part ${name}. Supported parts: ${SUPPORTED_PARTS.join(', ')}`,
      );
    }
  }

  const frequency = parsed.FREQ;
  if (!frequency || !(FREQUENCIES as readonly string[]).includes(frequency)) {
    throw new InvalidRecurrenceError(`FREQ must be one of ${FREQUENCIES.join(', ')}`);
  }

  const interval = parsed.INTERVAL === undefined ? 1 : Number(parsed.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1) {
    throw new InvalidRecurrenceError('INTERVAL must be a whole number of at least 1');
  }

  const byDay = parseWeekdays(parsed.BYDAY);
  const byMonthDay = parseIntegers(parsed.BYMONTHDAY, 'BYMONTHDAY', 1, 31);
  const byMonth = parseIntegers(parsed.BYMONTH, 'BYMONTH', 1, 12);

  const count = parsed.COUNT === undefined ? null : Number(parsed.COUNT);
  if (count !== null && (!Number.isInteger(count) || count < 1)) {
    throw new InvalidRecurrenceError('COUNT must be a whole number of at least 1');
  }
  if (parsed.COUNT !== undefined && parsed.UNTIL !== undefined) {
    throw new InvalidRecurrenceError('COUNT and UNTIL cannot both be set');
  }

  let until: IsoDate | null = null;
  if (parsed.UNTIL !== undefined) {
    until = parseUntil(parsed.UNTIL);
  }

  // DTSTART supplies the timezone and the wall-clock time.
  let timezone = options.defaultTimezone;
  let anchorDate: IsoDate | null = null;
  let timeOfDay: TimeOfDay | null = null;

  if (dtstartLine) {
    const parsedStart = parseDtstart(dtstartLine);
    timezone = parsedStart.timezone ?? options.defaultTimezone;
    anchorDate = parsedStart.date;
    timeOfDay = parsedStart.time;
  }

  if (anchorDate === null) {
    // Without a DTSTART there is no phase to the pattern, so "every Monday"
    // would be undefined. The anchor date is what makes it well-defined.
    throw new InvalidRecurrenceError(
      'Recurrence string needs a DTSTART line so the pattern has a defined first day',
    );
  }

  return {
    rrule: buildRecurrenceString({
      frequency: frequency as Frequency,
      anchorDate,
      timezone,
      timeOfDay,
      interval: interval > 1 ? interval : null,
      byDay,
      byMonthDay,
      byMonth,
      ...(parsed.WKST === undefined ? {} : { weekStart: parsed.WKST as Weekday }),
      count,
      until,
    }),
    timezone,
    anchorDate,
    timeOfDay,
    until,
    count,
    frequency: frequency as Frequency,
    interval,
    byDay,
    byMonthDay,
    byMonth,
    weekStart: parsed.WKST === undefined ? null : (parsed.WKST as Weekday),
  };
}

function parseWeekdays(value: string | undefined): Weekday[] {
  if (value === undefined) {
    return [];
  }
  const entries = value.split(',').map((entry) => entry.toUpperCase().trim());
  for (const entry of entries) {
    if (!(WEEKDAYS as readonly string[]).includes(entry)) {
      throw new InvalidRecurrenceError(`"${entry}" is not a weekday code (MO, TU, WE, ...)`);
    }
  }
  return entries as Weekday[];
}

function parseIntegers(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
): number[] {
  if (value === undefined) {
    return [];
  }
  return value.split(',').map((entry) => {
    const parsed = Number(entry.trim());
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new InvalidRecurrenceError(
        `${name} entry "${entry}" must be a whole number ${min}-${max}`,
      );
    }
    return parsed;
  });
}

/** UNTIL may be a bare date or a full UTC stamp. Both yield a calendar day. */
function parseUntil(value: string): IsoDate {
  const trimmed = value.trim();
  const datePart = trimmed.split('T')[0] ?? trimmed;
  const iso =
    datePart.length === 8
      ? `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`
      : datePart;
  if (!isIsoDate(iso)) {
    throw new InvalidRecurrenceError(`UNTIL "${value}" is not a valid end date`);
  }
  return iso;
}

interface ParsedDtstart {
  date: IsoDate;
  time: TimeOfDay | null;
  timezone: string | null;
}

function parseDtstart(line: string): ParsedDtstart {
  const colon = line.indexOf(':');
  if (colon === -1) {
    throw new InvalidRecurrenceError('Malformed DTSTART line, expected DTSTART:YYYYMMDD');
  }
  const parameters = line.slice('DTSTART'.length, colon);
  const value = line.slice(colon + 1);

  const tzMatch = /TZID=([^:;]+)/i.exec(parameters);
  const timezone = tzMatch?.[1] ?? null;
  if (timezone) {
    assertTimezone(timezone);
  }

  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/.exec(value);
  if (!match) {
    throw new InvalidRecurrenceError(`Malformed DTSTART value "${value}"`);
  }

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isIsoDate(date)) {
    throw new InvalidRecurrenceError(`DTSTART "${value}" is not a real calendar date`);
  }

  if (match[4] === undefined) {
    return { date, time: null, timezone };
  }

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) {
    throw new InvalidRecurrenceError(`DTSTART time "${match[4]}:${match[5]}" is out of range`);
  }

  // A DTSTART of exactly midnight is treated as an all-day series, which is what
  // an all-day event looks like in every calendar system that exports one.
  if (hour === 0 && minute === 0) {
    return { date, time: null, timezone };
  }
  return { date, time: { hour, minute }, timezone };
}

/* -------------------------------------------------------------- expansion */

/**
 * Why the timezone conversion is done here rather than by the library.
 *
 * `rrule` is excellent at calendar arithmetic — month lengths, leap years,
 * intervals, weekday selection — but it does not honour `TZID` when parsing a
 * recurrence string. Given `DTSTART;TZID=America/New_York:20260302T090000` it
 * reads the wall-clock time as 09:00 *UTC*, which places a 09:00 New York series
 * an hour out for half the year and does not shift at all across a daylight-saving
 * change. I verified this against the library rather than trusting the spec.
 *
 * So the rule is split in two. The library is handed explicit parts and does the
 * calendar arithmetic in *floating* time, where a wall-clock 09:00 is simply
 * 09:00. Each resulting wall clock is then converted to a real instant here, with
 * `Intl`, which is the spec-defined source of truth for zone conversion.
 */

const FREQ_TO_RRULE: Record<Frequency, number> = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
};

/**
 * Weekday codes to the library's own representation.
 *
 * `rrule` already exposes the right constants, so these are passed through rather
 * than reconstructed: getting the numeric weekday index wrong would shift a series
 * by a day, which is exactly the class of bug this module is guarding against.
 */
const WEEKDAY_TO_RRULE: Record<Weekday, (typeof RRule)['MO']> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** A Date whose UTC fields are being used to carry a *wall-clock* time. */
function floatingDate(wall: WallClock): Date {
  return new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
  );
}

/** Reads a Date's UTC fields back as a wall clock. */
function wallClockOf(date: Date): WallClock {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

/** The wall clock of `instant` as seen in `timezone`. */
function wallClockInZone(instant: Date, timezone: string): WallClock {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // 24:00 is what Intl returns for midnight under hour12: false in some
    // environments, and it is not a valid hour for Date.UTC.
    hourCycle: 'h23',
  }).formatToParts(instant);

  const parts: Record<string, string> = {};
  for (const part of formatted) {
    parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** The UTC offset in effect at `instant` in `timezone`, in milliseconds. */
function zoneOffsetMs(instant: Date, timezone: string): number {
  const wall = wallClockInZone(instant, timezone);
  return floatingDate(wall).getTime() - instant.getTime();
}

/**
 * Converts a wall clock in `timezone` to the instant it actually falls on.
 *
 * Two passes are needed because the first correction can move the answer across a
 * transition, at which point the offset used for the correction is no longer the
 * right one. That is precisely the case that matters: a 02:30 series on the night
 * a zone springs forward.
 *
 * A wall clock that does not exist, because it falls inside a spring-forward gap,
 * resolves to the instant just after the gap. Pushing forward is the conventional
 * choice and matches what calendar systems do with a nonexistent local time.
 */
export function zonedWallClockToInstant(wall: WallClock, timezone: string): Date {
  const naive = floatingDate(wall).getTime();
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    guess = naive - zoneOffsetMs(new Date(guess), timezone);
  }
  return new Date(guess);
}

/**
 * Builds the library rule in floating time.
 *
 * `dtstart` is the anchor wall clock expressed as if it were UTC, and no `tzid`
 * is set, so the library treats every result as a wall clock rather than an
 * instant.
 */
export function toFloatingRRule(spec: RecurrenceSpec): RRule {
  const anchor = parseIsoDate(spec.anchorDate);
  if (!anchor) {
    throw new InvalidRecurrenceError(`"${spec.anchorDate}" is not a calendar date`);
  }

  const dtstart = floatingDate({
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
    hour: spec.timeOfDay?.hour ?? 0,
    minute: spec.timeOfDay?.minute ?? 0,
    second: 0,
  });

  // UNTIL is inclusive and expressed in floating time as the last second of the
  // day, so an occurrence on that day still counts.
  const until =
    spec.until === null
      ? undefined
      : floatingDate({ ...isoToWallClock(spec.until), hour: 23, minute: 59, second: 59 });

  return new RRule({
    freq: FREQ_TO_RRULE[spec.frequency],
    interval: spec.interval,
    dtstart,
    ...(spec.byDay.length > 0 ? { byweekday: spec.byDay.map((day) => WEEKDAY_TO_RRULE[day]) } : {}),
    ...(spec.byMonthDay.length > 0 ? { bymonthday: spec.byMonthDay } : {}),
    ...(spec.byMonth.length > 0 ? { bymonth: spec.byMonth } : {}),
    ...(spec.weekStart === null ? {} : { wkst: WEEKDAY_TO_RRULE[spec.weekStart] }),
    ...(spec.count === null ? {} : { count: spec.count }),
    ...(until === undefined ? {} : { until }),
  });
}

function isoToWallClock(day: IsoDate): Omit<WallClock, 'hour' | 'minute' | 'second'> {
  const parsed = parseIsoDate(day);
  if (!parsed) {
    throw new InvalidRecurrenceError(`"${day}" is not a calendar date`);
  }
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

/** Converts a floating Date, carrying a wall clock, into a real instant. */
function occurrenceFromFloating(floating: Date, spec: RecurrenceSpec): Occurrence {
  const wall = wallClockOf(floating);
  return {
    date: `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`,
    at: spec.timeOfDay === null ? null : zonedWallClockToInstant(wall, spec.timezone).toISOString(),
  };
}

export interface Occurrence {
  /** The calendar day, in the series' own timezone. */
  date: IsoDate;
  /** The instant, or null for an all-day occurrence. */
  at: IsoDateTime | null;
}

export interface ExpansionWindow {
  /** First day to include, as a calendar day in the series' timezone. */
  start: IsoDate;
  /** Last day to include, as a calendar day in the series' timezone. */
  end: IsoDate;
  /** Ceiling on the number of occurrences returned. */
  limit?: number;
}

/**
 * Default ceiling on an expansion.
 *
 * A very permissive rule could otherwise ask for a century of occurrences in one
 * request. The window is the real bound; this is a backstop.
 */
export const DEFAULT_EXPANSION_LIMIT = 500;

function requireWindow(window: ExpansionWindow): void {
  if (!isIsoDate(window.start) || !isIsoDate(window.end)) {
    throw new InvalidRecurrenceError('Expansion window must be a pair of YYYY-MM-DD dates');
  }
  const start = parseIsoDate(window.start);
  const end = parseIsoDate(window.end);
  if (!start || !end) {
    throw new InvalidRecurrenceError('Expansion window must be a pair of YYYY-MM-DD dates');
  }
  if (end.getTime() < start.getTime()) {
    throw new InvalidRecurrenceError('Expansion window end is before its start');
  }
}

/**
 * Expands occurrences falling within a window.
 *
 * The window is in the series' own timezone, which is what makes it correct: an
 * occurrence at 23:00 local on the last day is included, and one that would fall
 * on that local day but a different UTC day is still included.
 *
 * Because the library works in floating wall-clock time, the window bounds need no
 * widening or offset arithmetic: they are simply the same wall clock.
 */
export function expandOccurrences(spec: RecurrenceSpec, window: ExpansionWindow): Occurrence[] {
  const limit = window.limit ?? DEFAULT_EXPANSION_LIMIT;
  if (limit < 1) {
    return [];
  }
  requireWindow(window);

  const rule = toFloatingRRule(spec);

  const from = floatingDate({ ...isoToWallClock(window.start), hour: 0, minute: 0, second: 0 });
  const to = floatingDate({ ...isoToWallClock(window.end), hour: 23, minute: 59, second: 59 });

  const out: Occurrence[] = [];
  for (const floating of rule.between(from, to, true)) {
    const occurrence = occurrenceFromFloating(floating, spec);
    // The window is inclusive on both ends, and floating arithmetic is exact, so
    // this is a belt-and-braces check rather than a correction.
    if (occurrence.date < window.start || occurrence.date > window.end) {
      continue;
    }
    out.push(occurrence);
    if (out.length >= limit) {
      break;
    }
  }

  return out;
}

/**
 * The first occurrence strictly after `after`, or null when the series has ended.
 *
 * Searches forward from the day after `after`, which is what "what is next on this
 * recurring task" needs without materialising the whole series.
 */
export function nextOccurrenceAfter(spec: RecurrenceSpec, after: IsoDate): Occurrence | null {
  const start = addDays(after, 1);
  const occurrences = expandOccurrences(spec, { start, end: addDays(start, 400), limit: 1 });
  return occurrences[0] ?? null;
}

/** The last occurrence strictly before `before`, or null. */
export function previousOccurrenceBefore(spec: RecurrenceSpec, before: IsoDate): Occurrence | null {
  const end = addDays(before, -1);
  const occurrences = expandOccurrences(spec, { start: addDays(end, -400), end });
  return occurrences[occurrences.length - 1] ?? null;
}

/* --------------------------------------------------------------- presets */

export interface RecurrencePreset {
  key: string;
  label: string;
  /** The RRULE part. The anchor date and time are supplied per item. */
  rule: Pick<
    Parameters<typeof buildRecurrenceString>[0],
    'frequency' | 'interval' | 'byDay' | 'byMonthDay' | 'byMonth'
  >;
}

/**
 * Ready-made rules for the recurrence picker.
 *
 * Ordered from most to least frequent, which is the order a person scanning the
 * list is looking for.
 */
export const RECURRENCE_PRESETS: readonly RecurrencePreset[] = [
  { key: 'daily', label: 'Every day', rule: { frequency: 'DAILY' } },
  {
    key: 'weekdays',
    label: 'Every weekday',
    rule: { frequency: 'WEEKLY', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] },
  },
  { key: 'weekly', label: 'Every week', rule: { frequency: 'WEEKLY' } },
  { key: 'fortnightly', label: 'Every 2 weeks', rule: { frequency: 'WEEKLY', interval: 2 } },
  { key: 'monthly', label: 'Every month', rule: { frequency: 'MONTHLY' } },
  { key: 'quarterly', label: 'Every 3 months', rule: { frequency: 'MONTHLY', interval: 3 } },
  { key: 'yearly', label: 'Every year', rule: { frequency: 'YEARLY' } },
  {
    key: 'first_of_month',
    label: 'First day of the month',
    rule: { frequency: 'MONTHLY', byMonthDay: [1] },
  },
  {
    key: 'last_day_of_month',
    label: 'Last day of the month',
    rule: { frequency: 'MONTHLY', byMonthDay: [-1] },
  },
];

/** Builds the recurrence string for a preset applied to a given start. */
export function applyPreset(
  presetKey: string,
  start: {
    anchorDate: IsoDate;
    timezone: string;
    timeOfDay?: TimeOfDay | null;
    until?: IsoDate | null;
    count?: number | null;
  },
): RecurrenceSpec {
  const preset = RECURRENCE_PRESETS.find((candidate) => candidate.key === presetKey);
  if (!preset) {
    throw new InvalidRecurrenceError(`Unknown recurrence preset "${presetKey}"`);
  }
  const rrule = buildRecurrenceString({
    ...preset.rule,
    anchorDate: start.anchorDate,
    timezone: start.timezone,
    timeOfDay: start.timeOfDay ?? null,
    until: start.until ?? null,
    count: start.count ?? null,
  });
  return parseRecurrence(rrule, { defaultTimezone: start.timezone });
}

/** One-line description of a rule, for a list column or a summary line. */
export function describeRecurrence(spec: RecurrenceSpec): string {
  const interval = spec.interval;
  const plural = interval > 1;

  const unit =
    spec.frequency === 'DAILY'
      ? plural
        ? 'days'
        : 'day'
      : spec.frequency === 'WEEKLY'
        ? plural
          ? 'weeks'
          : 'week'
        : spec.frequency === 'MONTHLY'
          ? plural
            ? 'months'
            : 'month'
          : plural
            ? 'years'
            : 'year';

  const every = plural ? `Every ${interval} ` : 'Every ';

  if (spec.frequency === 'WEEKLY' && spec.byDay.length > 0) {
    const names = [...spec.byDay]
      .sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
      .map((day) => WEEKDAY_LABELS[WEEKDAYS.indexOf(day)] ?? '?')
      .join(', ');
    return `${every}${unit} on ${names}`;
  }

  return `${every}${unit}`;
}

const WEEKDAY_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
