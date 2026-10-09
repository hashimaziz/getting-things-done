import { describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '@gtd/core';
import {
  SETUP_KEYS,
  buildFieldPlan,
  buildSetupPlan,
  choicesFromLabels,
  isSetupKey,
  suggestedCategories,
  validateSetup,
  type SetupState,
} from './plan';

const baseState: SetupState = {
  timezone: 'Europe/London',
  weekStartsOn: 1,
  categories: [{ localId: 'a', name: 'Work', description: null, color: null, fields: [] }],
};

describe('setup keys', () => {
  it('matches the keys core uses', () => {
    // The wizard writes settings by URL path, so a drift here writes the right
    // value to a key nothing reads. Silent, and permanent.
    expect(SETUP_KEYS.setupCompleted).toBe(SETTING_KEYS.setupCompleted);
    expect(SETUP_KEYS.timezone).toBe(SETTING_KEYS.timezone);
    expect(SETUP_KEYS.weekStartsOn).toBe(SETTING_KEYS.weekStartsOn);
  });

  it('recognises its own keys', () => {
    expect(isSetupKey(SETUP_KEYS.timezone)).toBe(true);
    expect(isSetupKey(SETUP_KEYS.setupCompleted)).toBe(true);
  });

  it('refuses a key that is not one of its own', () => {
    expect(isSetupKey('../../etc/passwd')).toBe(false);
    expect(isSetupKey('setup.completed.evil')).toBe(false);
  });
});

describe('buildSetupPlan', () => {
  it('writes the timezone and week start first', () => {
    const plan = buildSetupPlan(baseState);

    expect(plan.at(0)).toMatchObject({ method: 'PUT', path: `/settings/${SETUP_KEYS.timezone}` });
    expect(plan.at(1)).toMatchObject({
      method: 'PUT',
      path: `/settings/${SETUP_KEYS.weekStartsOn}`,
    });
    expect(plan.at(0)?.body).toEqual({ value: 'Europe/London' });
    expect(plan.at(1)?.body).toEqual({ value: 1 });
  });

  it('creates categories in the order they were entered', () => {
    const plan = buildSetupPlan({
      ...baseState,
      categories: [
        { localId: 'a', name: 'Work', description: null, color: null, fields: [] },
        { localId: 'b', name: 'Home', description: null, color: null, fields: [] },
      ],
    });

    const names = plan
      .filter((request) => request.path === '/categories')
      .map((request) => request.body.name);

    expect(names).toEqual(['Work', 'Home']);
  });

  it('passes the position through as sortOrder', () => {
    const plan = buildSetupPlan({
      ...baseState,
      categories: [
        { localId: 'a', name: 'Work', description: null, color: null, fields: [] },
        { localId: 'b', name: 'Home', description: null, color: null, fields: [] },
      ],
    });

    expect(plan.filter((r) => r.path === '/categories').map((r) => r.body.sortOrder)).toEqual([
      0, 1,
    ]);
  });

  it('omits an absent description rather than sending null', () => {
    const plan = buildSetupPlan(baseState);
    const category = plan.find((request) => request.path === '/categories');

    expect(category?.body).not.toHaveProperty('description');
  });

  it('includes a description when given', () => {
    const plan = buildSetupPlan({
      ...baseState,
      categories: [
        { localId: 'a', name: 'Work', description: 'Owed to an employer', color: null, fields: [] },
      ],
    });

    expect(plan.find((r) => r.path === '/categories')?.body.description).toBe(
      'Owed to an employer',
    );
  });

  it('names the category in the request purpose, so a failure is attributable', () => {
    const plan = buildSetupPlan(baseState);
    expect(plan.find((r) => r.path === '/categories')?.purpose).toBe('category "Work"');
  });

  it('creates no field requests, because fields need the id that does not exist yet', () => {
    const plan = buildSetupPlan(baseState);
    expect(plan.some((request) => request.path.includes('/fields'))).toBe(false);
  });

  it('writes settings before creating anything', () => {
    // If setup is interrupted after the first category, the app is already
    // configured enough to open and finish by hand. The reverse order leaves a
    // half-built app that claims to be finished.
    const plan = buildSetupPlan(baseState);
    const firstCategory = plan.findIndex((request) => request.path === '/categories');

    expect(firstCategory).toBeGreaterThan(plan.findIndex((request) => request.method === 'PUT'));
  });
});

describe('buildFieldPlan', () => {
  it('addresses the category id it was given', () => {
    const plan = buildFieldPlan('cat_1', [
      {
        label: 'Assigner',
        type: 'person',
        required: false,
        showInTable: false,
        filterable: true,
        sortable: false,
      },
    ]);

    expect(plan.at(0)?.path).toBe('/categories/cat_1/fields');
  });

  it('skips an unnamed field rather than creating a nameless one', () => {
    const plan = buildFieldPlan('cat_1', [
      {
        label: '   ',
        type: 'text',
        required: false,
        showInTable: false,
        filterable: false,
        sortable: false,
      },
    ]);

    expect(plan).toHaveLength(0);
  });

  it('numbers fields so their order is the order entered', () => {
    const plan = buildFieldPlan('cat_1', [
      {
        label: 'One',
        type: 'text',
        required: false,
        showInTable: false,
        filterable: false,
        sortable: false,
      },
      {
        label: 'Two',
        type: 'text',
        required: false,
        showInTable: false,
        filterable: false,
        sortable: false,
      },
    ]);

    expect(plan.map((request) => request.body.sortOrder)).toEqual([0, 1]);
  });

  it('sends choices for a choice-based type, in the order given', () => {
    const plan = buildFieldPlan('cat_1', [
      {
        label: 'Priority',
        type: 'priority',
        choices: ['High', 'Medium', 'Low'],
        required: false,
        showInTable: true,
        filterable: true,
        sortable: true,
      },
    ]);

    expect(plan.at(0)?.body.options).toEqual({
      kind: 'choices',
      choices: [
        { value: 'high', label: 'High', color: null, order: 0 },
        { value: 'medium', label: 'Medium', color: null, order: 1 },
        { value: 'low', label: 'Low', color: null, order: 2 },
      ],
    });
  });

  it('sends no options for a type that has none', () => {
    const plan = buildFieldPlan('cat_1', [
      {
        label: 'Notes on it',
        type: 'longtext',
        required: false,
        showInTable: false,
        filterable: false,
        sortable: false,
      },
    ]);

    expect(plan.at(0)?.body).not.toHaveProperty('options');
  });

  it('trims the label it sends', () => {
    const plan = buildFieldPlan('cat_1', [
      {
        label: '  Assigner  ',
        type: 'text',
        required: false,
        showInTable: false,
        filterable: false,
        sortable: false,
      },
    ]);

    expect(plan.at(0)?.body.label).toBe('Assigner');
  });

  it('passes the table, filter and sort choices through', () => {
    const plan = buildFieldPlan('cat_1', [
      {
        label: 'Priority',
        type: 'priority',
        required: true,
        showInTable: true,
        filterable: true,
        sortable: true,
      },
    ]);

    expect(plan.at(0)?.body).toMatchObject({
      showInTable: true,
      filterable: true,
      sortable: true,
      required: true,
    });
  });
});

describe('choicesFromLabels', () => {
  it('slugifies the value so filtering does not depend on capitalisation', () => {
    expect(choicesFromLabels(['High Priority']).at(0)?.value).toBe('high_priority');
  });

  it('drops empty entries', () => {
    expect(choicesFromLabels(['High', '  ', ''])).toHaveLength(1);
  });

  it('keeps the order it was given, which is the order the user meant', () => {
    expect(choicesFromLabels(['High', 'Medium', 'Low']).map((c) => c.order)).toEqual([0, 1, 2]);
  });
});

describe('validateSetup', () => {
  it('accepts a minimal valid state', () => {
    expect(validateSetup(baseState)).toEqual({});
  });

  it('requires a timezone', () => {
    expect(validateSetup({ ...baseState, timezone: '  ' }).timezone).toBeTruthy();
  });

  it('requires a category', () => {
    // Capture has to file things somewhere. An app whose inbox has no category is
    // an app that cannot accept a single item.
    const problems = validateSetup({ ...baseState, categories: [] });
    expect(problems.categories).toBeTruthy();
  });

  it('ignores an unnamed draft when a named category also exists', () => {
    // A half-filled "New category" row is not an error; it is a row in progress.
    // Failing on it would block someone who went back to fix a typo in the name.
    expect(
      validateSetup({
        ...baseState,
        categories: [
          { localId: 'a', name: 'Work', description: null, color: null, fields: [] },
          { localId: 'b', name: '   ', description: null, color: null, fields: [] },
        ],
      }),
    ).toEqual({});
  });

  it('treats an unnamed draft as no category at all', () => {
    expect(
      validateSetup({
        ...baseState,
        categories: [{ localId: 'a', name: '   ', description: null, color: null, fields: [] }],
      }).categories,
    ).toBeTruthy();
  });

  it('rejects two categories differing only in case', () => {
    // The server's duplicate-key constraint would reject the second anyway; saying
    // so up front is kinder than a failure two steps later.
    const problems = validateSetup({
      ...baseState,
      categories: [
        { localId: 'a', name: 'Work', description: null, color: null, fields: [] },
        { localId: 'b', name: 'work', description: null, color: null, fields: [] },
      ],
    });

    expect(problems.categories).toContain('work');
  });

  it('allows genuinely different categories', () => {
    expect(
      validateSetup({
        ...baseState,
        categories: [
          { localId: 'a', name: 'Work', description: null, color: null, fields: [] },
          { localId: 'b', name: 'Home', description: null, color: null, fields: [] },
        ],
      }),
    ).toEqual({});
  });

  it('rejects an out-of-range first day of the week', () => {
    expect(validateSetup({ ...baseState, weekStartsOn: 9 }).weekStartsOn).toBeTruthy();
    expect(validateSetup({ ...baseState, weekStartsOn: 6 })).toEqual({});
  });
});

describe('suggestions', () => {
  it('offers categories that are already complete enough to use', () => {
    const suggestions = suggestedCategories();

    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.name.trim()).not.toBe('');
      expect(validateSetup({ ...baseState, categories: [suggestion] })).toEqual({});
    }
  });

  it('gives the suggestions distinct template ids', () => {
    const ids = suggestedCategories().map((entry) => entry.localId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not decide the draft id, so accepting a suggestion twice gives two rows', () => {
    // `localId` is a template marker here. The wizard reassigns it on acceptance,
    // which is what keeps two accepted copies independently editable.
    expect(suggestedCategories().every((entry) => entry.localId.startsWith('suggested-'))).toBe(
      true,
    );
  });
});
