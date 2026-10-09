import { beforeEach, describe, expect, it } from 'vitest';
import {
  RULE_PROVIDER_ID,
  RuleBasedProvider,
  UnknownProviderError,
  createDefaultRegistry,
  type Recommendation,
  type RecommendationContext,
  type RecommendationData,
  type RecommendationProvider,
} from '../src/recommendations/index.js';
import { checkInvariants, type SystemViolation } from '../src/invariants.js';
import type { Category, Context, Item, Person, Project } from '../src/entities.js';
import type { FieldDefinition } from '../src/fields/index.js';
import { createFieldDefinition } from '../src/fields/definition.js';

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

const PRIORITY: FieldDefinition = createFieldDefinition({
  label: 'Priority',
  type: 'priority',
  options: {
    kind: 'choices',
    choices: [
      { value: 'low', label: 'Low', color: null, order: 2 },
      { value: 'medium', label: 'Medium', color: null, order: 1 },
      { value: 'high', label: 'High', color: null, order: 0 },
    ],
  },
});

function data(overrides: Partial<RecommendationData> = {}): RecommendationData {
  return {
    items: [],
    projects: [],
    people: [] as Person[],
    contexts: [] as Context[],
    categories: [{ id: 'c1', name: 'Work' } as Category],
    violations: [] as SystemViolation[],
    definitions: [PRIORITY],
    ...overrides,
  };
}

function context(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return { today: TODAY, timezone: 'UTC', focus: 'what_next', ...overrides };
}

let provider: RuleBasedProvider;

beforeEach(() => {
  provider = new RuleBasedProvider();
});

/** Titles of the suggestions, for readable ordering assertions. */
function titles(result: Recommendation[]): string[] {
  return result.map((entry) => entry.title);
}

describe('the provider contract', () => {
  it('is named, and declares that it needs no model', () => {
    expect(provider.id).toBe(RULE_PROVIDER_ID);
    expect(provider.requiresModel).toBe(false);
    expect(provider.label).toBeTruthy();
  });

  it('returns a promise, so a model provider can be substituted', async () => {
    // A provider that cannot be awaited cannot be replaced by one that can.
    const pending = provider.suggest(context(), data());
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });

  it('gives every recommendation a reason', async () => {
    const result = await provider.suggest(
      context(),
      data({
        items: [
          item({ deadlineOn: '2026-03-01' }),
          item({
            container: 'waiting',
            followUpAt: '2026-03-01T09:00:00.000Z',
            waitingOnPersonId: 'p',
          }),
        ],
        violations: checkInvariants([], [project()], { today: TODAY }),
      }),
    );
    for (const entry of result) {
      expect(entry.reason).toBeTruthy();
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('gives every recommendation a confidence in range', async () => {
    const result = await provider.suggest(context(), data({ items: [item()] }));
    for (const entry of result) {
      expect(entry.confidence).toBeGreaterThanOrEqual(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('gives every recommendation a unique id', async () => {
    const result = await provider.suggest(
      context(),
      data({ items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })] }),
    );
    const ids = result.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic', async () => {
    const snapshot = data({
      items: [item({ id: 'a' }), item({ id: 'b', deadlineOn: '2026-03-01' })],
    });
    const first = await provider.suggest(context(), snapshot);
    const second = await provider.suggest(context(), snapshot);
    expect(second).toEqual(first);
  });
});

describe('what next', () => {
  it('suggests nothing when there is nothing open', async () => {
    expect(await provider.suggest(context(), data())).toEqual([]);
  });

  it('puts an overdue item above one that is not', async () => {
    const result = await provider.suggest(
      context(),
      data({
        items: [
          item({ id: 'calm', title: 'Calm task' }),
          item({ id: 'urgent', title: 'Overdue task', deadlineOn: '2026-03-01' }),
        ],
      }),
    );
    expect(titles(result)[0]).toBe('Overdue task');
  });

  it('orders by how near the deadline is', async () => {
    const result = await provider.suggest(
      context(),
      data({
        items: [
          item({ id: 'far', title: 'Far', deadlineOn: '2026-06-01' }),
          item({ id: 'soon', title: 'Soon', deadlineOn: '2026-03-03' }),
        ],
      }),
    );
    expect(titles(result)).toEqual(['Soon', 'Far']);
  });

  it('reads the user priority scale rather than hardcoding one', async () => {
    // High is order 0 in this scale, so it must outrank low.
    const result = await provider.suggest(
      context(),
      data({
        items: [
          item({ id: 'low', title: 'Low priority', data: { priority: 'low' } }),
          item({ id: 'high', title: 'High priority', data: { priority: 'high' } }),
        ],
      }),
    );
    expect(titles(result)[0]).toBe('High priority');
  });

  it('survives a priority scale ordered the other way round', async () => {
    // If the user's first choice were "low", reading order as urgency would
    // invert every ranking. The scale is read as authoritative either way.
    const inverted = createFieldDefinition({
      label: 'Priority',
      type: 'priority',
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 0 },
          { value: 'high', label: 'High', color: null, order: 1 },
        ],
      },
    });
    const result = await provider.suggest(
      context(),
      data({
        definitions: [inverted],
        items: [
          item({ id: 'low', title: 'Low priority', data: { priority: 'low' } }),
          item({ id: 'high', title: 'High priority', data: { priority: 'high' } }),
        ],
      }),
    );
    expect(titles(result)[0]).toBe('Low priority');
  });

  it('works with no priority field at all', async () => {
    const result = await provider.suggest(
      context(),
      data({ definitions: [], items: [item({ title: 'Plain' })] }),
    );
    expect(titles(result)).toEqual(['Plain']);
  });

  it('suggests a calendar item due today first', async () => {
    const result = await provider.suggest(
      context(),
      data({
        items: [
          item({ id: 'plain', title: 'Plain' }),
          item({
            id: 'today',
            title: 'Standup',
            container: 'calendar',
            whenAt: `${TODAY}T09:00:00.000Z`,
          }),
        ],
      }),
    );
    expect(titles(result)[0]).toBe('Standup');
  });

  it('honours the limit', async () => {
    const result = await provider.suggest(
      context({ limit: 2 }),
      data({ items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' }), item({ id: 'd' })] }),
    );
    expect(result).toHaveLength(2);
  });

  it('excludes items that are not actionable', async () => {
    const result = await provider.suggest(
      context(),
      data({
        items: [
          item({ id: 'a', container: 'someday' }),
          item({ id: 'b', container: 'done' }),
          item({ id: 'c', container: 'reference' }),
        ],
      }),
    );
    expect(result).toEqual([]);
  });

  it('excludes series templates', async () => {
    const result = await provider.suggest(context(), data({ items: [item({ isTemplate: true })] }));
    expect(result).toEqual([]);
  });

  it('mentions every item when nothing distinguishes them', async () => {
    // With everything tied, ordering must be stable rather than arbitrary.
    const result = await provider.suggest(
      context({ limit: 5 }),
      data({ items: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item({ id })) }),
    );
    expect(result).toHaveLength(5);
    expect(result.map((entry) => entry.rank)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('the four engagement criteria', () => {
  it('excludes an item that does not fit the time available', async () => {
    const result = await provider.suggest(
      context({ timeAvailableMinutes: 10 }),
      data({ items: [item({ id: 'long', title: 'Long one', estimateMinutes: 120 })] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toContain('more than the 10m available');
  });

  it('prefers something that fits', async () => {
    const result = await provider.suggest(
      context({ timeAvailableMinutes: 60 }),
      data({
        items: [
          item({ id: 'long', title: 'Long one', estimateMinutes: 120 }),
          item({ id: 'short', title: 'Short one', estimateMinutes: 20 }),
        ],
      }),
    );
    expect(titles(result)[0]).toBe('Short one');
  });

  it('treats an unstated time as unconstrained', async () => {
    const result = await provider.suggest(
      context({ timeAvailableMinutes: null }),
      data({ items: [item({ title: 'Long one', estimateMinutes: 600 })] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).not.toContain('available');
  });

  it('prefers a short task when energy is low', async () => {
    const result = await provider.suggest(
      context({ energy: 'low' }),
      data({
        items: [
          item({ id: 'long', title: 'Long one', estimateMinutes: 90 }),
          item({ id: 'short', title: 'Short one', estimateMinutes: 10 }),
        ],
      }),
    );
    expect(titles(result)[0]).toBe('Short one');
  });

  it('excludes items outside the stated context', async () => {
    const result = await provider.suggest(
      context({ contextIds: ['ctx-office'] }),
      data({
        items: [
          item({ id: 'here', title: 'Here', contextIds: ['ctx-office'] }),
          item({ id: 'elsewhere', title: 'Elsewhere', contextIds: ['ctx-home'] }),
        ],
      }),
    );
    expect(titles(result)).toEqual(['Here']);
  });

  it('treats an unstated context as everywhere', async () => {
    // Null must mean "not stated", not "nothing matches", or the whole feature
    // returns nothing whenever a caller omits the field.
    const result = await provider.suggest(
      context({ contextIds: null }),
      data({ items: [item({ title: 'Anywhere', contextIds: ['ctx-home'] })] }),
    );
    expect(titles(result)).toEqual(['Anywhere']);
  });

  it('boosts an item that is getting old', async () => {
    const result = await provider.suggest(
      context(),
      data({
        items: [
          item({ id: 'fresh', title: 'Fresh', createdAt: `${TODAY}T09:00:00.000Z` }),
          item({ id: 'old', title: 'Old', createdAt: '2026-01-02T09:00:00.000Z' }),
        ],
      }),
    );
    expect(titles(result)[0]).toBe('Old');
  });

  it('mentions why an ageing item was suggested', async () => {
    const result = await provider.suggest(
      context(),
      data({ items: [item({ title: 'Old', createdAt: '2026-01-02T09:00:00.000Z' })] }),
    );
    expect(result[0]?.reason).toContain('not touched');
  });
});

describe('overdue', () => {
  it('reports overdue items with the number of days', async () => {
    // 2026-02-27 to 2026-03-02 is three days.
    const result = await provider.suggest(
      context({ focus: 'overdue' }),
      data({ items: [item({ title: 'Late', deadlineOn: '2026-02-27' })] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('flag_risk');
    expect(result[0]?.reason).toContain('3 days ago');
  });

  it('uses the singular for one day', async () => {
    const result = await provider.suggest(
      context({ focus: 'overdue' }),
      data({ items: [item({ deadlineOn: '2026-03-01' })] }),
    );
    expect(result[0]?.reason).toContain('1 day ago');
  });

  it('ignores items that are not overdue', async () => {
    const result = await provider.suggest(
      context({ focus: 'overdue' }),
      data({ items: [item({ deadlineOn: TODAY }), item({ deadlineOn: '2026-12-01' })] }),
    );
    expect(result).toEqual([]);
  });

  it('ignores items with no deadline', async () => {
    expect(
      await provider.suggest(context({ focus: 'overdue' }), data({ items: [item()] })),
    ).toEqual([]);
  });

  it('reports the most overdue first', async () => {
    const result = await provider.suggest(
      context({ focus: 'overdue' }),
      data({
        items: [
          item({ id: 'a', title: 'Slightly', deadlineOn: '2026-03-01' }),
          item({ id: 'b', title: 'Very', deadlineOn: '2025-12-01' }),
        ],
      }),
    );
    expect(result.map((entry) => entry.itemId)).toEqual(['b', 'a']);
  });

  it('is fully confident about a fact it can count', async () => {
    const result = await provider.suggest(
      context({ focus: 'overdue' }),
      data({ items: [item({ deadlineOn: '2026-03-01' })] }),
    );
    expect(result[0]?.confidence).toBe(1);
  });
});

describe('waiting', () => {
  const dana = { id: 'dana', name: 'Dana' } as Person;

  it('names the person being chased', async () => {
    const result = await provider.suggest(
      context({ focus: 'waiting' }),
      data({
        people: [dana],
        items: [
          item({
            title: 'Send the report',
            container: 'waiting',
            waitingOnPersonId: 'dana',
            followUpAt: '2026-03-01T09:00:00.000Z',
          }),
        ],
      }),
    );
    expect(result[0]?.title).toContain('Dana');
    expect(result[0]?.title).toContain('Send the report');
  });

  it('only reports items past their follow-up date', async () => {
    const result = await provider.suggest(
      context({ focus: 'waiting' }),
      data({
        people: [dana],
        items: [
          item({
            id: 'late',
            container: 'waiting',
            waitingOnPersonId: 'dana',
            followUpAt: '2026-03-01T09:00:00.000Z',
          }),
          item({
            id: 'soon',
            container: 'waiting',
            waitingOnPersonId: 'dana',
            followUpAt: '2026-03-20T09:00:00.000Z',
          }),
        ],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.itemId).toBe('late');
  });
});

describe('stalled projects', () => {
  it('reports an active project with no next action', async () => {
    const result = await provider.suggest(
      context({ focus: 'stalled_projects' }),
      data({
        projects: [project({ id: 'p1', name: 'Health' })],
        violations: checkInvariants([], [project({ id: 'p1', name: 'Health' })], { today: TODAY }),
      }),
    );
    expect(result[0]?.kind).toBe('ask_question');
    expect(result[0]?.title).toContain('Health');
  });

  it('offers three ways out, since stopping is a legitimate answer', async () => {
    const result = await provider.suggest(
      context({ focus: 'stalled_projects' }),
      data({
        projects: [project()],
        violations: checkInvariants([], [project()], { today: TODAY }),
      }),
    );
    expect(result[0]?.reason).toContain('Someday');
    expect(result[0]?.reason).toContain('drop');
  });

  it('says nothing when every project has work', async () => {
    const result = await provider.suggest(
      context({ focus: 'stalled_projects' }),
      data({ projects: [project()], items: [item({ projectId: 'p1' })] }),
    );
    expect(result).toEqual([]);
  });
});

describe('schedule', () => {
  it('proposes tasks that fit the slot', async () => {
    const result = await provider.suggest(
      context({ focus: 'schedule', timeAvailableMinutes: 60 }),
      data({
        items: [
          item({ id: 'a', title: 'Fits', estimateMinutes: 45 }),
          item({ id: 'b', title: 'Too big', estimateMinutes: 300 }),
        ],
      }),
    );
    expect(titles(result).some((title) => title.includes('Fits'))).toBe(true);
    expect(titles(result).some((title) => title.includes('Too big'))).toBe(false);
  });

  it('fills the largest task that fits first', async () => {
    const result = await provider.suggest(
      context({ focus: 'schedule', timeAvailableMinutes: 60 }),
      data({
        items: [
          item({ id: 'small', title: 'Small', estimateMinutes: 5 }),
          item({ id: 'big', title: 'Big', estimateMinutes: 50 }),
        ],
      }),
    );
    // Largest first, so the big task goes in before the small one rather than the
    // slot being filled with whichever happened to come first.
    expect(result[0]?.title).toContain('60 minutes');
    expect(result[0]?.reason).toContain('55 of 60 minutes');
    expect(result.slice(1).map((entry) => entry.title)).toEqual(['Big', 'Small']);
  });

  it('does not overfill the slot', async () => {
    // Two 40-minute tasks cannot both go in a 60-minute slot.
    const result = await provider.suggest(
      context({ focus: 'schedule', timeAvailableMinutes: 60 }),
      data({
        items: [item({ id: 'a', estimateMinutes: 40 }), item({ id: 'b', estimateMinutes: 40 })],
      }),
    );
    expect(result.filter((entry) => entry.itemId !== undefined)).toHaveLength(1);
    expect(result[0]?.reason).toContain('40 of 60 minutes');
  });

  it('fills the leftover space once a big task does not fit again', async () => {
    // 40 + 40 exceeds the slot, but the 5-minute task still fits in what is left,
    // and leaving it out would waste real capacity.
    const result = await provider.suggest(
      context({ focus: 'schedule', timeAvailableMinutes: 60 }),
      data({
        items: [
          item({ id: 'a', estimateMinutes: 40 }),
          item({ id: 'b', estimateMinutes: 40 }),
          item({ id: 'c', estimateMinutes: 5 }),
        ],
      }),
    );
    // The first entry is the summary, which has no item.
    expect(result.map((entry) => entry.itemId).filter(Boolean)).toEqual(['a', 'c']);
    expect(result[0]?.reason).toContain('45 of 60 minutes');
  });

  it('says plainly when nothing honestly fits', async () => {
    // Filling a slot with something that does not fit is how a schedule becomes
    // fiction, which is what the calendar warning in the method is about.
    const result = await provider.suggest(
      context({ focus: 'schedule', timeAvailableMinutes: 10 }),
      data({ items: [item({ estimateMinutes: 600 })] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toContain('nothing that honestly fits');
    expect(result[0]?.confidence).toBeLessThan(0.5);
  });

  it('skips items with no estimate, since they cannot be shown to fit', async () => {
    const result = await provider.suggest(
      context({ focus: 'schedule', timeAvailableMinutes: 60 }),
      data({ items: [item({ estimateMinutes: null })] }),
    );
    expect(result.filter((entry) => entry.itemId !== undefined)).toEqual([]);
  });
});

describe('the daily review', () => {
  it('combines the useful parts', async () => {
    const result = await provider.suggest(
      context({ focus: 'daily_review' }),
      data({
        items: [
          item({ id: 'a', title: 'Overdue thing', deadlineOn: '2026-03-01' }),
          item({
            id: 'b',
            title: 'Waiting thing',
            container: 'waiting',
            waitingOnPersonId: 'x',
            followUpAt: '2026-03-01T09:00:00.000Z',
          }),
        ],
        projects: [project()],
        violations: checkInvariants([], [project()], { today: TODAY }),
      }),
    );
    const all = titles(result).join(' | ');
    expect(all).toContain('Overdue thing');
    expect(all).toContain('Health');
  });

  it('respects the limit across the combined output', async () => {
    const result = await provider.suggest(
      context({ focus: 'daily_review', limit: 2 }),
      data({ items: ['a', 'b', 'c', 'd'].map((id) => item({ id })) }),
    );
    expect(result).toHaveLength(2);
  });
});

describe('the registry', () => {
  it('serves a provider by name', () => {
    const registry = createDefaultRegistry();
    expect(registry.get(RULE_PROVIDER_ID).id).toBe(RULE_PROVIDER_ID);
  });

  it('lists what is available, for a settings screen', () => {
    expect(createDefaultRegistry().list()).toEqual([
      { id: RULE_PROVIDER_ID, label: 'Built-in rules', requiresModel: false },
    ]);
  });

  it('throws for an unknown provider rather than silently defaulting', () => {
    // A caller must ask for a provider by name. Defaulting silently would mean a
    // request could be served by the wrong engine without anyone noticing.
    expect(() => createDefaultRegistry().get('llama')).toThrow(UnknownProviderError);
  });

  it('refuses to register the same id twice', () => {
    const registry = createDefaultRegistry();
    expect(() => registry.register(new RuleBasedProvider())).toThrow(/already registered/);
  });

  it('can hold a second, different provider', async () => {
    // This is the shape a future local model plugs into.
    const modelLike: RecommendationProvider = {
      id: 'test-model',
      label: 'A model',
      requiresModel: true,
      suggest: async () => [
        {
          id: 'from-model',
          kind: 'suggest_action',
          title: 'Model said this',
          detail: '',
          reason: 'because the model said so',
          confidence: 0.6,
          tags: ['model'],
          rank: 0,
        },
      ],
    };

    const registry = createDefaultRegistry().register(modelLike);
    expect(registry.list()).toHaveLength(2);
    expect(registry.get('test-model').requiresModel).toBe(true);

    const fromRules = await registry.get(RULE_PROVIDER_ID).suggest(context(), data());
    const fromModel = await registry.get('test-model').suggest(context(), data());
    expect(fromRules).toEqual([]);
    expect(fromModel).toHaveLength(1);
  });

  it('reports whether a provider is available', () => {
    const registry = createDefaultRegistry();
    expect(registry.has(RULE_PROVIDER_ID)).toBe(true);
    expect(registry.has('llama')).toBe(false);
  });
});
