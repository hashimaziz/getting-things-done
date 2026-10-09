/**
 * Describing a repeating series to a person.
 *
 * The server owns the rule and sends back a description string, so nothing here parses
 * an RRULE. What this module does is decide what to *ask* for and how to present the
 * answer, which is the part that turns "FREQ=WEEKLY;BYDAY=MO,WE" into something a person
 * recognises as their actual commitments.
 */

export interface RecurrencePreset {
  key: string;
  label: string;
}

/** What the person is choosing when they attach a series. */
export interface RecurrenceChoice {
  preset: string;
  /** The first date the series runs. */
  anchorDate: string;
  /** `HH:MM`, or empty for an all-day series. */
  startTime: string;
  /** When the series stops. */
  end: { kind: 'never' } | { kind: 'on'; date: string } | { kind: 'after'; count: number };
  /** How far ahead occurrences are created, in days. */
  horizonDays: number;
}

export function defaultChoice(today: string): RecurrenceChoice {
  return {
    preset: 'weekly',
    anchorDate: today,
    startTime: '',
    end: { kind: 'never' },
    horizonDays: 90,
  };
}

export interface AttachSeriesBody {
  preset: string;
  anchorDate: string;
  timezone?: string;
  startTime?: string;
  until?: string | null;
  count?: number | null;
  horizonDays?: number;
}

/**
 * The request for a choice.
 *
 * `until` and `count` are only sent when they apply, because both mean "stop" and
 * sending both at once is a contradiction the server would have to guess at.
 */
export function buildAttachBody(
  choice: RecurrenceChoice,
  options: { timezone?: string | undefined } = {},
): AttachSeriesBody {
  const body: AttachSeriesBody = {
    preset: choice.preset,
    anchorDate: choice.anchorDate,
    horizonDays: choice.horizonDays,
    ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
  };

  if (choice.startTime !== '') {
    body.startTime = choice.startTime;
  }

  if (choice.end.kind === 'on') {
    body.until = choice.end.date;
  } else if (choice.end.kind === 'after') {
    body.count = choice.end.count;
  }

  return body;
}

/** Whether the choice can be sent, and why not when it cannot. */
export function validateChoice(choice: RecurrenceChoice): string | null {
  if (choice.anchorDate === '') {
    return 'Choose the date the series starts.';
  }

  if (choice.startTime !== '') {
    const match = /^(\d{2}):(\d{2})$/.exec(choice.startTime);
    if (!match) {
      return 'A time of day looks like 09:30.';
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    // 24:00 and 09:99 both pass a naive range check on each half separately.
    if (hour > 23 || minute > 59) {
      return 'A time of day has to be between 00:00 and 23:59.';
    }
  }

  if (choice.end.kind === 'on' && choice.end.date < choice.anchorDate) {
    // A series that ends before it starts produces no occurrences at all, which reads
    // as "the app lost it" rather than as "the dates are the wrong way round".
    return 'A series cannot finish before it starts.';
  }

  if (choice.end.kind === 'after' && choice.end.count < 1) {
    return 'A series has to run at least once.';
  }

  return null;
}

/**
 * How many occurrences a horizon will produce, roughly.
 *
 * Shown before saving so someone can see that "every weekday with a 90-day horizon"
 * means sixty rows. Discovering that afterwards, by scrolling, is how a database ends up
 * with ten thousand future items nobody asked for.
 */
export function estimatedOccurrences(choice: RecurrenceChoice, perDay: number): number {
  const days = Math.max(0, choice.horizonDays);
  const base = days * perDay;

  if (choice.end.kind === 'after') {
    return Math.min(base, choice.end.count);
  }

  if (choice.end.kind === 'on' && choice.end.date >= choice.anchorDate) {
    const span = daysBetweenIso(choice.anchorDate, choice.end.date);
    return Math.min(base, Math.max(1, span + 1) * perDay);
  }

  return base;
}

/** How often a preset fires per day, for the estimate above. */
export function frequencyPerDay(presetKey: string): number {
  switch (presetKey) {
    case 'daily':
      return 1;
    case 'weekdays':
      // Five days in seven. An estimate, and labelled as one.
      return 5 / 7;
    case 'weekly':
    case 'fortnightly':
      return 1 / 7;
    case 'monthly':
    case 'quarterly':
      return 1 / 30;
    case 'yearly':
      return 1 / 365;
    default:
      // "First day of the month" and "last day of the month" both fire once a month.
      return 1 / 30;
  }
}

function daysBetweenIso(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return 0;
  }
  return Math.round((toMs - fromMs) / 86_400_000);
}

/**
 * What the person is committing to, in words.
 *
 * "Every week from 4 March, forever" is understood without knowing what a frequency
 * interval is; "FREQ=WEEKLY;INTERVAL=1" is not, and nobody should have to read it to
 * trust that a thing will keep happening.
 */
export function describeChoice(choice: RecurrenceChoice, presetLabel: string): string {
  const start = choice.anchorDate === '' ? 'a date not chosen yet' : `from ${choice.anchorDate}`;
  const time = choice.startTime === '' ? 'all day' : `at ${choice.startTime}`;

  const end =
    choice.end.kind === 'never'
      ? 'forever'
      : choice.end.kind === 'on'
        ? `until ${choice.end.date}`
        : `${choice.end.count} times`;

  return `${presetLabel}, ${start}, ${time}, ${end}.`;
}

/**
 * How many occurrences are materialised already.
 *
 * The series always has occurrences ready rather than being generated on demand: a
 * repeating item that does not exist until you look for it is not on your list.
 */
export function horizonExplanation(horizonDays: number): string {
  if (horizonDays <= 0) {
    return 'No future occurrences will be created.';
  }
  return `${horizonDays} days of occurrences are created ahead of time, so the series never runs out.`;
}
