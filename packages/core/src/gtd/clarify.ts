/**
 * The Clarify step, as a pure function.
 *
 * Allen's second workflow step is a decision tree, and it is reproduced here
 * literally rather than approximated. Keeping it pure means the same logic can
 * drive the inbox clarification UI, drive server-side classification of items
 * captured by the CLI, and later serve as the deterministic baseline that an
 * AI recommendation provider is measured against.
 *
 * The questions are asked in Allen's order, and that order carries meaning:
 * a multi-step outcome becomes a *project* before anyone asks about its
 * duration, because "plan the wedding" is a project regardless of how long its
 * first action takes.
 */

import { type IsoDate, type IsoDateTime } from '../dates/index.js';
import type { Container } from './containers.js';

/**
 * Allen's two-minute rule.
 *
 * An action at or under this cost is done immediately rather than tracked,
 * because the overhead of tracking it exceeds the work itself. Two minutes is his
 * figure; the threshold is a parameter so it can be tuned without editing logic.
 */
export const DEFAULT_TWO_MINUTE_THRESHOLD = 2;

export interface ClarifyInput {
  /** What was captured. */
  title: string;
  /** Whether the item requires action at all. `null` means not yet decided. */
  actionable: boolean | null;
  /**
   * The next *physical, visible* action. Not "plan the wedding" but "call the
   * venue about a date". `null` means not yet decided.
   */
  nextAction: string | null;
  /** Whether closing this needs more than one action. `null` means undecided. */
  requiresMultipleActions: boolean | null;
  /** A hard date or time this must happen at. */
  whenAt: IsoDateTime | null;
  /** A soft deadline. Deliberately does not route to the calendar. */
  deadline: IsoDate | null;
  /** The person the work is delegated to, if anyone. */
  delegateTo: string | null;
  /** When to chase the delegate. Required before an item may sit in Waiting For. */
  followUpAt: IsoDateTime | null;
  /** Estimate for the next action, in minutes. */
  estimateMinutes: number | null;
  twoMinuteThresholdMinutes?: number;
}

export type ClarifyOutcome =
  | { kind: 'do_now'; nextAction: string; reason: string }
  | { kind: 'next_action'; nextAction: string; reason: string }
  | { kind: 'calendar'; nextAction: string; whenAt: IsoDateTime; reason: string }
  | {
      kind: 'waiting';
      nextAction: string;
      waitingOn: string;
      followUpAt: IsoDateTime;
      reason: string;
    }
  | { kind: 'project'; projectName: string; nextAction: string; reason: string }
  | { kind: 'someday'; reason: string }
  | { kind: 'reference'; reason: string }
  | { kind: 'trash'; reason: string }
  /** The tree cannot decide yet; these are the answers still required. */
  | { kind: 'undecided'; missing: ClarifyQuestionId[]; reason: string };

export type ClarifyQuestionId =
  'actionable' | 'nextAction' | 'requiresMultipleActions' | 'delegateTo' | 'whenAt' | 'followUpAt';

/**
 * The questions the clarification UI asks, in the order the tree asks them.
 *
 * Keeping the order in data rather than in component code means the CLI and the
 * web UI walk the identical sequence, and a change to the method is a change to
 * one list.
 */
export const CLARIFY_QUESTIONS: ReadonlyArray<{
  id: ClarifyQuestionId;
  prompt: string;
  help: string;
  kind: 'boolean' | 'text' | 'datetime';
  /** Only asked when this predicate passes. */
  when?: (input: ClarifyInput) => boolean;
}> = [
  {
    id: 'actionable',
    prompt: 'Is this actionable?',
    help: 'Does anything need to be done about it?',
    kind: 'boolean',
  },
  {
    id: 'nextAction',
    prompt: 'What is the very next physical action?',
    help: 'Something concrete and visible, not an intention. "Email Sam about the invoice", not "sort out billing".',
    kind: 'text',
    when: (input) => input.actionable === true,
  },
  {
    id: 'requiresMultipleActions',
    prompt: 'Will one action close this loop?',
    help: 'If closing it needs more than one step, the outcome is a project and needs its own next action.',
    kind: 'boolean',
    when: (input) => input.actionable === true,
  },
  {
    id: 'delegateTo',
    prompt: 'Is this someone else’s to do?',
    help: 'If so, name them and it goes on Waiting For. Leave blank for no.',
    kind: 'text',
    when: (input) => input.actionable === true && input.requiresMultipleActions === false,
  },
  {
    id: 'whenAt',
    prompt: 'Does it have to happen at a specific time?',
    help: 'Only a hard date or time belongs on the calendar. A deadline is not a calendar entry. Leave blank for no.',
    kind: 'datetime',
    when: (input) =>
      input.actionable === true && input.requiresMultipleActions === false && !input.delegateTo,
  },
  {
    id: 'followUpAt',
    prompt: 'When should I follow up?',
    help: 'A Waiting For entry without a follow-up date is one you will never chase.',
    kind: 'datetime',
    when: (input) => input.actionable === true && Boolean(input.delegateTo),
  },
];

/**
 * Question ids still unanswered for a given input, in tree order.
 *
 * Only questions whose *affirmative* answer is required count as missing.
 * `delegateTo` and `whenAt` are absent from this list because their answer is
 * encoded in the value itself: `null` means "no, not delegated" and "no hard
 * date", both of which are complete answers. Reporting them as gaps would make
 * the tree undecidable for the majority of items, since most actions are neither
 * delegated nor scheduled.
 */
export function missingClarifyQuestions(input: ClarifyInput): ClarifyQuestionId[] {
  const missing: ClarifyQuestionId[] = [];

  if (input.actionable === null) {
    missing.push('actionable');
  }

  if (input.actionable === true) {
    if (isBlank(input.nextAction)) {
      missing.push('nextAction');
    }
    if (input.requiresMultipleActions === null) {
      missing.push('requiresMultipleActions');
    }
    // A delegate without a date to chase them is an item nobody will follow up.
    if (!isBlank(input.delegateTo) && input.followUpAt === null) {
      missing.push('followUpAt');
    }
  }

  return missing;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function trimmed(value: string | null): string {
  return value?.trim() ?? '';
}

/**
 * Runs the clarification tree.
 *
 * Returns `undecided` rather than guessing when an answer the branch depends on
 * is absent. Guessing is exactly what turns a trusted system into an untrusted
 * one, so the caller is required to supply the missing answers.
 */
export function clarify(input: ClarifyInput): ClarifyOutcome {
  const threshold = input.twoMinuteThresholdMinutes ?? DEFAULT_TWO_MINUTE_THRESHOLD;
  const missing = missingClarifyQuestions(input);
  const title = trimmed(input.title) || 'Untitled';

  // 1. Not actionable. The item is kept only if it is worth retrieving.
  if (input.actionable === false) {
    // A hard date is evidence it was worth keeping, even without an action.
    if (input.whenAt) {
      return {
        kind: 'reference',
        reason: `Not actionable, but it is tied to ${input.whenAt.slice(0, 10)}, so it is filed as reference.`,
      };
    }
    if (input.deadline) {
      return {
        kind: 'reference',
        reason: `Not actionable, but the deadline of ${input.deadline} makes it worth retrieving.`,
      };
    }
    return {
      kind: 'someday',
      reason: `Not actionable right now, so "${title}" is incubated on Someday / Maybe.`,
    };
  }

  if (missing.length > 0) {
    return {
      kind: 'undecided',
      missing,
      reason: `Still need an answer for: ${missing.join(', ')}.`,
    };
  }

  const nextAction = trimmed(input.nextAction) || title;

  // 2. More than one action means the outcome is a project. This branch is
  //    asked before duration, because the first action of a project is a
  //    project-management action regardless of how long it takes.
  if (input.requiresMultipleActions === true) {
    return {
      kind: 'project',
      projectName: title,
      nextAction,
      reason: `"${title}" needs more than one action, so it becomes a project with a defined next action.`,
    };
  }

  // 3. Delegated work goes to Waiting For, and only with a date to chase it.
  if (input.delegateTo) {
    const followUpAt = input.followUpAt;
    if (!followUpAt) {
      return {
        kind: 'undecided',
        missing: ['followUpAt'],
        reason: 'Delegated work needs a follow-up date, or it will never be chased.',
      };
    }
    return {
      kind: 'waiting',
      nextAction,
      waitingOn: trimmed(input.delegateTo),
      followUpAt,
      reason: `"${nextAction}" is ${trimmed(input.delegateTo)}’s to do, with a follow-up on ${followUpAt.slice(0, 10)}.`,
    };
  }

  // 4. Under two minutes is not worth tracking.
  if (
    input.estimateMinutes !== null &&
    input.estimateMinutes > 0 &&
    input.estimateMinutes <= threshold
  ) {
    return {
      kind: 'do_now',
      nextAction,
      reason: `At ${input.estimateMinutes} minutes this is under the ${threshold}-minute tracking threshold, so do it now.`,
    };
  }

  // 5. A hard date or time makes it calendar material. A deadline does not.
  if (input.whenAt) {
    return {
      kind: 'calendar',
      nextAction,
      whenAt: input.whenAt,
      reason: `"${nextAction}" is committed to ${input.whenAt.slice(0, 16).replace('T', ' ')}, so it belongs on the calendar.`,
    };
  }

  // 6. Everything else is a next action, to be done as soon as possible.
  return {
    kind: 'next_action',
    nextAction,
    reason: `"${nextAction}" has no hard date, so it joins the next-actions pool for whenever the context is right.`,
  };
}

/** The container an outcome should be filed into. */
export function containerForOutcome(outcome: ClarifyOutcome): Container | null {
  switch (outcome.kind) {
    case 'do_now':
      return 'done';
    case 'next_action':
      return 'next_action';
    case 'calendar':
      return 'calendar';
    case 'waiting':
      return 'waiting';
    case 'project':
      // The project is the container of record; its next action is tracked
      // against it rather than parked in a list of its own.
      return 'next_action';
    case 'someday':
      return 'someday';
    case 'reference':
      return 'reference';
    case 'trash':
      return 'trash';
    case 'undecided':
      return null;
  }
}

/** One-line human explanation of a decision, for the clarification UI. */
export function describeOutcome(outcome: ClarifyOutcome): string {
  return outcome.reason;
}

/**
 * Detects whether a captured string looks like a multi-step outcome rather than
 * an action.
 *
 * This is a heuristic offered to the clarification UI to pre-fill an answer, not
 * a decision. It never overrides an explicit user answer, because mistaking a
 * real action for a project would silently hide it on a project list.
 */
export function looksLikeProjectOutcome(title: string): boolean {
  const text = title.trim().toLowerCase();
  if (text === '') {
    return false;
  }
  const projectVerbs = [
    'plan',
    'organise',
    'organize',
    'set up',
    'setup',
    'build',
    'design',
    'research',
    'investigate',
    'learn',
    'implement',
    'migrate',
    'launch',
    'write',
    'renovate',
  ];
  return projectVerbs.some((verb) => text.startsWith(`${verb} `));
}
