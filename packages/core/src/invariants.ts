/**
 * System invariants and review support.
 *
 * Allen's method has a handful of properties that a well-used system drifts away
 * from. They are cheap to state and cheap to check, which means there is no reason
 * to discover them by noticing something is wrong. Each one below corresponds to
 * something he says explicitly:
 *
 * - Every active project has at least one next action, or it has silently stopped.
 * - The inbox is emptied regularly. A stale inbox item is unclarified work, and
 *   unclarified work is work you have not yet decided anything about.
 * - Waiting-for entries carry a follow-up date. One without is one you will never
 *   chase.
 * - The calendar holds only hard commitments, so a calendar item without a date
 *   cannot be shown on the calendar and is invisible.
 *
 * Pure functions over collections, for the same reason the metrics are: a check
 * that needs a database is a check that only runs where the database is.
 */

import { daysBetween, type IsoDate, type IsoDateTime } from './dates/index.js';
import type { Item, Project } from './entities.js';

export type InvariantKind =
  | 'project_without_next_action'
  | 'waiting_without_follow_up'
  | 'calendar_without_date'
  | 'stale_inbox_item'
  | 'completed_without_timestamp'
  | 'open_without_estimate';

export interface SystemViolation {
  kind: InvariantKind;
  /**
   * `error` means the system is internally inconsistent and something is wrong.
   * `warning` means it is coherent but a practice is slipping.
   */
  severity: 'error' | 'warning';
  /** One line explaining what is wrong, in user-facing language. */
  message: string;
  itemIds: string[];
  projectIds: string[];
}

export interface InvariantOptions {
  today?: IsoDate;
  /** Days before an unclarified inbox item counts as stale. */
  staleInboxDays?: number;
}

const MESSAGES: Record<InvariantKind, string> = {
  project_without_next_action:
    'These projects have nothing to do next. A project with no next action has stopped moving.',
  waiting_without_follow_up:
    'These are waiting on someone with no date to follow up, so they will never be chased.',
  calendar_without_date: 'These are on the calendar with no date, so they cannot appear on it.',
  stale_inbox_item: 'These have been sitting in the inbox unclarified for a while.',
  completed_without_timestamp:
    'These are completed but have no completion time, so they are missing from your history.',
  open_without_estimate: 'These are open with no time estimate, so they cannot be planned around.',
};

const SEVERITIES: Record<InvariantKind, 'error' | 'warning'> = {
  // Internal inconsistencies: the row contradicts itself.
  project_without_next_action: 'error',
  waiting_without_follow_up: 'error',
  calendar_without_date: 'error',
  completed_without_timestamp: 'error',
  // Practices slipping.
  stale_inbox_item: 'warning',
  open_without_estimate: 'warning',
};

/**
 * Checks every invariant across the collection.
 *
 * Reported together rather than one at a time, because the point is to see the
 * whole picture during a review. A weekly review that only ever tells you about
 * the first problem is no use.
 */
export function checkInvariants(
  items: readonly Item[],
  projects: readonly Project[],
  options: InvariantOptions = {},
): SystemViolation[] {
  const today = options.today;
  const staleDays = options.staleInboxDays ?? 7;

  const byKind = new Map<InvariantKind, { itemIds: string[]; projectIds: string[] }>();

  const report = (kind: InvariantKind, itemId?: string, projectId?: string): void => {
    const entry = byKind.get(kind) ?? { itemIds: [], projectIds: [] };
    if (itemId !== undefined && !entry.itemIds.includes(itemId)) {
      entry.itemIds.push(itemId);
    }
    if (projectId !== undefined && !entry.projectIds.includes(projectId)) {
      entry.projectIds.push(projectId);
    }
    byKind.set(kind, entry);
  };

  const openItems = items.filter(
    (item) => item.container !== 'done' && item.container !== 'trash' && !item.isTemplate,
  );

  // A project is stalled when nothing open is attached to it.
  const projectsWithWork = new Set(
    openItems.filter((item) => item.projectId !== null).map((item) => item.projectId as string),
  );
  for (const project of projects) {
    if (project.status === 'active' && !projectsWithWork.has(project.id)) {
      report('project_without_next_action', undefined, project.id);
    }
  }

  for (const item of openItems) {
    if (item.container === 'waiting') {
      if (item.waitingOnPersonId === null || item.followUpAt === null) {
        report('waiting_without_follow_up', item.id, item.projectId ?? undefined);
      }
    }

    if (item.container === 'calendar' && item.whenAt === null) {
      report('calendar_without_date', item.id, item.projectId ?? undefined);
    }

    if (item.container === 'inbox') {
      if (today !== undefined) {
        const age = daysBetween(item.createdAt.slice(0, 10), today);
        if (age !== null && age >= staleDays) {
          report('stale_inbox_item', item.id);
        }
      }
    }

    if (item.estimateMinutes === null && item.container === 'next_action') {
      report('open_without_estimate', item.id);
    }
  }

  for (const item of items) {
    if (item.container === 'done' && item.completedAt === null) {
      report('completed_without_timestamp', item.id);
    }
  }

  return (
    [...byKind.entries()]
      .filter(([, entry]) => entry.itemIds.length > 0 || entry.projectIds.length > 0)
      .map(([kind, entry]) => ({
        kind,
        severity: SEVERITIES[kind],
        message: MESSAGES[kind],
        itemIds: entry.itemIds,
        projectIds: entry.projectIds,
      }))
      // Errors first, since they are the ones that mean something is broken.
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  );
}

/** Delegated items grouped by the person they are waiting on. */
export interface WaitingGroup {
  personId: string | null;
  items: Item[];
  /** How many have a follow-up date already past. */
  overdue: number;
  /** Days since the longest-outstanding item was created. */
  oldestDays: number;
}

export interface WaitingGroupOptions {
  today?: IsoDate;
  /** Groups whose oldest item is older than this are flagged as needing attention. */
  staleAfterDays?: number;
  /** False when only groups needing attention should be returned. */
  includeSettled?: boolean;
}

export interface WaitingGroupWithAttention extends WaitingGroup {
  needsAttention: boolean;
}

/**
 * Groups the Waiting For list by person.
 *
 * Grouped rather than flat because the follow-up question is always "what am I
 * waiting on from Dana", and a flat list makes you reconstruct that yourself every
 * time you look at it.
 */
export function groupWaitingByPerson(
  items: readonly Item[],
  options: WaitingGroupOptions = {},
): WaitingGroupWithAttention[] {
  const today = options.today;
  const staleAfter = options.staleAfterDays ?? 7;
  const includeSettled = options.includeSettled ?? true;

  const waiting = items.filter((item) => item.container === 'waiting' && !item.isTemplate);

  const groups = new Map<string, Item[]>();
  for (const item of waiting) {
    // Keyed by person, with a distinct key for the items nobody is waiting on.
    const key = item.waitingOnPersonId ?? '';
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  const result: WaitingGroupWithAttention[] = [];

  for (const [personId, group] of groups) {
    const overdue = group.filter(
      (item) =>
        item.followUpAt !== null && (today === undefined || item.followUpAt.slice(0, 10) < today),
    ).length;

    const oldestDays =
      today === undefined
        ? 0
        : group.reduce(
            (oldest, item) =>
              Math.max(oldest, daysBetween(item.createdAt.slice(0, 10), today) ?? 0),
            0,
          );

    const needsAttention = overdue > 0 || oldestDays >= staleAfter;
    if (!includeSettled && !needsAttention) {
      continue;
    }

    result.push({
      personId: personId === '' ? null : personId,
      items: group.sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? '')),
      overdue,
      oldestDays,
      needsAttention,
    });
  }

  // Needs-attention groups first, then most overdue, then most overdue overall.
  return result.sort(
    (a, b) =>
      Number(b.needsAttention) - Number(a.needsAttention) ||
      b.overdue - a.overdue ||
      b.oldestDays - a.oldestDays,
  );
}

/* ------------------------------------------------------------ weekly review */

/** Which collection a review step draws its work from. */
export type ReviewSource =
  | 'inbox'
  | 'next_actions'
  | 'calendar_past'
  | 'calendar_upcoming'
  | 'waiting'
  | 'projects'
  | 'checklists'
  | 'someday'
  | 'goals';

export interface ReviewStep {
  id: string;
  title: string;
  description: string;
  source: ReviewSource;
  /** The phase this step belongs to, following the official structure. */
  phase: 'get_clear' | 'get_current' | 'get_creative';
}

export const REVIEW_PHASES: ReadonlyArray<{
  id: ReviewStep['phase'];
  title: string;
  description: string;
}> = [
  {
    id: 'get_clear',
    title: 'Get clear',
    description: 'Empty every collection point, and put everything in your head somewhere.',
  },
  {
    id: 'get_current',
    title: 'Get current',
    description: 'Review each list and update it, so it reflects reality as it is now.',
  },
  {
    id: 'get_creative',
    title: 'Get creative',
    description: 'Consider the wider horizon, so this week is not the whole picture.',
  },
];

/**
 * The weekly review, as data.
 *
 * Allen calls this the single critical success factor for the whole system. It is
 * held here rather than in a component so the server and the web client cannot
 * disagree about the order or wording of the steps.
 */
export const WEEKLY_REVIEW_STEPS: readonly ReviewStep[] = [
  {
    id: 'collect_loose_papers',
    title: 'Collect loose papers and materials',
    description: 'Gather receipts, business cards and notes into the inbox.',
    source: 'inbox',
    phase: 'get_clear',
  },
  {
    id: 'process_inbox',
    title: 'Process the inbox to zero',
    description:
      'Clarify everything captured. Emptying the inbox is not the same as finishing it; it means each item now has a decision attached.',
    source: 'inbox',
    phase: 'get_clear',
  },
  {
    id: 'empty_your_head',
    title: 'Empty your head',
    description: 'Anything still in your mind that has no home yet. Capture it now.',
    source: 'inbox',
    phase: 'get_clear',
  },
  {
    id: 'review_next_actions',
    title: 'Review the next actions',
    description: 'Mark off what is done and record anything it implies.',
    source: 'next_actions',
    phase: 'get_current',
  },
  {
    id: 'review_past_calendar',
    title: 'Review the past calendar',
    description: 'Anything from a day already past that is not yet recorded.',
    source: 'calendar_past',
    phase: 'get_current',
  },
  {
    id: 'review_upcoming_calendar',
    title: 'Review the upcoming calendar',
    description: 'The next stretch of commitments, and anything they trigger.',
    source: 'calendar_upcoming',
    phase: 'get_current',
  },
  {
    id: 'review_waiting',
    title: 'Review the waiting-for list',
    description: 'Chase anything that has gone quiet, and record new follow-ups.',
    source: 'waiting',
    phase: 'get_current',
  },
  {
    id: 'review_projects',
    title: 'Review the projects',
    description:
      'Every active project needs at least one next action. Projects that fail this have stopped moving.',
    source: 'projects',
    phase: 'get_current',
  },
  {
    id: 'review_checklists',
    title: 'Review any checklists',
    description: 'Travel, process, recurring routines. Checklists used once are never used again.',
    source: 'checklists',
    phase: 'get_current',
  },
  {
    id: 'review_someday',
    title: 'Review someday / maybe',
    description:
      'Promote anything that has become active, and delete what no longer interests you.',
    source: 'someday',
    phase: 'get_current',
  },
  {
    id: 'review_goals',
    title: 'Review the wider horizon',
    description: 'Goals and areas of focus, so this week is not the whole picture.',
    source: 'goals',
    phase: 'get_creative',
  },
];

export interface ReviewStepProgress {
  step: ReviewStep;
  /** Items the step has to work through. */
  pending: number;
  /** Items it flagged, such as stalled projects. */
  problems: number;
  /** False when there is nothing to do, which is what "done" looks like here. */
  satisfied: boolean;
}

/**
 * How much work each review step has.
 *
 * Only counts, not the items themselves: the web client fetches each collection as
 * it reaches that step, so a review does not pull the entire database to render a
 * progress list.
 */
export function summariseReview(
  items: readonly Item[],
  projects: readonly Project[],
  options: { today?: IsoDate; staleInboxDays?: number } = {},
): ReviewStepProgress[] {
  const today = options.today;
  const staleDays = options.staleInboxDays ?? 7;
  const violations = checkInvariants(items, projects, {
    ...(today ? { today } : {}),
    staleInboxDays: staleDays,
  });

  const countOf = (kind: InvariantKind): number =>
    violations.find((violation) => violation.kind === kind)?.itemIds.length ?? 0;
  const projectViolations =
    violations.find((violation) => violation.kind === 'project_without_next_action')?.projectIds
      .length ?? 0;

  const real = items.filter((item) => !item.isTemplate);
  const open = real.filter((item) => item.container !== 'done' && item.container !== 'trash');
  const inbox = real.filter((item) => item.container === 'inbox');
  const calendar = real.filter((item) => item.container === 'calendar');
  const activeProjects = projects.filter((project) => project.status === 'active');

  return WEEKLY_REVIEW_STEPS.map((step) => {
    let pending = 0;
    let problems = 0;

    switch (step.source) {
      case 'inbox':
        pending = inbox.length;
        problems = countOf('stale_inbox_item');
        break;
      case 'next_actions':
        pending = open.filter((item) => item.container === 'next_action').length;
        problems = countOf('open_without_estimate');
        break;
      case 'calendar_past':
        pending =
          today === undefined
            ? 0
            : calendar.filter((item) => item.whenAt !== null && item.whenAt.slice(0, 10) < today)
                .length;
        problems = countOf('calendar_without_date');
        break;
      case 'calendar_upcoming':
        pending =
          today === undefined
            ? 0
            : calendar.filter((item) => item.whenAt !== null && item.whenAt.slice(0, 10) >= today)
                .length;
        break;
      case 'waiting':
        pending = open.filter((item) => item.container === 'waiting').length;
        problems = countOf('waiting_without_follow_up');
        break;
      case 'projects':
        pending = activeProjects.length;
        problems = projectViolations;
        break;
      case 'checklists':
        pending = 0;
        break;
      case 'someday':
        pending = open.filter((item) => item.container === 'someday').length;
        break;
      case 'goals':
        pending = 0;
        break;
    }

    return { step, pending, problems, satisfied: pending === 0 && problems === 0 };
  });
}

export type { IsoDateTime };
