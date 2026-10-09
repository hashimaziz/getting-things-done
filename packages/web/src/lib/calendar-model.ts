/**
 * Grouping items onto days.
 *
 * Separate from the grid arithmetic because the rules are about meaning, not dates.
 *
 * The one rule that matters most: **deadlines never appear on the calendar.** A
 * deadline is a soft promise; putting it on a calendar turns it into a commitment, and
 * Allen's whole warning about the calendar is that it should hold only hard landscape.
 * A calendar that shows soft dates is a calendar that has quietly become a to-do list
 * again, and the person who built it will stop trusting it.
 */

import { daysBetween, localDateOf, localTimeOf, type IsoDate } from './calendar';
import type { Item } from './types';

export interface DayEntry {
  item: Item;
  /** The local time, for an item that has one. */
  time: string | null;
  /** True for an item with no time on a day with others. */
  isAllDay: boolean;
  /** Overdue relative to today, for a deadline shown in a side column. */
  isOverdue: boolean;
  /** Which date the entry is filed under. */
  date: IsoDate;
}

export interface CalendarDayModel {
  date: IsoDate;
  /** Items with a hard date on this day. */
  scheduled: DayEntry[];
  /** Soft deadlines on this day. Kept separate, and never merged in. */
  deadlines: DayEntry[];
}

export interface CalendarModel {
  days: CalendarDayModel[];
  /** Overdue deadlines, which belong to no day shown. */
  overdue: DayEntry[];
  /** Hard-dated items with no time, listed above the grid. */
  undated: DayEntry[];
}

/**
 * Files items onto days.
 *
 * `undated` is collected rather than dropped: an item in the calendar container with
 * no hard date is an invariant violation, and hiding it makes the violation invisible.
 * Showing it in a list above the grid is the smallest honest response.
 */
export function buildCalendarModel(options: {
  dates: IsoDate[];
  items: Item[];
  today: IsoDate;
}): CalendarModel {
  const { dates, items, today } = options;

  const byDate = new Map<IsoDate, CalendarDayModel>(
    dates.map((date) => [date, { date, scheduled: [], deadlines: [] }]),
  );

  const overdue: DayEntry[] = [];
  const undated: DayEntry[] = [];

  for (const item of items) {
    // A trashed item is history, not a commitment.
    if (item.container === 'trash' || item.container === 'done') {
      continue;
    }

    if (item.whenAt !== null) {
      const date = localDateOf(item.whenAt);
      const day = byDate.get(date);
      const entry: DayEntry = {
        item,
        date,
        time: localTimeOf(item.whenAt),
        // An item with a time is timed. One with only a date is all day, which is a
        // different thing and is rendered differently on purpose.
        isAllDay: localTimeOf(item.whenAt) === '00:00',
        isOverdue: false,
      };

      if (day) {
        day.scheduled.push(entry);
      }
      continue;
    }

    if (item.container === 'calendar' && item.deadlineOn === null) {
      // In the calendar with nothing on it. Not silently dropped.
      undated.push({
        item,
        date: today,
        time: null,
        isAllDay: true,
        isOverdue: false,
      });
      continue;
    }

    if (item.deadlineOn !== null) {
      const entry: DayEntry = {
        item,
        date: item.deadlineOn,
        time: null,
        isAllDay: true,
        isOverdue: daysBetween(today, item.deadlineOn) < 0,
      };

      const day = byDate.get(item.deadlineOn);
      if (day) {
        // Filed separately from the schedule, on purpose. See the note at the top.
        day.deadlines.push(entry);
      } else if (entry.isOverdue) {
        overdue.push(entry);
      }
    }
  }

  for (const day of byDate.values()) {
    day.scheduled.sort(byTimeThenTitle);
    // Deadlines are not scheduled, so they sort by the order they were written rather
    // than pretending to have times.
    day.deadlines.sort(byTitle);
  }

  overdue.sort(byDateThenTitle);

  return { days: [...byDate.values()], overdue, undated };
}

function byTimeThenTitle(a: DayEntry, b: DayEntry): number {
  // All-day entries first: they are the container the day is really about, and putting
  // them after a 17:00 meeting buries them.
  if (a.isAllDay !== b.isAllDay) {
    return a.isAllDay ? -1 : 1;
  }
  if (a.time !== b.time) {
    return (a.time ?? '').localeCompare(b.time ?? '');
  }
  return a.item.title.localeCompare(b.item.title);
}

function byTitle(a: DayEntry, b: DayEntry): number {
  return a.item.title.localeCompare(b.item.title);
}

function byDateThenTitle(a: DayEntry, b: DayEntry): number {
  return a.date.localeCompare(b.date) || a.item.title.localeCompare(b.item.title);
}

/**
 * Whether an item belongs on the calendar at all.
 *
 * A single predicate, used by the list views to explain why something that looks due is
 * not on the grid. Answering "why isn't this here?" in the place the question is asked
 * is worth more than a legend.
 */
export function isOnCalendar(item: Item): boolean {
  if (item.whenAt === null) {
    return false;
  }
  return item.container !== 'trash' && item.container !== 'done';
}

/** The explanation shown beside a deadline that is not on the calendar. */
export function explainDeadlineOnly(): string {
  return 'A deadline is soft, so it is not on the calendar. Add a hard date to put it there.';
}
