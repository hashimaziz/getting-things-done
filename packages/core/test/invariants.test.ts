import { describe, expect, it } from 'vitest';
import {
  REVIEW_PHASES,
  WEEKLY_REVIEW_STEPS,
  checkInvariants,
  groupWaitingByPerson,
  summariseReview,
} from '../src/invariants.js';
import type { Item, Project } from '../src/entities.js';
import { addDays } from '../src/dates/index.js';

const TODAY = '2026-03-02' as const;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    categoryId: 'c1',
    title: 'A thing',
    container: 'next_action',
    notes: null,
    whenAt: null,
    deadlineOn: null,
    estimateMinutes: 15,
    projectId: null,
    waitingOnPersonId: null,
    followUpAt: null,
    contextIds: [],
    recurrenceId: null,
    parentItemId: null,
    occurrenceDate: null,
    isTemplate: false,
    data: {},
    sortOrder: 0,
    createdAt: `${TODAY}T09:00:00.000Z`,
    updatedAt: `${TODAY}T09:00:00.000Z`,
    completedAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Health',
    outcome: null,
    categoryId: 'c1',
    status: 'active',
    reviewAt: null,
    completedAt: null,
    createdAt: `${TODAY}T09:00:00.000Z`,
    updatedAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

function kinds(violations: ReturnType<typeof checkInvariants>): string[] {
  return violations.map((violation) => violation.kind);
}

describe('checkInvariants', () => {
  it('reports nothing for a healthy system', () => {
    // openWithout_estimate is a warning, so a healthy item needs an estimate.
    expect(checkInvariants([item()], [], { today: TODAY })).toEqual([]);
  });

  it('reports an active project with nothing to do', () => {
    const violations = checkInvariants([], [project()], { today: TODAY });
    expect(kinds(violations)).toContain('project_without_next_action');
    expect(violations[0]?.projectIds).toEqual(['p1']);
  });

  it('accepts a project with any open item attached', () => {
    expect(
      kinds(checkInvariants([item({ projectId: 'p1' })], [project()], { today: TODAY })),
    ).not.toContain('project_without_next_action');
  });

  it('does not count a completed item as a project next action', () => {
    const violations = checkInvariants(
      [item({ projectId: 'p1', container: 'done', completedAt: `${TODAY}T09:00:00.000Z` })],
      [project()],
      { today: TODAY },
    );
    expect(kinds(violations)).toContain('project_without_next_action');
  });

  it('ignores projects that are not active', () => {
    expect(
      kinds(checkInvariants([], [project({ status: 'someday' })], { today: TODAY })),
    ).not.toContain('project_without_next_action');
  });

  it('reports waiting work with no follow-up date', () => {
    const violations = checkInvariants(
      [item({ container: 'waiting', waitingOnPersonId: 'person-1', followUpAt: null })],
      [],
      { today: TODAY },
    );
    expect(kinds(violations)).toContain('waiting_without_follow_up');
  });

  it('reports waiting work with no person', () => {
    const violations = checkInvariants(
      [
        item({
          container: 'waiting',
          waitingOnPersonId: null,
          followUpAt: '2026-03-10T09:00:00.000Z',
        }),
      ],
      [],
      { today: TODAY },
    );
    expect(kinds(violations)).toContain('waiting_without_follow_up');
  });

  it('reports a calendar item with no date', () => {
    const violations = checkInvariants([item({ container: 'calendar', whenAt: null })], [], {
      today: TODAY,
    });
    expect(kinds(violations)).toContain('calendar_without_date');
  });

  it('reports a stale inbox item', () => {
    const old = item({
      container: 'inbox',
      createdAt: `${addDays(TODAY, -10)}T09:00:00.000Z`,
    });
    expect(kinds(checkInvariants([old], [], { today: TODAY }))).toContain('stale_inbox_item');
  });

  it('leaves a recent inbox item alone', () => {
    const recent = item({
      container: 'inbox',
      createdAt: `${addDays(TODAY, -2)}T09:00:00.000Z`,
    });
    expect(kinds(checkInvariants([recent], [], { today: TODAY }))).not.toContain(
      'stale_inbox_item',
    );
  });

  it('honours a custom staleness threshold', () => {
    const threeDays = item({
      container: 'inbox',
      createdAt: `${addDays(TODAY, -3)}T09:00:00.000Z`,
    });
    expect(kinds(checkInvariants([threeDays], [], { today: TODAY }))).not.toContain(
      'stale_inbox_item',
    );
    expect(kinds(checkInvariants([threeDays], [], { today: TODAY, staleInboxDays: 2 }))).toContain(
      'stale_inbox_item',
    );
  });

  it('reports a completed item with no completion time', () => {
    const violations = checkInvariants([item({ container: 'done', completedAt: null })], [], {
      today: TODAY,
    });
    expect(kinds(violations)).toContain('completed_without_timestamp');
  });

  it('reports a next action with no estimate, as a warning', () => {
    const violations = checkInvariants([item({ estimateMinutes: null })], [], { today: TODAY });
    const entry = violations.find((v) => v.kind === 'open_without_estimate');
    expect(entry?.severity).toBe('warning');
  });

  it('separates errors from warnings, errors first', () => {
    const violations = checkInvariants(
      [item({ estimateMinutes: null }), item({ container: 'calendar', whenAt: null })],
      [],
      { today: TODAY },
    );
    expect(violations[0]?.severity).toBe('error');
    expect(violations.at(-1)?.severity).toBe('warning');
  });

  it('excludes series templates from the open checks', () => {
    // A template legitimately has no estimate and no date; it is a series
    // definition, not a task.
    const template = item({
      container: 'calendar',
      whenAt: null,
      estimateMinutes: null,
      isTemplate: true,
    });
    expect(checkInvariants([template], [], { today: TODAY })).toEqual([]);
  });

  it('does not double-report an item in two kinds', () => {
    const violations = checkInvariants(
      [
        item({
          container: 'waiting',
          waitingOnPersonId: null,
          followUpAt: null,
          estimateMinutes: 5,
        }),
      ],
      [],
      { today: TODAY },
    );
    const reported = violations.flatMap((violation) => violation.itemIds);
    expect(new Set(reported).size).toBe(reported.length);
  });

  it('gives every violation a user-facing message', () => {
    const violations = checkInvariants([], [project()], { today: TODAY });
    for (const violation of violations) {
      expect(violation.message).toBeTruthy();
      expect(violation.message).not.toMatch(/undefined/);
    }
  });

  it('reports an empty system as clean', () => {
    expect(checkInvariants([], [], { today: TODAY })).toEqual([]);
  });
});

describe('groupWaitingByPerson', () => {
  it('groups by the person being waited on', () => {
    const groups = groupWaitingByPerson(
      [
        item({
          id: 'a',
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-10T09:00:00.000Z',
        }),
        item({
          id: 'b',
          container: 'waiting',
          waitingOnPersonId: 'sam',
          followUpAt: '2026-03-11T09:00:00.000Z',
        }),
        item({
          id: 'c',
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-12T09:00:00.000Z',
        }),
      ],
      { today: TODAY },
    );
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.personId === 'dana')?.items).toHaveLength(2);
  });

  it('keeps items waiting on nobody in their own group', () => {
    const groups = groupWaitingByPerson([item({ container: 'waiting', waitingOnPersonId: null })], {
      today: TODAY,
    });
    expect(groups[0]?.personId).toBeNull();
  });

  it('ignores items that are not waiting', () => {
    expect(groupWaitingByPerson([item({ container: 'next_action' })], { today: TODAY })).toEqual(
      [],
    );
  });

  it('counts items past their follow-up date', () => {
    const groups = groupWaitingByPerson(
      [
        item({
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-01T09:00:00.000Z',
        }),
        item({
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-20T09:00:00.000Z',
        }),
      ],
      { today: TODAY },
    );
    expect(groups[0]?.overdue).toBe(1);
  });

  it('reports how long the group has been outstanding', () => {
    const groups = groupWaitingByPerson(
      [
        item({
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-20T09:00:00.000Z',
          createdAt: `${addDays(TODAY, -30)}T09:00:00.000Z`,
        }),
      ],
      { today: TODAY },
    );
    expect(groups[0]?.oldestDays).toBe(30);
  });

  it('flags a group needing attention', () => {
    const groups = groupWaitingByPerson(
      [
        item({
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-20T09:00:00.000Z',
          createdAt: `${addDays(TODAY, -30)}T09:00:00.000Z`,
        }),
      ],
      { today: TODAY, staleAfterDays: 7 },
    );
    expect(groups[0]?.needsAttention).toBe(true);
  });

  it('can omit settled groups', () => {
    const groups = groupWaitingByPerson(
      [
        item({
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-20T09:00:00.000Z',
        }),
      ],
      { today: TODAY, includeSettled: false },
    );
    expect(groups).toEqual([]);
  });

  it('puts groups needing attention first', () => {
    const groups = groupWaitingByPerson(
      [
        item({
          id: 'settled',
          container: 'waiting',
          waitingOnPersonId: 'sam',
          followUpAt: '2026-03-20T09:00:00.000Z',
        }),
        item({
          id: 'stale',
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-20T09:00:00.000Z',
          createdAt: `${addDays(TODAY, -60)}T09:00:00.000Z`,
        }),
      ],
      { today: TODAY, staleAfterDays: 7 },
    );
    expect(groups.map((group) => group.personId)).toEqual(['dana', 'sam']);
  });

  it('sorts within a group by follow-up date', () => {
    const groups = groupWaitingByPerson(
      [
        item({
          id: 'later',
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-20T09:00:00.000Z',
        }),
        item({
          id: 'sooner',
          container: 'waiting',
          waitingOnPersonId: 'dana',
          followUpAt: '2026-03-05T09:00:00.000Z',
        }),
      ],
      { today: TODAY },
    );
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(['sooner', 'later']);
  });
});

describe('the weekly review definition', () => {
  it('follows the official phase structure', () => {
    expect(REVIEW_PHASES.map((phase) => phase.id)).toEqual([
      'get_clear',
      'get_current',
      'get_creative',
    ]);
  });

  it('covers all three phases', () => {
    const phases = new Set(WEEKLY_REVIEW_STEPS.map((step) => step.phase));
    expect(phases).toEqual(new Set(['get_clear', 'get_current', 'get_creative']));
  });

  it('gives every step a title and a description', () => {
    for (const step of WEEKLY_REVIEW_STEPS) {
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
      expect(step.description.length).toBeGreaterThan(20);
    }
  });

  it('uses unique ids', () => {
    const ids = WEEKLY_REVIEW_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts with emptying the inbox, which Allen lists first', () => {
    expect(WEEKLY_REVIEW_STEPS[1]?.id).toBe('process_inbox');
  });

  it('includes the projects step, which is where the invariant lives', () => {
    expect(WEEKLY_REVIEW_STEPS.map((step) => step.id)).toContain('review_projects');
  });

  it('ends with the wider horizon, as a weekly review should', () => {
    expect(WEEKLY_REVIEW_STEPS.at(-1)?.phase).toBe('get_creative');
  });
});

describe('summariseReview', () => {
  it('reports every step', () => {
    const progress = summariseReview([], [], { today: TODAY });
    expect(progress).toHaveLength(WEEKLY_REVIEW_STEPS.length);
  });

  it('counts the inbox backlog against the clearing steps', () => {
    const progress = summariseReview(
      [item({ container: 'inbox' }), item({ container: 'inbox' })],
      [],
      { today: TODAY },
    );
    const processInbox = progress.find((entry) => entry.step.id === 'process_inbox');
    expect(processInbox?.pending).toBe(2);
    expect(processInbox?.satisfied).toBe(false);
  });

  it('marks a step satisfied when there is nothing to do', () => {
    const progress = summariseReview([], [], { today: TODAY });
    expect(progress.every((entry) => entry.satisfied)).toBe(true);
  });

  it('counts active projects against the projects step', () => {
    const progress = summariseReview([item({ projectId: 'p1' })], [project()], { today: TODAY });
    const projects = progress.find((entry) => entry.step.id === 'review_projects');
    expect(projects?.pending).toBe(1);
    expect(projects?.problems).toBe(0);
  });

  it('surfaces a stalled project as a problem on the projects step', () => {
    const progress = summariseReview([], [project()], { today: TODAY });
    const projects = progress.find((entry) => entry.step.id === 'review_projects');
    expect(projects?.problems).toBe(1);
    expect(projects?.satisfied).toBe(false);
  });

  it('surfaces a missing follow-up on the waiting step', () => {
    const progress = summariseReview(
      [item({ container: 'waiting', waitingOnPersonId: 'p1', followUpAt: null })],
      [],
      { today: TODAY },
    );
    const waiting = progress.find((entry) => entry.step.id === 'review_waiting');
    expect(waiting?.problems).toBe(1);
  });

  it('splits the calendar into past and upcoming', () => {
    const progress = summariseReview(
      [
        item({ container: 'calendar', whenAt: `${addDays(TODAY, -2)}T09:00:00.000Z` }),
        item({ container: 'calendar', whenAt: `${addDays(TODAY, 3)}T09:00:00.000Z` }),
      ],
      [],
      { today: TODAY },
    );
    expect(progress.find((e) => e.step.id === 'review_past_calendar')?.pending).toBe(1);
    expect(progress.find((e) => e.step.id === 'review_upcoming_calendar')?.pending).toBe(1);
  });

  it('counts someday items', () => {
    const progress = summariseReview([item({ container: 'someday' })], [], { today: TODAY });
    expect(progress.find((e) => e.step.id === 'review_someday')?.pending).toBe(1);
  });

  it('ignores series templates', () => {
    const progress = summariseReview([item({ container: 'inbox', isTemplate: true })], [], {
      today: TODAY,
    });
    expect(progress.find((e) => e.step.id === 'process_inbox')?.pending).toBe(0);
  });

  it('reports the goals step as satisfying by default', () => {
    // Goals are a roadmap item, so the step exists but has nothing to count yet.
    const progress = summariseReview([], [], { today: TODAY });
    expect(progress.find((e) => e.step.id === 'review_goals')?.satisfied).toBe(true);
  });
});
