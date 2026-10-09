/**
 * The GTD containers.
 *
 * Allen's organising step parks every clarified item in one of a small number of
 * named places. Modelling those places explicitly, rather than inferring them
 * from the presence of a date, is what keeps the calendar "sacred": a deadline
 * never promotes an item onto the calendar, and a hard date never quietly turns
 * an item into a date-bound commitment.
 */

import { type IsoDateTime } from '../dates/index.js';

export const CONTAINERS = [
  'inbox',
  'next_action',
  'calendar',
  'waiting',
  'someday',
  'reference',
  'done',
  'trash',
] as const;

export type Container = (typeof CONTAINERS)[number];

export function isContainer(value: unknown): value is Container {
  return typeof value === 'string' && (CONTAINERS as readonly string[]).includes(value);
}

export interface ContainerSpec {
  container: Container;
  label: string;
  description: string;
  /**
   * True for the "ground level" containers that hold concrete next actions.
   * These are the lists a person works from during the day.
   */
  isActionContainer: boolean;
  /** True when the container is a staging area rather than a place of record. */
  isTransient: boolean;
  /** Relative review cadence, used to drive review reminders. */
  reviewCadence: 'daily' | 'weekly' | 'monthly' | 'rarely';
  /**
   * Fields that must be present for an item to legitimately sit here. An item
   * violating these is a bug, and `assertContainerInvariants` reports it.
   */
  requiredFields: readonly ContainerField[];
}

export type ContainerField = 'whenAt' | 'waitingOnPersonId' | 'followUpAt' | 'projectId';

export const CONTAINER_SPECS: Record<Container, ContainerSpec> = {
  inbox: {
    container: 'inbox',
    label: 'Inbox',
    description: 'Captured but not yet clarified. Never a to-do list.',
    isActionContainer: false,
    isTransient: true,
    reviewCadence: 'daily',
    requiredFields: [],
  },
  next_action: {
    container: 'next_action',
    label: 'Next Actions',
    description: 'Concrete physical actions to do as soon as possible.',
    isActionContainer: true,
    isTransient: false,
    reviewCadence: 'daily',
    requiredFields: [],
  },
  calendar: {
    container: 'calendar',
    label: 'Calendar',
    description:
      'The hard landscape. Only commitments bound to a specific date or time belong here.',
    isActionContainer: true,
    isTransient: false,
    reviewCadence: 'daily',
    requiredFields: ['whenAt'],
  },
  waiting: {
    container: 'waiting',
    label: 'Waiting For',
    description: 'Delegated to someone else, with a date to follow up.',
    isActionContainer: true,
    isTransient: false,
    reviewCadence: 'weekly',
    requiredFields: ['waitingOnPersonId', 'followUpAt'],
  },
  someday: {
    container: 'someday',
    label: 'Someday / Maybe',
    description: 'Incubated. No current commitment, reviewed occasionally.',
    isActionContainer: false,
    isTransient: false,
    reviewCadence: 'weekly',
    requiredFields: [],
  },
  reference: {
    container: 'reference',
    label: 'Reference',
    description: 'Not actionable, but worth keeping and retrieving.',
    isActionContainer: false,
    isTransient: false,
    reviewCadence: 'rarely',
    requiredFields: [],
  },
  done: {
    container: 'done',
    label: 'Completed',
    description: 'Finished. Retained for filtering and for the analytics.',
    isActionContainer: false,
    isTransient: false,
    reviewCadence: 'rarely',
    requiredFields: [],
  },
  trash: {
    container: 'trash',
    label: 'Trash',
    description: 'Deliberately discarded. Restorable.',
    isActionContainer: false,
    isTransient: true,
    reviewCadence: 'rarely',
    requiredFields: [],
  },
};

/** Containers that hold concrete actions a person can pick up and do. */
export const ACTION_CONTAINERS: readonly Container[] = CONTAINERS.filter(
  (container) => CONTAINER_SPECS[container].isActionContainer,
);

/**
 * Legal moves between containers.
 *
 * Two of Allen's rules are enforced here rather than left to the UI:
 *
 * - Nothing returns to the inbox once clarified. An item goes there only by
 *   being restored from trash. This is what stops the inbox becoming a second
 *   to-do list, which is the most common way a GTD system quietly rots.
 * - Trash leads nowhere but the inbox, so a deletion cannot masquerade as a
 *   reorganisation.
 *
 * A self-transition is always legal, because editing an item in place is not a
 * move.
 */
const ALLOWED_TRANSITIONS: Record<Container, readonly Container[]> = {
  // Anything clarified can go anywhere. Doing it now lands in `done`.
  inbox: ['next_action', 'calendar', 'waiting', 'someday', 'reference', 'done', 'trash'],
  // The calendar is not a holding pen. Dropping the hard date returns an item
  // to the next-actions pool, but the reverse never happens implicitly.
  next_action: ['calendar', 'waiting', 'someday', 'done', 'trash'],
  calendar: ['next_action', 'waiting', 'done', 'trash'],
  // waiting -> waiting covers raising the follow-up date without changing state.
  waiting: ['next_action', 'calendar', 'someday', 'done', 'trash'],
  someday: ['next_action', 'calendar', 'waiting', 'done', 'trash'],
  reference: ['next_action', 'someday', 'trash'],
  done: ['next_action', 'calendar', 'waiting', 'someday', 'trash'],
  trash: ['inbox'],
};

export function canTransition(from: Container, to: Container): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/** Containers reachable in one step from `from`, excluding `from` itself. */
export function transitionsFrom(from: Container): Container[] {
  return ALLOWED_TRANSITIONS[from].filter((to) => to !== from);
}

export interface TransitionRejection {
  ok: false;
  from: Container;
  to: Container;
  reason: string;
}

export type TransitionCheck = { ok: true } | TransitionRejection;

export function checkTransition(from: Container, to: Container): TransitionCheck {
  if (canTransition(from, to)) {
    return { ok: true };
  }
  return {
    ok: false,
    from,
    to,
    reason:
      from === 'trash'
        ? `Items in Trash can only be restored to the Inbox, not moved to ${CONTAINER_SPECS[to].label}.`
        : `An item cannot move from ${CONTAINER_SPECS[from].label} to ${CONTAINER_SPECS[to].label}.`,
  };
}

/** The subset of an item's fields that container invariants are checked against. */
export interface ContainerSubject {
  container: Container;
  whenAt: IsoDateTime | null;
  waitingOnPersonId: string | null;
  followUpAt: IsoDateTime | null;
  projectId: string | null;
}

export interface InvariantViolation {
  container: Container;
  field: ContainerField;
  message: string;
}

const FIELD_LABELS: Record<ContainerField, string> = {
  whenAt: 'a date and time',
  waitingOnPersonId: 'a person to wait on',
  followUpAt: 'a follow-up date',
  projectId: 'a project',
};

/**
 * Checks that an item sitting in a container carries the fields that container
 * requires.
 *
 * An item in Waiting For with nobody to wait on is invisible in every useful
 * query, and an item on the calendar with no date cannot appear on the calendar.
 * Both are silent-corruption states, so they are checked explicitly rather than
 * discovered later.
 */
export function assertContainerInvariants(subject: ContainerSubject): InvariantViolation[] {
  const spec = CONTAINER_SPECS[subject.container];
  const violations: InvariantViolation[] = [];

  for (const field of spec.requiredFields) {
    if (!subject[field]) {
      violations.push({
        container: subject.container,
        field,
        message: `An item in ${spec.label} needs ${FIELD_LABELS[field]}.`,
      });
    }
  }

  return violations;
}

/**
 * Infers the container a captured item should land in.
 *
 * Only unambiguous signals are honoured. `whenAt` means the item is a hard
 * commitment; a `deadline` deliberately does not, because a deadline is an
 * aspiration and putting those on the calendar is exactly the dilution Allen
 * warns against.
 */
export function inferContainer(hints: {
  whenAt?: IsoDateTime | null;
  waitingOnPersonId?: string | null;
  completed?: boolean;
  trashed?: boolean;
}): Container {
  if (hints.trashed) return 'trash';
  if (hints.completed) return 'done';
  if (hints.whenAt) return 'calendar';
  if (hints.waitingOnPersonId) return 'waiting';
  return 'next_action';
}

export function containerLabel(container: Container): string {
  return CONTAINER_SPECS[container].label;
}
