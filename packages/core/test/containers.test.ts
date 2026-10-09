import { describe, expect, it } from 'vitest';
import {
  ACTION_CONTAINERS,
  CONTAINERS,
  CONTAINER_SPECS,
  assertContainerInvariants,
  canTransition,
  checkTransition,
  containerLabel,
  inferContainer,
  isContainer,
  transitionsFrom,
  type Container,
  type ContainerSubject,
} from '../src/gtd/index.js';

describe('container registry', () => {
  it('declares a spec for every container', () => {
    for (const container of CONTAINERS) {
      expect(CONTAINER_SPECS[container]).toBeDefined();
      expect(CONTAINER_SPECS[container].container).toBe(container);
    }
  });

  it('gives every container a label and description', () => {
    for (const container of CONTAINERS) {
      expect(containerLabel(container)).toBeTruthy();
      expect(CONTAINER_SPECS[container].description).toBeTruthy();
    }
  });

  it('treats the three action containers as ground level', () => {
    expect([...ACTION_CONTAINERS].sort()).toEqual(['calendar', 'next_action', 'waiting']);
  });

  it('treats the inbox as a staging area, not a place of record', () => {
    expect(CONTAINER_SPECS.inbox.isTransient).toBe(true);
    expect(CONTAINER_SPECS.inbox.isActionContainer).toBe(false);
    expect(CONTAINER_SPECS.trash.isTransient).toBe(true);
  });

  it('reviews action containers daily', () => {
    expect(CONTAINER_SPECS.next_action.reviewCadence).toBe('daily');
    expect(CONTAINER_SPECS.calendar.reviewCadence).toBe('daily');
    expect(CONTAINER_SPECS.waiting.reviewCadence).toBe('weekly');
  });
});

describe('isContainer', () => {
  it('accepts a known container', () => {
    expect(isContainer('inbox')).toBe(true);
  });

  it.each(['INBOX', 'todo', '', null, 42, undefined])('rejects %s', (value) => {
    expect(isContainer(value)).toBe(false);
  });
});

describe('canTransition', () => {
  it('allows editing an item in place', () => {
    for (const container of CONTAINERS) {
      expect(canTransition(container, container)).toBe(true);
    }
  });

  it('lets a clarified item be completed', () => {
    expect(canTransition('next_action', 'done')).toBe(true);
    expect(canTransition('inbox', 'done')).toBe(true);
  });

  it('lets a calendar item drop its date and return to next actions', () => {
    expect(canTransition('calendar', 'next_action')).toBe(true);
  });

  it('never lets a clarified item fall back into the inbox', () => {
    const clarified: Container[] = CONTAINERS.filter(
      (container) => container !== 'inbox' && container !== 'trash',
    );
    for (const from of clarified) {
      expect(canTransition(from, 'inbox')).toBe(false);
    }
  });

  it('lets only trash return to the inbox', () => {
    expect(canTransition('trash', 'inbox')).toBe(true);
  });

  it('prevents trash from masquerading as reorganisation', () => {
    expect(canTransition('trash', 'next_action')).toBe(false);
    expect(canTransition('trash', 'done')).toBe(false);
    expect(canTransition('trash', 'calendar')).toBe(false);
  });

  it('allows reopening a completed item', () => {
    expect(canTransition('done', 'next_action')).toBe(true);
  });

  it('allows a waiting item to have its follow-up date extended', () => {
    // A self-transition is the in-place edit, which must always be legal.
    expect(canTransition('waiting', 'waiting')).toBe(true);
  });

  it('keeps someday out of the daily action pool', () => {
    expect(CONTAINER_SPECS.someday.isActionContainer).toBe(false);
  });
});

describe('transitionsFrom', () => {
  it('excludes the container itself', () => {
    expect(transitionsFrom('inbox')).not.toContain('inbox');
  });

  it('offers the inbox every clarification destination', () => {
    expect(transitionsFrom('inbox').sort()).toEqual(
      ['calendar', 'done', 'next_action', 'reference', 'someday', 'trash', 'waiting'].sort(),
    );
  });

  it('offers trash only the inbox', () => {
    expect(transitionsFrom('trash')).toEqual(['inbox']);
  });
});

describe('checkTransition', () => {
  it('accepts a legal move', () => {
    expect(checkTransition('inbox', 'next_action')).toEqual({ ok: true });
  });

  it('explains a refused move in user-facing terms', () => {
    const result = checkTransition('trash', 'done');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Trash');
      expect(result.reason).toContain('Completed');
    }
  });

  it('explains the inbox rule specifically', () => {
    const result = checkTransition('next_action', 'inbox');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('cannot move');
    }
  });
});

describe('assertContainerInvariants', () => {
  function subject(overrides: Partial<ContainerSubject> = {}): ContainerSubject {
    return {
      container: 'next_action',
      whenAt: null,
      waitingOnPersonId: null,
      followUpAt: null,
      projectId: null,
      ...overrides,
    };
  }

  it('passes for a next action with no required fields', () => {
    expect(assertContainerInvariants(subject())).toEqual([]);
  });

  it('requires a date for a calendar item', () => {
    const violations = assertContainerInvariants(subject({ container: 'calendar' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe('whenAt');
  });

  it('passes for a calendar item with a date', () => {
    expect(
      assertContainerInvariants(
        subject({ container: 'calendar', whenAt: '2026-10-08T09:30:00.000Z' }),
      ),
    ).toEqual([]);
  });

  it('requires both a person and a follow-up date for a waiting item', () => {
    const violations = assertContainerInvariants(subject({ container: 'waiting' }));
    expect(violations.map((v) => v.field).sort()).toEqual(['followUpAt', 'waitingOnPersonId']);
  });

  it('passes for a fully specified waiting item', () => {
    expect(
      assertContainerInvariants(
        subject({
          container: 'waiting',
          waitingOnPersonId: 'person-1',
          followUpAt: '2026-10-09T09:00:00.000Z',
        }),
      ),
    ).toEqual([]);
  });

  it('requires nothing for the inbox', () => {
    expect(assertContainerInvariants(subject({ container: 'inbox' }))).toEqual([]);
  });

  it('produces a message naming the container', () => {
    const violations = assertContainerInvariants(subject({ container: 'calendar' }));
    expect(violations[0]?.message).toContain('Calendar');
  });
});

describe('inferContainer', () => {
  it('routes to the calendar only for a hard date', () => {
    expect(inferContainer({ whenAt: '2026-10-08T09:00:00.000Z' })).toBe('calendar');
  });

  it('does not route to the calendar for a deadline alone', () => {
    // The calendar is the hard landscape. A deadline is an aspiration.
    expect(inferContainer({ whenAt: null })).toBe('next_action');
  });

  it('routes delegated work to waiting', () => {
    expect(inferContainer({ waitingOnPersonId: 'person-1' })).toBe('waiting');
  });

  it('prefers the calendar over waiting when both apply', () => {
    expect(inferContainer({ whenAt: '2026-10-08T09:00:00.000Z', waitingOnPersonId: 'p1' })).toBe(
      'calendar',
    );
  });

  it('prefers done over everything', () => {
    expect(inferContainer({ completed: true, whenAt: '2026-10-08T09:00:00.000Z' })).toBe('done');
  });

  it('prefers trash over everything', () => {
    expect(inferContainer({ trashed: true, completed: true })).toBe('trash');
  });

  it('defaults to next actions', () => {
    expect(inferContainer({})).toBe('next_action');
  });
});
