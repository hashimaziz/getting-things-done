/**
 * Calendar arithmetic.
 *
 * The one place in this application where dates are easy to get wrong, and where
 * getting them wrong is invisible. A grid that silently starts on a Tuesday looks
 * almost right. A deadline rendered a day early looks like data that says the wrong
 * day.
 *
 * Everything here works in UTC on `YYYY-MM-DD` strings. That is not a claim that
 * nobody is in a timezone — it is that a *calendar day* has no timezone. "The 1st" is
 * the 1st everywhere, and constructing `new Date('2026-03-01')` gives midnight UTC,
 * which is the previous day for anyone west of Greenwich. So dates are split into
 * parts, added as integers, and joined back, never round-tripped through a `Date`.
 *
 * Times of day are a separate matter and are handled by the server, which knows the
 * configured timezone.
 */

export type IsoDate = string;
export type IsoDateTime = string;

const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Days in a month, or null for a month that does not exist. */
export function daysInMonth(year: number, month: number): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number.isNaN(lastDay) ? null : lastDay;
}

/**
 * Adds days.
 *
 * Through a UTC timestamp, which is safe *because* the input is a plain calendar
 * date: `Date.UTC` has no offset to apply, and adding a whole number of days in UTC
 * cannot cross a DST boundary because UTC has none.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parts(date);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;

  // Clamped rather than overflowing. "31 January, one month later" is the end of
  // February, not the 3rd of March: an event on the last day of a month should stay on
  // a month's end when that is what the person meant.
  const lastDay = daysInMonth(targetYear, targetMonth) ?? day;
  return toIsoDate(targetYear, targetMonth, Math.min(day, lastDay));
}

/** Whole days from one date to another. Negative means `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((epoch(to) - epoch(from)) / DAY_MS);
}

function epoch(date: IsoDate): number {
  const { year, month, day } = parts(date);
  return Date.UTC(year, month - 1, day);
}

function parts(date: IsoDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) {
    throw new Error(`Not an ISO calendar date: "${date}"`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toIsoDate(year: number, month: number, day: number): IsoDate {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/** 0 is Sunday, matching `Date.prototype.getDay`. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(epoch(date)).getUTCDay();
}

/** The Sunday (or the configured first day) on or before the date. */
export function startOfWeek(date: IsoDate, weekStartsOn = 1): IsoDate {
  const start = ((weekStartsOn % 7) + 7) % 7;
  const offset = (dayOfWeek(date) - start + 7) % 7;
  return addDays(date, -offset);
}

export function startOfMonth(date: IsoDate): IsoDate {
  const { year, month } = parts(date);
  return toIsoDate(year, month, 1);
}

export function endOfMonth(date: IsoDate): IsoDate {
  const { year, month } = parts(date);
  return toIsoDate(year, month, daysInMonth(year, month) ?? 28);
}

/** The local calendar day for an instant, read from the viewer's own clock. */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type CalendarMode = 'week' | 'month';

export interface CalendarDay {
  date: IsoDate;
  /** False for days shown only to pad the grid to whole weeks. */
  isInRange: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

export interface CalendarRange {
  mode: CalendarMode;
  /** The date the view is centred on. */
  anchor: IsoDate;
  days: CalendarDay[];
  /** Inclusive bounds of what is shown. */
  start: IsoDate;
  end: IsoDate;
}

/**
 * Builds the grid for a week or a month.
 *
 * Month view always shows whole weeks. A month grid that starts on the 1st and ends on
 * the 31st has ragged rows that shift every month, and aligning them means some months
 * have five rows and others six — which is fine, and which is exactly why the week
 * headers line up on the days they are over.
 */
export function buildCalendar(options: {
  mode: CalendarMode;
  anchor: IsoDate;
  weekStartsOn?: number;
  today?: IsoDate;
}): CalendarRange {
  const weekStartsOn = options.weekStartsOn ?? 1;
  const today = options.today ?? todayIso();

  const start =
    options.mode === 'week'
      ? startOfWeek(options.anchor, weekStartsOn)
      : startOfWeek(startOfMonth(options.anchor), weekStartsOn);

  const end =
    options.mode === 'week' ? addDays(start, 6) : endOfCalendarMonth(options.anchor, weekStartsOn);

  const days: CalendarDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    days.push({
      date,
      isInRange: options.mode === 'week' ? true : isInMonth(date, options.anchor),
      isToday: date === today,
      isWeekend: isWeekend(date),
    });
  }

  return { mode: options.mode, anchor: options.anchor, days, start, end };
}

function endOfCalendarMonth(anchor: IsoDate, weekStartsOn: number): IsoDate {
  // Walk forward from the last day of the month until the week is complete, so the
  // last row is never half-empty.
  const last = endOfMonth(anchor);
  const end = startOfWeek(last, weekStartsOn);
  return addDays(end, 6);
}

function isInMonth(date: IsoDate, anchor: IsoDate): boolean {
  const a = parts(anchor);
  const b = parts(date);
  return a.year === b.year && a.month === b.month;
}

function isWeekend(date: IsoDate): boolean {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
}

/** Moves the view by a whole week or month. */
export function shiftAnchor(anchor: IsoDate, mode: CalendarMode, direction: -1 | 1): IsoDate {
  return mode === 'week' ? addDays(anchor, 7 * direction) : addMonths(anchor, direction);
}

/** Whether two anchors show the same grid, for deciding whether to reset selection. */
export function sameView(a: IsoDate, b: IsoDate, mode: CalendarMode): boolean {
  if (mode === 'week') {
    return startOfWeek(a) === startOfWeek(b);
  }
  const left = parts(a);
  const right = parts(b);
  return left.year === right.year && left.month === right.month;
}

export function formatDayNumber(date: IsoDate): string {
  return String(parts(date).day);
}

export function formatMonthYear(date: IsoDate): string {
  const { year, month } = parts(date);
  return `${MONTH_NAMES[month - 1] ?? ''} ${year}`.trim();
}

export function formatWeekRange(start: IsoDate): string {
  const end = addDays(start, 6);
  const startParts = parts(start);
  const endParts = parts(end);
  const startMonth = MONTH_NAMES[startParts.month - 1] ?? '';
  const endMonth = MONTH_NAMES[endParts.month - 1] ?? '';

  /*
   * Written the way a person says it: "9–15 Mar" when both ends are in the same month,
   * "1 – 7 Feb" when they are not. Repeating the month on both sides reads as a typo
   * and makes the range harder to scan than it needs to be.
   */
  if (startParts.month === endParts.month && startParts.year === endParts.year) {
    return `${formatDayNumber(start)}–${formatDayNumber(end)} ${startMonth.slice(0, 3)} ${startParts.year}`;
  }

  if (startParts.year === endParts.year) {
    return `${formatDayNumber(start)} ${startMonth.slice(0, 3)} – ${formatDayNumber(end)} ${endMonth.slice(0, 3)} ${startParts.year}`;
  }

  return `${formatDayNumber(start)} ${startMonth.slice(0, 3)} ${startParts.year} – ${formatDayNumber(end)} ${endMonth.slice(0, 3)} ${endParts.year}`;
}

/** The calendar day an instant falls on, in the viewer's timezone. */
export function localDateOf(instant: IsoDateTime): IsoDate {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** The time of day, in the viewer's timezone. */
export function localTimeOf(instant: IsoDateTime): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
