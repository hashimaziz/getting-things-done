/**
 * Navigating the weekly review.
 *
 * Allen calls the review the single critical success factor for the whole system, and
 * the reason most systems fail is that it is a *list* rather than a sequence. A list is
 * something you scroll; a sequence is something you finish. So each step here has a
 * destination, and finishing it means doing something somewhere rather than ticking a
 * box.
 *
 * The mapping from a step to a route is the load-bearing part, and it lives in one place
 * so a step can never point somewhere that does not exist.
 */

import type { ReviewProgress, ReviewStep } from './types';

export type ReviewPhase = 'get_clear' | 'get_current' | 'get_creative';

/**
 * Where each step sends you.
 *
 * A step with no destination is one you do from memory — gathering loose papers, emptying
 * your head — and the wording says so rather than offering a link that goes nowhere.
 */
export function destinationFor(step: ReviewStep): string | null {
  switch (step.source) {
    case 'inbox':
    case 'next_actions':
      return `/list/${step.source === 'inbox' ? 'inbox' : 'next_action'}`;
    case 'calendar_past':
    case 'calendar_upcoming':
      return '/calendar';
    case 'waiting':
      return '/list/waiting';
    case 'projects':
      return '/projects';
    case 'checklists':
      return '/settings/templates';
    case 'someday':
      return '/list/someday';
    case 'goals':
      // Goals and areas of focus are a roadmap item, not a screen that exists yet.
      // Deliberately null rather than a link to something that does not exist.
      return null;
    default:
      return null;
  }
}

/** The label on the button that takes you to the step's work. */
export function actionLabelFor(step: ReviewStep): string {
  switch (step.source) {
    case 'inbox':
      return 'Clarify the inbox';
    case 'next_actions':
      return 'Review next actions';
    case 'calendar_past':
    case 'calendar_upcoming':
      return 'Open the calendar';
    case 'waiting':
      return 'Review waiting for';
    case 'projects':
      return 'Review projects';
    case 'checklists':
      return 'Review checklists';
    case 'someday':
      return 'Review someday / maybe';
    default:
      return 'Do this now';
  }
}

/** What a step's status means in words. */
export function statusOf(entry: ReviewProgress): {
  label: string;
  tone: 'ok' | 'todo' | 'problem';
} {
  if (entry.problems > 0) {
    return { label: `${entry.problems} to look at`, tone: 'problem' };
  }
  if (entry.satisfied) {
    return { label: 'Nothing outstanding', tone: 'ok' };
  }
  return { label: `${entry.pending} to work through`, tone: 'todo' };
}

export interface ReviewPhaseGroup {
  phase: ReviewPhase;
  title: string;
  description: string;
  steps: ReviewProgress[];
  /** How many steps in this phase have nothing outstanding. */
  satisfied: number;
}

/** Groups the steps by phase, preserving the order the server gave them. */
export function groupByPhase(
  progress: ReviewProgress[],
  phases: ReadonlyArray<{ id: string; title: string; description: string }>,
): ReviewPhaseGroup[] {
  return phases
    .map((phase) => {
      const steps = progress.filter((entry) => entry.step.phase === phase.id);
      return {
        phase: phase.id as ReviewPhase,
        title: phase.title,
        description: phase.description,
        steps,
        satisfied: steps.filter((entry) => entry.satisfied).length,
      };
    })
    .filter((group) => group.steps.length > 0);
}

/**
 * The next step to work on.
 *
 * The first step with something outstanding, in the order the method gives. Ordering is
 * the point: the review is not a bag of tasks to be done in any order, and offering to
 * jump to the easiest step is how the inbox gets skipped.
 */
export function nextStep(progress: ReviewProgress[]): ReviewProgress | null {
  return progress.find((entry) => !entry.satisfied) ?? null;
}

/** How far through the review someone is, as a percentage for a progress bar. */
export function completionPercent(progress: ReviewProgress[]): number {
  if (progress.length === 0) {
    return 100;
  }
  const satisfied = progress.filter((entry) => entry.satisfied).length;
  return Math.round((satisfied / progress.length) * 100);
}

/**
 * How long it has been since the last review, in whole days.
 *
 * Null when there has never been one. The review's own value is that it is weekly, so a
 * person opening the app after six weeks needs to be told that plainly.
 */
export function daysSinceReview(lastReviewAt: string | null, today: string): number | null {
  if (lastReviewAt === null) {
    return null;
  }
  const then = new Date(lastReviewAt);
  if (Number.isNaN(then.getTime())) {
    return null;
  }

  /*
   * Counted between calendar days rather than elapsed hours. The review is a weekly
   * ritual, and the question is "how many weeks since", which is a question about days.
   * Elapsed time would report "6 days ago" for a review run at nine in the morning a
   * week earlier, which reads as a day late and makes the cadence look less reliable
   * than it is.
   */
  const thenDay = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const nowDay = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(nowDay)) {
    return null;
  }

  return Math.round((nowDay - thenDay) / 86_400_000);
}

/** What to say about how long ago the review ran. */
export function reviewCadenceLabel(days: number | null): {
  label: string;
  tone: 'ok' | 'todo' | 'problem';
} {
  if (days === null) {
    // Never having done one is not a failure to report — it is the first week.
    return { label: 'Never run', tone: 'todo' };
  }
  if (days <= 7) {
    return {
      label: days === 0 ? 'Done today' : `Done ${days} day${days === 1 ? '' : 's'} ago`,
      tone: 'ok',
    };
  }
  if (days <= 14) {
    return { label: `${days} days ago — due now`, tone: 'todo' };
  }
  return { label: `${days} days ago — overdue`, tone: 'problem' };
}

/**
 * What a problem violation means, in words.
 *
 * The invariant names are precise and unhelpful to a person: "project_without_next_action"
 * is a database concept. These are the sentences worth reading instead.
 */
export function describeViolation(message: string): string {
  return message.replace(/_/g, ' ');
}
