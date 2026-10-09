import { describe, expect, it } from 'vitest';
import {
  CLARIFY_QUESTIONS,
  decide,
  describeDecision,
  nextQuestion,
  type ClarifyInput,
} from './clarify';

/**
 * Deciding what an inbox item is.
 *
 * The refusals are the interesting half. Every one of them describes a decision that
 * would produce an item which lies about itself: an item in the calendar with no hard
 * date, an item in waiting with nobody to wait on.
 */

function input(overrides: Partial<ClarifyInput> = {}): ClarifyInput {
  return { kind: 'action', ...overrides };
}

describe('deciding', () => {
  it('makes an actionable thing a next action', () => {
    const result = decide(input({ kind: 'action' }));

    expect(result).toEqual({
      ok: true,
      decision: {
        kind: 'action',
        container: 'next_action',
        reason: 'It is a concrete action.',
      },
    });
  });

  it('makes a someday thing someday', () => {
    expect(decide(input({ kind: 'someday' })).ok && decide(input({ kind: 'someday' })).ok).toBe(
      true,
    );
  });

  it('makes a delegated thing waiting, once both details are given', () => {
    const result = decide(
      input({ kind: 'delegate', waitingOnPersonId: 'p1', followUpAt: '2026-03-10' }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.decision.container).toBe('waiting');
  });

  it('makes reference material reference', () => {
    const result = decide(input({ kind: 'reference' }));

    expect(result.ok && result.decision.container).toBe('reference');
  });

  it('makes "I do not need this" a move to the trash', () => {
    // Deleting is a valid answer, and pretending otherwise leads to an inbox of things
    // nobody will ever look at again.
    const result = decide(input({ kind: 'delete' }));

    expect(result.ok && result.decision.container).toBe('trash');
  });

  it('gives every decision a reason', () => {
    for (const kind of ['action', 'someday', 'delegate', 'reference', 'delete'] as const) {
      const result = decide(input({ kind, waitingOnPersonId: 'p1', followUpAt: '2026-03-10' }));
      expect(result.ok && result.decision.reason.length, kind).toBeGreaterThan(0);
    }
  });
});

describe('refusing decisions that would produce a lying item', () => {
  it('refuses delegation with nobody to wait on', () => {
    const result = decide(input({ kind: 'delegate', followUpAt: '2026-03-10' }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toBe('Who is it waiting on?');
  });

  it('refuses delegation with an empty person id', () => {
    const result = decide(
      input({ kind: 'delegate', waitingOnPersonId: '', followUpAt: '2026-03-10' }),
    );

    expect(result.ok).toBe(false);
  });

  /*
   * Waiting without a date to chase it is how delegated work disappears for months.
   * This is the single most valuable refusal in the flow.
   */
  it('refuses delegation with no follow-up date', () => {
    const result = decide(input({ kind: 'delegate', waitingOnPersonId: 'p1' }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toBe('When will you chase it?');
  });

  it('refuses a kind it does not recognise', () => {
    const result = decide(input({ kind: 'sideways' as never }));

    expect(result.ok).toBe(false);
  });

  it('does not ask for a follow-up date for a non-delegated item', () => {
    // The rule belongs to delegation only. Applied everywhere it would demand a date
    // from someone deciding whether to bin an item.
    expect(decide(input({ kind: 'delete' })).ok).toBe(true);
  });
});

describe('the questions', () => {
  it('asks the four clarifying questions and the delete one', () => {
    expect(CLARIFY_QUESTIONS.map((question) => question.kind)).toEqual([
      'action',
      'someday',
      'delegate',
      'reference',
      'delete',
    ]);
  });

  it('says why each question is asked', () => {
    for (const question of CLARIFY_QUESTIONS) {
      expect(question.hint.length, question.kind).toBeGreaterThan(10);
    }
  });

  it('marks delegation as needing two details', () => {
    expect(CLARIFY_QUESTIONS.find((q) => q.kind === 'delegate')?.requires).toEqual([
      'person',
      'followUp',
    ]);
  });

  it('marks the others as needing nothing', () => {
    for (const question of CLARIFY_QUESTIONS.filter((q) => q.kind !== 'delegate')) {
      expect(question.requires, question.kind).toEqual([]);
    }
  });
});

describe('asking one at a time', () => {
  it('starts with the first question', () => {
    expect(nextQuestion([])).toBe('action');
  });

  /*
   * A flow that always shows every question makes someone read five questions to
   * answer one. Skipping what is already answered keeps it as short as the answer.
   */
  it('skips questions already answered', () => {
    expect(nextQuestion(['action'])).toBe('someday');
    expect(nextQuestion(['action', 'someday'])).toBe('delegate');
  });

  it('is finished once everything is answered', () => {
    expect(nextQuestion(CLARIFY_QUESTIONS.map((question) => question.kind))).toBeNull();
  });
});

describe('describing a decision', () => {
  it('says what each kind means in a sentence', () => {
    const kinds = ['action', 'someday', 'reference', 'delete'] as const;

    for (const kind of kinds) {
      const result = decide(input({ kind }));
      expect(result.ok && describeDecision(result.decision)).toMatch(/[.!]$/);
    }
  });

  it('names the person when delegating', () => {
    const result = decide(
      input({ kind: 'delegate', waitingOnPersonId: 'p1', followUpAt: '2026-03-10' }),
    );

    expect(result.ok && describeDecision(result.decision, { personName: 'Dana' })).toBe(
      'Waiting on Dana.',
    );
  });

  it('stays readable when the person is not known', () => {
    const result = decide(
      input({ kind: 'delegate', waitingOnPersonId: 'p1', followUpAt: '2026-03-10' }),
    );

    expect(result.ok && describeDecision(result.decision)).toBe('Waiting on someone.');
  });

  it('uses a sentence rather than a container name', () => {
    // "container: waiting" describes the schema. "Waiting on Dana." describes the
    // decision, and is understood without translation.
    const result = decide(input({ kind: 'someday' }));

    expect(result.ok && describeDecision(result.decision)).not.toContain('container');
  });
});
