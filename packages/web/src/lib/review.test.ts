import { describe, expect, it } from 'vitest';
import {
  actionLabelFor,
  completionPercent,
  daysSinceReview,
  describeViolation,
  destinationFor,
  groupByPhase,
  nextStep,
  reviewCadenceLabel,
  statusOf,
} from './review';
import type { ReviewProgress, ReviewStep } from './types';

/**
 * The weekly review's navigation and framing.
 *
 * The step definitions live in core so the server and the client cannot disagree about
 * the order or the wording. What is here is the mapping from each step to the place its
 * work happens, because that is the part that decides whether the review is a sequence
 * or a list.
 */

function step(overrides: Partial<ReviewStep> & { id: string; source: string }): ReviewStep {
  return {
    title: 'A step',
    description: 'Something to do.',
    phase: 'get_clear',
    ...overrides,
  } as ReviewStep;
}

function progress(
  stepSpec: ReviewStep,
  pending: number,
  problems = 0,
  satisfied = pending === 0,
): ReviewProgress {
  return { step: stepSpec, pending, problems, satisfied };
}

describe('destinations', () => {
  it('sends inbox work to the inbox', () => {
    expect(destinationFor(step({ id: 'a', source: 'inbox' }))).toBe('/list/inbox');
  });

  it('sends next actions to next actions', () => {
    expect(destinationFor(step({ id: 'a', source: 'next_actions' }))).toBe('/list/next_action');
  });

  it('sends both calendar steps to the calendar', () => {
    expect(destinationFor(step({ id: 'a', source: 'calendar_past' }))).toBe('/calendar');
    expect(destinationFor(step({ id: 'a', source: 'calendar_upcoming' }))).toBe('/calendar');
  });

  it('sends waiting to the waiting list', () => {
    expect(destinationFor(step({ id: 'a', source: 'waiting' }))).toBe('/list/waiting');
  });

  it('sends someday to the someday list', () => {
    expect(destinationFor(step({ id: 'a', source: 'someday' }))).toBe('/list/someday');
  });

  it('sends projects and checklists to their own screens', () => {
    expect(destinationFor(step({ id: 'a', source: 'projects' }))).toBe('/projects');
    expect(destinationFor(step({ id: 'a', source: 'checklists' }))).toBe('/settings/templates');
  });

  /*
   * Goals and areas of focus are a roadmap item. A link to a screen that does not exist
   * is worse than saying plainly that this step happens away from the app, which is also
   * what is true of it.
   */
  it('has no destination for goals, because that screen does not exist', () => {
    expect(destinationFor(step({ id: 'a', source: 'goals' }))).toBeNull();
  });

  it('has no destination for a source it does not recognise', () => {
    expect(destinationFor(step({ id: 'a', source: 'something.new' }))).toBeNull();
  });

  it('never points at a container that is not one', () => {
    const sources = [
      'inbox',
      'next_actions',
      'calendar_past',
      'calendar_upcoming',
      'waiting',
      'projects',
      'checklists',
      'someday',
      'goals',
    ];

    for (const source of sources) {
      const destination = destinationFor(step({ id: 'a', source }));
      if (destination === null) {
        continue;
      }
      // The one mapping that could go wrong is `next_actions` → `/list/next_actions`,
      // which is a route that does not exist: the container is named next_action.
      expect(destination, source).not.toBe('/list/next_actions');
    }
  });
});

describe('action labels', () => {
  it('names the work rather than the screen', () => {
    expect(actionLabelFor(step({ id: 'a', source: 'inbox' }))).toBe('Clarify the inbox');
    expect(actionLabelFor(step({ id: 'a', source: 'waiting' }))).toBe('Review waiting for');
  });

  it('has a label for a source it does not recognise', () => {
    expect(actionLabelFor(step({ id: 'a', source: 'unknown' })).length).toBeGreaterThan(0);
  });
});

describe('step status', () => {
  it('says when there is nothing outstanding', () => {
    // A review where everything reports nothing is a good outcome and should look like
    // one rather than like an empty screen.
    const status = statusOf(progress(step({ id: 'a', source: 'inbox' }), 0));

    expect(status.tone).toBe('ok');
    expect(status.label).toBe('Nothing outstanding');
  });

  it('counts what is left', () => {
    const status = statusOf(progress(step({ id: 'a', source: 'inbox' }), 12));

    expect(status.label).toBe('12 to work through');
    expect(status.tone).toBe('todo');
  });

  it('leads with the flagged count when there is one', () => {
    const status = statusOf(progress(step({ id: 'a', source: 'projects' }), 3, 2));

    expect(status.tone).toBe('problem');
    expect(status.label).toContain('2');
  });
});

describe('phases', () => {
  const phases = [
    { id: 'get_clear', title: 'Get clear', description: 'Empty every collection point.' },
    { id: 'get_current', title: 'Get current', description: 'Review each list.' },
    { id: 'get_creative', title: 'Get creative', description: 'Consider the wider horizon.' },
  ];

  it('groups steps under their phase', () => {
    const groups = groupByPhase(
      [
        progress(step({ id: 'a', source: 'inbox', phase: 'get_clear' }), 2),
        progress(step({ id: 'b', source: 'waiting', phase: 'get_current' }), 0),
      ],
      phases,
    );

    expect(groups.map((group) => group.phase)).toEqual(['get_clear', 'get_current']);
  });

  it('counts the clear steps in each phase', () => {
    const groups = groupByPhase(
      [
        progress(step({ id: 'a', source: 'inbox', phase: 'get_clear' }), 0),
        progress(step({ id: 'b', source: 'calendar_upcoming', phase: 'get_clear' }), 4),
      ],
      phases,
    );

    expect(groups.at(0)?.satisfied).toBe(1);
  });

  it('omits a phase with no steps rather than showing an empty one', () => {
    const groups = groupByPhase([progress(step({ id: 'a', source: 'inbox' }), 1)], phases);

    expect(groups).toHaveLength(1);
  });

  it('keeps the phase order the server gave', () => {
    const groups = groupByPhase(
      [
        progress(step({ id: 'a', source: 'goals', phase: 'get_creative' }), 0),
        progress(step({ id: 'b', source: 'inbox', phase: 'get_clear' }), 0),
      ],
      phases,
    );

    expect(groups.map((group) => group.phase)).toEqual(['get_clear', 'get_creative']);
  });
});

describe('what to do next', () => {
  const progressList = [
    progress(step({ id: 'a', source: 'inbox', phase: 'get_clear' }), 0),
    progress(step({ id: 'b', source: 'calendar_upcoming', phase: 'get_current' }), 4),
    progress(step({ id: 'c', source: 'someday', phase: 'get_current' }), 9),
  ];

  /*
   * The order is the point. The review is not a bag of tasks to be done in any order, and
   * offering to jump to the easiest step is how the inbox gets skipped.
   */
  it('is the first step with something outstanding, not the easiest one', () => {
    expect(nextStep(progressList)?.step.id).toBe('b');
  });

  it('is nothing when everything is clear', () => {
    const allClear = progressList.map((entry) => ({ ...entry, satisfied: true, pending: 0 }));

    expect(nextStep(allClear)).toBeNull();
  });

  it('is null for no steps at all', () => {
    expect(nextStep([])).toBeNull();
  });
});

describe('progress percentage', () => {
  it('is zero when nothing is reviewed', () => {
    expect(completionPercent([progress(step({ id: 'a', source: 'inbox' }), 2)])).toBe(0);
  });

  it('is a hundred when everything is', () => {
    const allClear = [
      progress(step({ id: 'a', source: 'inbox' }), 0),
      progress(step({ id: 'b', source: 'waiting' }), 0),
    ];

    expect(completionPercent(allClear)).toBe(100);
  });

  it('is a hundred for no steps, since there is nothing to do', () => {
    expect(completionPercent([])).toBe(100);
  });
});

describe('how long since the last review', () => {
  it('counts days', () => {
    expect(daysSinceReview('2026-03-01T09:00:00.000Z', '2026-03-08')).toBe(7);
  });

  it('is null when there has never been one', () => {
    expect(daysSinceReview(null, '2026-03-08')).toBeNull();
  });

  it('is null for an unreadable timestamp', () => {
    expect(daysSinceReview('nonsense', '2026-03-08')).toBeNull();
  });

  it('says never run without treating it as a failure', () => {
    // The first week is not a missed review.
    const label = reviewCadenceLabel(daysSinceReview(null, '2026-03-08'));

    expect(label.label).toBe('Never run');
    expect(label.tone).toBe('todo');
  });

  it('says done today', () => {
    expect(reviewCadenceLabel(0).label).toBe('Done today');
  });

  it('counts days in the singular', () => {
    expect(reviewCadenceLabel(1).label).toBe('Done 1 day ago');
  });

  it('calls two weeks overdue', () => {
    // The value of the review is that it is weekly, so six weeks without one is the
    // thing worth saying plainly.
    expect(reviewCadenceLabel(42).tone).toBe('problem');
    expect(reviewCadenceLabel(42).label).toContain('42');
  });

  it('calls a week old fine', () => {
    expect(reviewCadenceLabel(7).tone).toBe('ok');
  });
});

describe('describing a violation', () => {
  /*
   * The invariant names are precise and unhelpful to a person. "project_without_next_action"
   * is a database concept; this is the sentence worth reading instead.
   */
  it('turns a database name into words', () => {
    expect(describeViolation('project_without_next_action')).toBe('project without next action');
  });

  it('leaves a sentence alone', () => {
    expect(describeViolation('Waiting has no follow-up date.')).toBe(
      'Waiting has no follow-up date.',
    );
  });
});
