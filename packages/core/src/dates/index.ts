/**
 * Date and time primitives shared by every package.
 *
 * Two distinct concepts are modelled deliberately, because GTD insists on the
 * difference and blurring it is the most common way a task system rots:
 *
 * - `date`     a calendar day, `YYYY-MM-DD`. Has no time and no offset. "Fix the
 *              leak by Friday" and "the Friday that already happened" are the
 *              same string, so the day is the unit of meaning.
 * - `dateTime` an instant, ISO 8601 UTC. Used for scheduling and for every
 *              created/updated/completed timestamp.
 *
 * A task's hard calendar commitment is a `dateTime` (`when_at`), because
 * "the standup at 09:30" is an instant. Its soft deadline is a `date`, because
 * "by the end of the sprint" is a day. Storing them as the same type is what
 * produces off-by-one-day bugs, so they are not interchangeable here.
 *
 * All functions that need "today" accept an explicit IANA timezone so results
 * are deterministic and testable rather than dependent on the host machine.
 */

import { isValid, parseISO } from 'date-fns';

/** Matches `YYYY-MM-DD`. Shape only; calendar validity is checked separately. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Matches a full ISO 8601 instant with an explicit offset or `Z`.
 *
 * A local date-time without an offset is deliberately rejected: it is ambiguous
 * without a timezone, and ambiguity in stored timestamps is exactly the bug this
 * module exists to prevent.
 */
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Milliseconds in a day. Used for all whole-day arithmetic. */
const DAY_MS = 86_400_000;

/**
 * `en-CA` formats as `YYYY-MM-DD`, which is exactly our on-disk shape.
 *
 * `Intl.DateTimeFormat` is used rather than a date library because `date-fns` v4
 * silently ignores the `timeZone` option on `format` and formats in the host
 * zone instead. That produces silently wrong calendar days for any user whose
 * configured timezone differs from the machine's, which is the exact class of bug
 * this module exists to prevent. `Intl` is also the spec-defined source of truth
 * for IANA zone conversion.
 */
const ISO_DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function isoDateFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = ISO_DATE_FORMATTERS.get(timezone);
  if (cached) {
    return cached;
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new RangeError(`Not a valid IANA timezone: ${timezone}`);
  }
  ISO_DATE_FORMATTERS.set(timezone, formatter);
  return formatter;
}

/** An instant, always serialised as ISO 8601 UTC. */
export type IsoDateTime = string;

/** A calendar day, always serialised as `YYYY-MM-DD`. */
export type IsoDate = string;

/** The current instant as an ISO 8601 UTC string. */
export function nowIso(): IsoDateTime {
  return new Date().toISOString();
}

/** Serialises an instant to ISO 8601 UTC. Throws on an invalid Date. */
export function toIsoDateTime(value: Date): IsoDateTime {
  if (!isValid(value)) {
    throw new RangeError(`Cannot serialise invalid Date: ${String(value)}`);
  }
  return value.toISOString();
}

/** Serialises the calendar day a Date falls on, in the given timezone. */
export function toIsoDate(value: Date, timezone: string): IsoDate {
  if (!isValid(value)) {
    throw new RangeError(`Cannot serialise invalid Date: ${String(value)}`);
  }
  return isoDateFormatter(timezone).format(value);
}

/** Today's calendar day in the given timezone. */
export function todayIso(timezone: string): IsoDate {
  return toIsoDate(new Date(), timezone);
}

/** Parses an ISO 8601 instant. Returns null when unparseable. */
export function parseIsoDateTime(value: string): Date | null {
  if (!ISO_DATE_TIME_PATTERN.test(value)) {
    return null;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

/**
 * Parses a `YYYY-MM-DD` calendar day into a Date at UTC midnight.
 *
 * UTC midnight is used as the carrier because a bare calendar day has no
 * timezone. Callers that need local semantics should compare day strings rather
 * than Date objects.
 */
export function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const parsed = parseISO(`${value}T00:00:00.000Z`);
  return isValid(parsed) ? parsed : null;
}

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value) && parseIsoDate(value) !== null;
}

export function isIsoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === 'string' && parseIsoDateTime(value) !== null;
}

/** True when `value` is a syntactically valid instant at or after `reference`. */
export function isOnOrAfter(value: IsoDateTime, reference: IsoDateTime): boolean {
  const a = parseIsoDateTime(value);
  const b = parseIsoDateTime(reference);
  if (!a || !b) {
    return false;
  }
  return a.getTime() >= b.getTime();
}

/**
 * Whole days from `from` to `to`, negative when `to` is earlier.
 *
 * Both sides are truncated to their UTC calendar day first, so a deadline at
 * 23:00 today against a reference of 09:00 today counts as 0 days, not 1.
 * That truncation is the behaviour users expect from "days until".
 */
export function daysBetween(from: IsoDate, to: IsoDate): number | null {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) {
    return null;
  }
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/** Adds a whole number of days to a calendar day, returning a calendar day. */
export function addDays(day: IsoDate, amount: number): IsoDate {
  const parsed = parseIsoDate(day);
  if (!parsed) {
    throw new RangeError(`Not an ISO date: ${day}`);
  }
  return toIsoDate(new Date(parsed.getTime() + amount * DAY_MS), 'UTC');
}

/** Start of the week containing `day`, honouring the given locale's first day. */
export function startOfWeekIso(day: IsoDate, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1): IsoDate {
  const parsed = parseIsoDate(day);
  if (!parsed) {
    throw new RangeError(`Not an ISO date: ${day}`);
  }
  const dow = parsed.getUTCDay();
  const diff = (dow - weekStartsOn + 7) % 7;
  return addDays(day, -diff);
}

/** Inclusive list of calendar days from `start` to `end`. */
export function eachDayInclusive(start: IsoDate, end: IsoDate): IsoDate[] {
  const total = daysBetween(start, end);
  if (total === null || total < 0) {
    return [];
  }
  const days: IsoDate[] = [];
  for (let i = 0; i <= total; i += 1) {
    days.push(addDays(start, i));
  }
  return days;
}
