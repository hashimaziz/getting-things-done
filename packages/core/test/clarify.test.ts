import { describe, expect, it } from 'vitest';
import {
  CLARIFY_QUESTIONS,
  DEFAULT_TWO_MINUTE_THRESHOLD,
  clarify,
  containerForOutcome,
  describeOutcome,
  looksLikeProjectOutcome,
  missingClarifyQuestions,
  type ClarifyInput,
} from '../src/gtd/index.js';

/** A fully answered input, which individual tests then adjust. */
function answered(overrides: Partial<ClarifyInput> = {}): ClarifyInput {
  return {
    title: 'Call the dentist',
    actionable: true,
    nextAction: 'Call the dentist',
    requiresMultipleActions: false,
    whenAt: null,
    deadline: null,
    delegateTo: null,
    followUpAt: null,
    estimateMinutes: 5,
    ...overrides,
  };
}

describe('missingClarifyQuestions', () => {
  it('is empty for a fully answered input', () => {
    expect(missingClarifyQuestions(answered())).toEqual([]);
  });

  it('requires the actionability answer first', () => {
    expect(missingClarifyQuestions(answered({ actionable: null }))).toContain('actionable');
  });

  it('requires a next action only once the item is known to be actionable', () => {
    expect(missingClarifyQuestions(answered({ actionable: false }))).not.toContain('nextAction');
  });

  it('treats a whitespace-only next action as missing', () => {
    expect(missingClarifyQuestions(answered({ nextAction: '   ' }))).toContain('nextAction');
  });

  it('does not ask about delegation for a multi-step outcome', () => {
    expect(missingClarifyQuestions(answered({ requiresMultipleActions: true }))).not.toContain(
      'delegateTo',
    );
  });

  it('does not ask about a hard date when delegated', () => {
    expect(missingClarifyQuestions(answered({ delegateTo: 'Dana' }))).not.toContain('whenAt');
  });

  it('treats a blank delegate as a complete answer rather than a gap', () => {
    // "No" is encoded as null. Treating it as missing would leave most actions
    // permanently undecidable.
    expect(missingClarifyQuestions(answered({ delegateTo: null }))).toEqual([]);
  });

  it('treats no hard date as a complete answer rather than a gap', () => {
    expect(missingClarifyQuestions(answered({ whenAt: null }))).toEqual([]);
  });

  it('asks for a follow-up date when delegated', () => {
    expect(missingClarifyQuestions(answered({ delegateTo: 'Dana', followUpAt: null }))).toEqual([
      'followUpAt',
    ]);
  });

  it('returns questions in tree order', () => {
    const missing = missingClarifyQuestions(
      answered({ actionable: true, nextAction: '  ', requiresMultipleActions: null }),
    );
    expect(missing).toEqual(['nextAction', 'requiresMultipleActions']);
  });

  it('stops asking downstream questions while actionability is unknown', () => {
    expect(
      missingClarifyQuestions(answered({ actionable: null, requiresMultipleActions: null })),
    ).toEqual(['actionable']);
  });
});

describe('CLARIFY_QUESTIONS', () => {
  it('asks actionability before anything else', () => {
    expect(CLARIFY_QUESTIONS[0]?.id).toBe('actionable');
  });

  it('asks the multi-step question before duration-dependent questions', () => {
    const ids = CLARIFY_QUESTIONS.map((question) => question.id);
    expect(ids.indexOf('requiresMultipleActions')).toBeLessThan(ids.indexOf('whenAt'));
  });

  it('gives every question a prompt and help text', () => {
    for (const question of CLARIFY_QUESTIONS) {
      expect(question.prompt).toBeTruthy();
      expect(question.help).toBeTruthy();
    }
  });
});

describe('clarify: not actionable', () => {
  it('incubates an item that is not actionable and undated', () => {
    const outcome = clarify(answered({ actionable: false }));
    expect(outcome.kind).toBe('someday');
  });

  it('files an undated non-actionable item as reference when it carries a deadline', () => {
    const outcome = clarify(answered({ actionable: false, deadline: '2026-12-01' }));
    expect(outcome.kind).toBe('reference');
  });

  it('files as reference when it has a hard date', () => {
    const outcome = clarify(answered({ actionable: false, whenAt: '2026-10-08T09:00:00.000Z' }));
    expect(outcome.kind).toBe('reference');
  });

  it('does not ask further questions once it knows the item is not actionable', () => {
    const outcome = clarify(
      answered({ actionable: false, nextAction: null, requiresMultipleActions: null }),
    );
    expect(outcome.kind).toBe('someday');
  });
});

describe('clarify: undecided', () => {
  it('refuses to guess when actionability is unknown', () => {
    const outcome = clarify(answered({ actionable: null }));
    expect(outcome.kind).toBe('undecided');
    if (outcome.kind === 'undecided') {
      expect(outcome.missing).toContain('actionable');
    }
  });

  it('refuses to guess when the next action is missing', () => {
    const outcome = clarify(answered({ nextAction: null }));
    expect(outcome.kind).toBe('undecided');
  });

  it('has no container while undecided', () => {
    expect(containerForOutcome(clarify(answered({ actionable: null })))).toBeNull();
  });
});

describe('clarify: project', () => {
  it('promotes a multi-step outcome to a project', () => {
    const outcome = clarify(answered({ title: 'Plan the wedding', requiresMultipleActions: true }));
    expect(outcome.kind).toBe('project');
    if (outcome.kind === 'project') {
      expect(outcome.projectName).toBe('Plan the wedding');
      expect(outcome.nextAction).toBeTruthy();
    }
  });

  it('asks the multi-step question before the two-minute rule', () => {
    // Even a one-minute first action does not dodge the project branch, because
    // a project's first action is project management by definition.
    const outcome = clarify(answered({ requiresMultipleActions: true, estimateMinutes: 1 }));
    expect(outcome.kind).toBe('project');
  });

  it('takes a distinct next action from the project name', () => {
    const outcome = clarify(
      answered({
        title: 'Renovate the kitchen',
        nextAction: 'Get three quotes',
        requiresMultipleActions: true,
      }),
    );
    expect(outcome.kind === 'project' && outcome.nextAction).toBe('Get three quotes');
  });
});

describe('clarify: delegation', () => {
  it('routes delegated work to Waiting For', () => {
    const outcome = clarify(
      answered({
        delegateTo: 'Dana',
        followUpAt: '2026-10-09T09:00:00.000Z',
      }),
    );
    expect(outcome.kind).toBe('waiting');
    if (outcome.kind === 'waiting') {
      expect(outcome.waitingOn).toBe('Dana');
      expect(outcome.followUpAt).toBe('2026-10-09T09:00:00.000Z');
    }
  });

  it('insists on a follow-up date rather than filing an unchaseable item', () => {
    const outcome = clarify(answered({ delegateTo: 'Dana', followUpAt: null }));
    expect(outcome.kind).toBe('undecided');
    if (outcome.kind === 'undecided') {
      expect(outcome.missing).toContain('followUpAt');
    }
  });

  it('prefers delegation over a hard date', () => {
    // If someone else owes it, chasing them matters more than the date.
    const outcome = clarify(
      answered({
        delegateTo: 'Dana',
        followUpAt: '2026-10-09T09:00:00.000Z',
        whenAt: '2026-10-08T09:00:00.000Z',
      }),
    );
    expect(outcome.kind).toBe('waiting');
  });
});

describe('clarify: the two-minute rule', () => {
  it('does a quick action immediately', () => {
    const outcome = clarify(answered({ estimateMinutes: 2 }));
    expect(outcome.kind).toBe('do_now');
  });

  it('defers an action just over the threshold', () => {
    const outcome = clarify(answered({ estimateMinutes: 3 }));
    expect(outcome.kind).toBe('next_action');
  });

  it('honours a custom threshold', () => {
    const outcome = clarify(answered({ estimateMinutes: 10, twoMinuteThresholdMinutes: 15 }));
    expect(outcome.kind).toBe('do_now');
  });

  it('does not fire when there is no estimate', () => {
    // An unknown duration is not evidence of a short one.
    expect(clarify(answered({ estimateMinutes: null })).kind).toBe('next_action');
  });

  it('does not fire on a zero estimate', () => {
    expect(clarify(answered({ estimateMinutes: 0 })).kind).toBe('next_action');
  });

  it('applies the two-minute threshold before the calendar', () => {
    // A five-minute task scheduled for 09:00 is still just a task you can do
    // now, and putting it on the calendar would dilute it.
    const outcome = clarify(answered({ estimateMinutes: 1, whenAt: '2026-10-08T09:00:00.000Z' }));
    expect(outcome.kind).toBe('do_now');
  });

  it('uses two minutes by default', () => {
    expect(DEFAULT_TWO_MINUTE_THRESHOLD).toBe(2);
  });
});

describe('clarify: calendar and next actions', () => {
  it('routes a hard date to the calendar', () => {
    const outcome = clarify(answered({ whenAt: '2026-10-08T09:00:00.000Z' }));
    expect(outcome.kind).toBe('calendar');
    if (outcome.kind === 'calendar') {
      expect(outcome.whenAt).toBe('2026-10-08T09:00:00.000Z');
    }
  });

  it('does not route a soft deadline to the calendar', () => {
    expect(clarify(answered({ deadline: '2026-12-01' })).kind).toBe('next_action');
  });

  it('falls through to next actions with no date', () => {
    expect(clarify(answered()).kind).toBe('next_action');
  });

  it('refuses to guess when a whitespace-only next action is supplied', () => {
    // The tree will not fall back to the title, because "Water the plants" as a
    // title does not establish what the next physical action is.
    const outcome = clarify(
      answered({ title: 'Water the plants', nextAction: '  ', requiresMultipleActions: false }),
    );
    expect(outcome.kind).toBe('undecided');
    if (outcome.kind === 'undecided') {
      expect(outcome.missing).toContain('nextAction');
    }
  });
});

describe('containerForOutcome', () => {
  it.each([
    ['do_now', 'done'],
    ['next_action', 'next_action'],
    ['project', 'next_action'],
    ['someday', 'someday'],
  ] as const)('maps %s to %s', (kind, expected) => {
    const outcome = clarify(
      answered({
        actionable: kind !== 'someday',
        requiresMultipleActions: kind === 'project',
        estimateMinutes: kind === 'do_now' ? 1 : 30,
      }),
    );
    expect(containerForOutcome(outcome)).toBe(expected);
  });

  it('maps a calendar decision to the calendar', () => {
    expect(containerForOutcome(clarify(answered({ whenAt: '2026-10-08T09:00:00.000Z' })))).toBe(
      'calendar',
    );
  });

  it('maps a delegation decision to waiting', () => {
    expect(
      containerForOutcome(
        clarify(answered({ delegateTo: 'Dana', followUpAt: '2026-10-09T09:00:00.000Z' })),
      ),
    ).toBe('waiting');
  });
});

describe('describeOutcome', () => {
  it('always explains the decision', () => {
    for (const outcome of [
      clarify(answered()),
      clarify(answered({ actionable: false })),
      clarify(answered({ requiresMultipleActions: true })),
      clarify(answered({ whenAt: '2026-10-08T09:00:00.000Z' })),
      clarify(answered({ actionable: null })),
    ]) {
      expect(describeOutcome(outcome)).toBeTruthy();
    }
  });

  it('names the two-minute threshold when it fires', () => {
    const outcome = clarify(answered({ estimateMinutes: 1 }));
    expect(describeOutcome(outcome)).toContain('2-minute');
  });
});

describe('looksLikeProjectOutcome', () => {
  it.each([
    ['Plan the wedding', true],
    ['Set up the new desk', true],
    ['Research a new laptop', true],
    ['Call the dentist', false],
    ['Buy milk', false],
    ['  ', false],
  ])('classifies "%s" as %s', (title, expected) => {
    expect(looksLikeProjectOutcome(title)).toBe(expected);
  });

  it('requires the verb to lead the phrase', () => {
    expect(looksLikeProjectOutcome('I need to plan the wedding')).toBe(false);
  });
});
