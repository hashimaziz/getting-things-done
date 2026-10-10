/**
 * Deciding what an inbox item is.
 *
 * Allen's clarifying questions are four: is it actionable, and if so is the next
 * physical action obvious; if not, is it something to do later, something to
 * delegate, or just reference material. This module turns an answer into a decision,
 * and nothing else — the questions themselves are asked by the UI, because the whole
 * point is that they are asked of a person.
 *
 * Two rules are enforced here rather than left to the interface:
 *
 * - A decision that would produce an invalid item is refused, with the reason. An
 *   item moved to the calendar without a hard date is not a calendar item, and an
 *   item moved to waiting with nobody to wait on is not waiting for anything.
 * - The decision is recorded. Every clarifying move is a decision that was reasoned
 *   about, and a system that quietly forgets why something is where it is cannot be
 *   trusted a month later.
 */

import type { Container } from './types';

/** What kind of thing this is. Mirrors the four clarifying questions. */
export type ClarifyKind = 'action' | 'someday' | 'delegate' | 'reference' | 'delete';

export interface ClarifyDecision {
  kind: ClarifyKind;
  /** The container the item should end up in. */
  container: Container;
  /** One sentence, for the activity log and for the confirmation. */
  reason: string;
}

export interface ClarifyInput {
  kind: ClarifyKind;
  /** Required for `delegate`: who has it now. */
  waitingOnPersonId?: string | null;
  /** Required for `delegate`: the date to chase it. */
  followUpAt?: string | null;
  /** Required for a calendar item, but the calendar is chosen by hard date not here. */
  whenAt?: string | null;
}

/**
 * Turns a kind plus whatever it requires into a decision.
 *
 * Returns a problem instead of throwing: the person answering the questions is in the
 * middle of a flow, and being told "add a follow-up date" is feedback, not an error.
 */
export function decide(
  input: ClarifyInput,
): { ok: true; decision: ClarifyDecision } | { ok: false; problem: string } {
  switch (input.kind) {
    case 'action':
      return {
        ok: true,
        decision: {
          kind: 'action',
          container: 'next_action',
          reason: 'It is a concrete action.',
        },
      };

    case 'someday':
      return {
        ok: true,
        decision: {
          kind: 'someday',
          container: 'someday',
          // Named as decided rather than as deferred. "Someday" in Allen's method is
          // a decision to do it if circumstances allow, not a backlog of things you
          // keep meaning to do.
          reason: 'Worth doing, but not now — and not on the calendar.',
        },
      };

    case 'reference':
      return {
        ok: true,
        decision: {
          kind: 'reference',
          container: 'reference',
          reason: 'Material to consult, with nothing to do about it.',
        },
      };

    case 'delete':
      return {
        ok: true,
        decision: {
          kind: 'delete',
          container: 'trash',
          reason: 'Not worth keeping.',
        },
      };

    case 'delegate': {
      if (
        input.waitingOnPersonId === undefined ||
        input.waitingOnPersonId === null ||
        input.waitingOnPersonId === ''
      ) {
        // Delegated to nobody is not delegation, and without this the item would sit
        // in waiting looking like it was being chased by someone.
        return { ok: false, problem: 'Who is it waiting on?' };
      }
      if (input.followUpAt === undefined || input.followUpAt === null || input.followUpAt === '') {
        // Waiting without a date to chase it is how delegated work disappears for
        // months.
        return { ok: false, problem: 'When will you chase it?' };
      }

      return {
        ok: true,
        decision: {
          kind: 'delegate',
          container: 'waiting',
          reason: 'Someone else has it, with a date to follow up.',
        },
      };
    }

    default:
      return { ok: false, problem: 'That is not one of the clarifying questions.' };
  }
}

/**
 * Where each answer puts the item.
 *
 * Shown on the button itself. "Is it actionable?" asks a question; a person who
 * answers it is entitled to know the item is about to become a next action, and the
 * only way to find that out is to answer and then go and look at a list. An answer
 * whose consequence is visible before it is given is a decision; one that is not is a
 * guess with a loading spinner.
 */
export const CLARIFY_DESTINATIONS: Record<ClarifyKind, string> = {
  action: 'Next actions',
  someday: 'Someday / maybe',
  delegate: 'Waiting for',
  reference: 'Reference',
  delete: 'Trash',
};

/** The questions, in the order they should be asked. */
export const CLARIFY_QUESTIONS: Array<{
  kind: ClarifyKind;
  question: string;
  /** Rendered under the question, explaining why it matters. */
  hint: string;
  requires: Array<'person' | 'followUp'>;
}> = [
  {
    kind: 'action',
    question: 'Is it actionable?',
    hint: 'Is there a concrete thing you could physically do about it?',
    requires: [],
  },
  {
    kind: 'someday',
    question: 'Is it someday / maybe?',
    hint: 'Worth doing, but not on the calendar and not now.',
    requires: [],
  },
  {
    kind: 'delegate',
    question: 'Are you waiting on someone?',
    hint: 'Someone else has to act before this can move.',
    requires: ['person', 'followUp'],
  },
  {
    kind: 'reference',
    question: 'Is it just reference?',
    hint: 'Something to consult rather than something to do.',
    requires: [],
  },
  {
    kind: 'delete',
    question: 'Do you still need it?',
    hint: 'Deleting is a valid answer. So is keeping it.',
    requires: [],
  },
];

/**
 * The next question worth asking, given what is already known.
 *
 * A clarify flow that always shows all five questions makes someone read five
 * questions to answer one. Questions already answered are skipped, so the flow is as
 * short as the answer actually is.
 */
export function nextQuestion(answered: ClarifyKind[]): ClarifyKind | null {
  return CLARIFY_QUESTIONS.find((question) => !answered.includes(question.kind))?.kind ?? null;
}

/**
 * A one-line summary of where everything in the inbox would go.
 *
 * Used on the clarify screen to show the effect of an answer before committing to it.
 * "Delegated to Dana, follow up Friday" is understood at a glance; "container: waiting"
 * is not.
 */
export function describeDecision(
  decision: ClarifyDecision,
  // `string | undefined` rather than a plain optional key, so a caller can pass an
  // absent name explicitly without tripping `exactOptionalPropertyTypes`.
  options: { personName?: string | undefined } = {},
): string {
  switch (decision.kind) {
    case 'action':
      return 'A next action.';
    case 'someday':
      return 'Someday / maybe.';
    case 'reference':
      return 'Reference material.';
    case 'delete':
      return 'Trashed.';
    case 'delegate':
      return options.personName === undefined
        ? 'Waiting on someone.'
        : `Waiting on ${options.personName}.`;
    default:
      return decision.reason;
  }
}
