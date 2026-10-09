/**
 * Dashboard metrics.
 *
 * Pure functions over item collections. No database, no HTTP, no knowledge of how
 * the caller fetched the rows. That is deliberate: a chart is a view over data, and
 * making the aggregation a pure function means the same numbers come out whether
 * they are rendered by the dashboard, computed by the CLI, or asserted in a test
 * with three hand-built items.
 *
 * These are the questions Allen's own review prompts ask, phrased as aggregates:
 * where is everything sitting, what is overdue, how much is waiting on someone,
 * and is throughput actually moving.
 */

import {
  addDays,
  daysBetween,
  eachDayInclusive,
  toIsoDate,
  todayIso,
  type IsoDate,
} from '../dates/index.js';
import type { Category, Item, Person, Project } from '../entities.js';
import type { FieldDefinition } from '../fields/index.js';

/** A single bar or slice. */
export interface MetricPoint {
  /** Stable machine key, suitable as a React key or a filter value. */
  key: string;
  /** Human label. Falls back to the key when nothing better is known. */
  label: string;
  count: number;
  /** Summed time estimates, in minutes. Only over items that have one. */
  minutes: number;
  /** Items carrying a time estimate, so `minutes / estimated` is meaningful. */
  estimated: number;
}

/** A single point on a time series. */
export interface DailyPoint {
  date: IsoDate;
  count: number;
  minutes: number;
}

/** How to group items for a breakdown. */
export type Grouping =
  | { kind: 'container' }
  | { kind: 'category' }
  | { kind: 'project' }
  | { kind: 'person' }
  | { kind: 'field'; key: string };

/**
 * The lookup tables used to turn keys into labels.
 *
 * Supplied by the caller rather than fetched, which keeps these functions pure.
 * Anything absent falls back to the raw key, which is honest: "unknown" is more
 * useful than a blank row in a chart.
 */
export interface MetricLookups {
  categories?: ReadonlyMap<string, Category>;
  projects?: ReadonlyMap<string, Project>;
  people?: ReadonlyMap<string, Person>;
  definitions?: ReadonlyMap<string, FieldDefinition>;
}

/**
 * The key a grouping produces for an item.
 *
 * `project` and `person` return an empty string rather than null for a missing
 * relationship, because "how much of my work is not tied to a project" and "what
 * is nobody waiting on" are exactly the questions a breakdown should answer.
 * Dropping those items would quietly bias every chart toward the things that are
 * already organised. `field` returns null, since a missing value there is absent
 * data rather than a bucket.
 */
function groupKey(item: Item, grouping: Grouping): string | null {
  switch (grouping.kind) {
    case 'container':
      return item.container;
    case 'category':
      return item.categoryId;
    case 'project':
      return item.projectId ?? '';
    case 'person':
      return item.waitingOnPersonId ?? '';
    case 'field': {
      const value = item.data[grouping.key];
      if (value === null || value === undefined) {
        return null;
      }
      // A multi-valued field contributes one bucket per value, since "how much of
      // my work is tagged urgent" should count every item carrying that tag.
      return Array.isArray(value) ? null : String(value);
    }
  }
}

function labelFor(key: string, grouping: Grouping, lookups: MetricLookups): string {
  switch (grouping.kind) {
    case 'category': {
      const category = lookups.categories?.get(key);
      return category?.name ?? (key === '' ? 'Uncategorised' : key);
    }
    case 'project': {
      const project = lookups.projects?.get(key);
      return project?.name ?? 'No project';
    }
    case 'person': {
      const person = lookups.people?.get(key);
      return person?.name ?? 'Unknown person';
    }
    case 'field': {
      const definition = lookups.definitions?.get(grouping.key);
      if (definition?.options.kind === 'choices') {
        return definition.options.choices.find((choice) => choice.value === key)?.label ?? key;
      }
      return key;
    }
    case 'container':
      return key;
  }
}

/** Items carrying one of several values, for a multi-valued field grouping. */
function multiValues(item: Item, key: string): string[] {
  const value = item.data[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

/**
 * Groups items and totals counts and estimates.
 *
 * Sorted by count descending, then by label, so the result is stable and the
 * largest bar is first. Sorting by key instead would put a category called "ZZZ"
 * above one called "Admin", which reads as meaningless.
 */
export function countBy(
  items: readonly Item[],
  grouping: Grouping,
  lookups: MetricLookups = {},
): MetricPoint[] {
  const buckets = new Map<string, { count: number; minutes: number; estimated: number }>();

  const add = (key: string, item: Item): void => {
    const bucket = buckets.get(key) ?? { count: 0, minutes: 0, estimated: 0 };
    bucket.count += 1;
    if (item.estimateMinutes !== null && item.estimateMinutes > 0) {
      bucket.minutes += item.estimateMinutes;
      bucket.estimated += 1;
    }
    buckets.set(key, bucket);
  };

  for (const item of items) {
    if (grouping.kind === 'field' && Array.isArray(item.data[grouping.key])) {
      for (const value of multiValues(item, grouping.key)) {
        add(value, item);
      }
      continue;
    }
    const key = groupKey(item, grouping);
    if (key !== null) {
      add(key, item);
    }
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, label: labelFor(key, grouping, lookups), ...bucket }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Sums time estimates across items. */
export function sumEstimates(items: readonly Item[]): number {
  return items.reduce(
    (total, item) =>
      total +
      (item.estimateMinutes !== null && item.estimateMinutes > 0 ? item.estimateMinutes : 0),
    0,
  );
}

/**
 * Completions per calendar day across a window.
 *
 * Every day in the window is present, including the empty ones. A line chart with
 * gaps in it renders as a broken line rather than as "nothing happened that day",
 * so zero-filling is the difference between a readable chart and a misleading one.
 */
export function completionsPerDay(
  items: readonly Item[],
  window: { from: IsoDate; to: IsoDate },
): DailyPoint[] {
  const byDate = new Map<IsoDate, { count: number; minutes: number }>();

  for (const item of items) {
    if (item.completedAt === null) {
      continue;
    }
    // The completion date is the calendar day in the caller's timezone, not in UTC.
    // An item completed at 23:30 local belongs to that local day.
    const date = item.completedAt.slice(0, 10);
    if (date < window.from || date > window.to) {
      continue;
    }
    const bucket = byDate.get(date) ?? { count: 0, minutes: 0 };
    bucket.count += 1;
    if (item.estimateMinutes !== null && item.estimateMinutes > 0) {
      bucket.minutes += item.estimateMinutes;
    }
    byDate.set(date, bucket);
  }

  return eachDayInclusive(window.from, window.to).map((date) => ({
    date,
    count: byDate.get(date)?.count ?? 0,
    minutes: byDate.get(date)?.minutes ?? 0,
  }));
}

/** The default throughput window: the last `days` days ending today. */
export function throughputWindow(
  days: number,
  today: IsoDate = todayIso('UTC'),
): {
  from: IsoDate;
  to: IsoDate;
} {
  const span = Math.max(days, 1);
  return { from: addDays(today, -(span - 1)), to: today };
}

/** Buckets for how long open items have been sitting. */
export interface AgingBucket {
  label: string;
  /** Lower bound in days, inclusive. */
  minDays: number;
  /** Upper bound in days, exclusive. Null means unbounded. */
  maxDays: number | null;
  count: number;
}

/**
 * The default ageing bands.
 *
 * The gaps are chosen to match how people actually talk about a backlog: something
 * from last week is "recent", something from last month is "getting old", and
 * something from last quarter needs a decision rather than a nudge.
 */
export const AGING_BUCKETS: ReadonlyArray<{
  label: string;
  minDays: number;
  maxDays: number | null;
}> = [
  { label: 'This week', minDays: 0, maxDays: 7 },
  { label: 'Last month', minDays: 7, maxDays: 30 },
  { label: 'Last quarter', minDays: 30, maxDays: 90 },
  { label: 'Over 3 months', minDays: 90, maxDays: null },
];

/** How long open items have been sitting, in the default bands. */
export function ageingBuckets(
  items: readonly Item[],
  today: IsoDate = todayIso('UTC'),
): AgingBucket[] {
  const open = items.filter((item) => item.container !== 'done' && item.container !== 'trash');

  return AGING_BUCKETS.map((band) => ({
    ...band,
    count: open.filter((item) => {
      const age = daysBetween(item.createdAt.slice(0, 10), today);
      if (age === null) {
        return false;
      }
      return age >= band.minDays && (band.maxDays === null || age < band.maxDays);
    }).length,
  }));
}

/** The overall state of the system, as the dashboard's status panel reports it. */
export interface SystemHealth {
  /** Unclarified items. The single most important number in GTD. */
  inboxBacklog: number;
  /** Age of the oldest unclarified item, or null when the inbox is empty. */
  inboxOldest: IsoDate | null;
  /** Open items past their soft deadline. */
  overdue: number;
  /** Open items due within the warning window. */
  dueSoon: number;
  /** Hard commitments on a given day. */
  scheduledOn: IsoDate;
  scheduledCount: number;
  /** Delegated items outstanding. */
  waiting: number;
  /** Delegated items whose follow-up date has passed. */
  waitingOverdue: number;
  /** The longest a waiting item has been outstanding, in days. */
  waitingOldestDays: number;
  /** Incubated items. */
  someday: number;
  /** Open items with no time estimate, which cannot be planned around. */
  openWithoutEstimate: number;
  /** Total estimate across open items, in minutes. */
  openMinutes: number;
  /** Open items not attached to any project. */
  openWithoutProject: number;
}

export interface HealthOptions {
  today?: IsoDate;
  /** How many days ahead counts as "due soon". */
  dueSoonDays?: number;
  /** The day whose calendar commitments are counted. */
  scheduledDay?: IsoDate;
}

const OPEN_CONTAINERS = new Set(['inbox', 'next_action', 'calendar', 'waiting', 'someday']);

/**
 * A single pass over the items, answering the questions a daily or weekly review
 * actually asks.
 *
 * Computed in one pass rather than one pass per question, because a dashboard
 * panel that runs fourteen full scans over the collection is fourteen times slower
 * for no benefit.
 */
export function assessSystem(items: readonly Item[], options: HealthOptions = {}): SystemHealth {
  const today = options.today ?? todayIso('UTC');
  const dueSoonDays = options.dueSoonDays ?? 7;
  const scheduledDay = options.scheduledDay ?? today;
  const dueSoonLimit = addDays(today, dueSoonDays);

  let inboxBacklog = 0;
  let inboxOldest: IsoDate | null = null;
  let overdue = 0;
  let dueSoon = 0;
  let scheduledCount = 0;
  let waiting = 0;
  let waitingOverdue = 0;
  let waitingOldestDays = 0;
  let someday = 0;
  let openWithoutEstimate = 0;
  let openMinutes = 0;
  let openWithoutProject = 0;

  for (const item of items) {
    if (item.container === 'inbox') {
      inboxBacklog += 1;
      const created = item.createdAt.slice(0, 10) as IsoDate;
      if (inboxOldest === null || created < inboxOldest) {
        inboxOldest = created;
      }
    }

    if (item.container === 'done' || item.container === 'trash') {
      continue;
    }

    // Open, from here on.
    if (OPEN_CONTAINERS.has(item.container)) {
      if (item.projectId === null) {
        openWithoutProject += 1;
      }
      if (item.estimateMinutes !== null && item.estimateMinutes > 0) {
        openMinutes += item.estimateMinutes;
      } else {
        openWithoutEstimate += 1;
      }
    }

    if (item.deadlineOn !== null) {
      if (item.deadlineOn < today) {
        overdue += 1;
      } else if (item.deadlineOn <= dueSoonLimit) {
        dueSoon += 1;
      }
    }

    if (item.whenAt !== null && item.whenAt.slice(0, 10) === scheduledDay) {
      scheduledCount += 1;
    }

    if (item.container === 'waiting') {
      waiting += 1;
      if (item.followUpAt !== null && item.followUpAt.slice(0, 10) < today) {
        waitingOverdue += 1;
      }
      const delegatedSince = daysBetween(item.createdAt.slice(0, 10), today) ?? 0;
      if (delegatedSince > waitingOldestDays) {
        waitingOldestDays = delegatedSince;
      }
    }

    if (item.container === 'someday') {
      someday += 1;
    }
  }

  return {
    inboxBacklog,
    inboxOldest,
    overdue,
    dueSoon,
    scheduledOn: scheduledDay,
    scheduledCount,
    waiting,
    waitingOverdue,
    waitingOldestDays,
    someday,
    openWithoutEstimate,
    openMinutes,
    openWithoutProject,
  };
}

/**
 * Projects with no next action.
 *
 * This is the GTD invariant Allen calls out explicitly: a project with nothing to
 * do is a project that has silently stopped. The ids are returned rather than the
 * projects, so the caller can resolve names against whatever it already holds.
 */
export function projectsWithoutNextAction(
  items: readonly Item[],
  projects: readonly Project[],
): string[] {
  const active = projects.filter((project) => project.status === 'active');
  const withNextAction = new Set(
    items
      .filter(
        (item) =>
          item.projectId !== null && item.container !== 'done' && item.container !== 'trash',
      )
      .map((item) => item.projectId as string),
  );
  return active.filter((project) => !withNextAction.has(project.id)).map((project) => project.id);
}

/** Items completed on each of the last `days` days, newest first. */
export function recentCompletions(items: readonly Item[], days: number, today: IsoDate): Item[] {
  const window = throughputWindow(days, today);
  return items
    .filter((item) => {
      if (item.completedAt === null) {
        return false;
      }
      const date = item.completedAt.slice(0, 10) as IsoDate;
      return date >= window.from && date <= window.to;
    })
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

export { toIsoDate };
