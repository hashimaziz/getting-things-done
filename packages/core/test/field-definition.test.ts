import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  normaliseOptions,
  resolveDefinitionsForCategory,
  safeParseFieldDefinition,
  sortFieldDefinitions,
  type FieldOptions,
} from '../src/fields/index.js';

const CHOICES: FieldOptions = {
  kind: 'choices',
  choices: [
    { value: 'bug', label: 'Bug', color: '#f00', order: 0 },
    { value: 'task', label: 'Task', color: null, order: 1 },
  ],
};

describe('createFieldDefinition', () => {
  it('derives a key from the label', () => {
    expect(createFieldDefinition({ label: 'Complete By', type: 'date' }).key).toBe('complete_by');
  });

  it('de-duplicates a derived key against existing ones', () => {
    const definition = createFieldDefinition({
      label: 'Complete By',
      type: 'date',
      existingKeys: ['complete_by'],
    });
    expect(definition.key).toBe('complete_by_2');
  });

  it('does not silently rename an explicit key', () => {
    // An explicit key must survive verbatim so the reserved-word check, not
    // quiet renaming, decides its fate.
    expect(() =>
      createFieldDefinition({ label: 'Anything', type: 'text', key: 'title' }),
    ).toThrow();
  });

  it('generates a UUID and timestamps', () => {
    const definition = createFieldDefinition({ label: 'Assigner', type: 'text' });
    expect(definition.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(definition.createdAt).toBe(definition.updatedAt);
  });

  it('marks a sortable field as core', () => {
    expect(createFieldDefinition({ label: 'POC', type: 'text', sortable: true }).isCore).toBe(true);
  });

  it('leaves an incidental field out of the core set', () => {
    expect(createFieldDefinition({ label: 'POC', type: 'text' }).isCore).toBe(false);
  });

  it('supplies sensible options for a type that needs them', () => {
    const definition = createFieldDefinition({ label: 'Type', type: 'select' });
    expect(definition.options.kind).toBe('choices');
    expect(definition.options.kind === 'choices' && definition.options.choices.length).toBe(2);
  });

  it('refuses to attach options to a type that takes none', () => {
    const definition = createFieldDefinition({
      label: 'Remarks',
      type: 'longtext',
      options: CHOICES,
    });
    expect(definition.options).toEqual({ kind: 'none' });
  });

  it('rejects a default that is invalid for the type', () => {
    expect(() =>
      createFieldDefinition({
        label: 'Type',
        type: 'select',
        options: CHOICES,
        defaultValue: 'not-a-choice',
      }),
    ).toThrow();
  });

  it('allows a required field whose default is empty', () => {
    const definition = createFieldDefinition({
      label: 'Assigner',
      type: 'text',
      required: true,
      existingKeys: [],
    });
    expect(definition.required).toBe(true);
    expect(definition.defaultValue).toBe('');
  });
});

describe('normaliseOptions', () => {
  it('forces kind none for a type with no options', () => {
    expect(normaliseOptions('text', CHOICES)).toEqual({ kind: 'none' });
  });

  it('supplies starter choices when none are given', () => {
    const result = normaliseOptions('priority', undefined);
    expect(result.kind).toBe('choices');
  });

  it('preserves correctly typed options', () => {
    expect(normaliseOptions('select', CHOICES)).toBe(CHOICES);
  });

  it('replaces options whose kind does not match the type', () => {
    const result = normaliseOptions('select', { kind: 'none' });
    expect(result.kind).toBe('choices');
  });
});

describe('safeParseFieldDefinition', () => {
  it('rejects duplicate choice values', () => {
    const result = safeParseFieldDefinition({
      id: '8a1f0f0e-4f3a-4a2e-9b1c-2d3e4f5a6b7c',
      categoryId: null,
      key: 'type',
      label: 'Type',
      description: null,
      type: 'select',
      options: {
        kind: 'choices',
        choices: [
          { value: 'a', label: 'A', color: null, order: 0 },
          { value: 'a', label: 'Also A', color: null, order: 1 },
        ],
      },
      required: false,
      defaultValue: '',
      groupLabel: null,
      showInTable: false,
      showInCard: false,
      filterable: false,
      sortable: false,
      isCore: false,
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('Duplicate choice values');
    }
  });

  it('rejects an empty choice list', () => {
    const definition = createFieldDefinition({ label: 'Type', type: 'select' });
    const stripped = { ...definition, options: { kind: 'choices' as const, choices: [] } };
    const result = safeParseFieldDefinition(stripped);
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    const definition = createFieldDefinition({ label: 'Assigner', type: 'text' });
    const result = safeParseFieldDefinition({ ...definition, id: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects a number range where min exceeds max', () => {
    const definition = createFieldDefinition({ label: 'Count', type: 'number' });
    const result = safeParseFieldDefinition({
      ...definition,
      options: { kind: 'number', min: 10, max: 1, step: null, prefix: null, suffix: null },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed definition', () => {
    const definition = createFieldDefinition({ label: 'Type', type: 'select', options: CHOICES });
    expect(safeParseFieldDefinition(definition).success).toBe(true);
  });
});

describe('sortFieldDefinitions', () => {
  it('orders by sortOrder then label', () => {
    const base = { ...createFieldDefinition({ label: 'A', type: 'text' }) };
    const list = [
      { ...base, id: '1', key: 'b', label: 'Beta', sortOrder: 1 },
      { ...base, id: '2', key: 'a', label: 'Alpha', sortOrder: 0 },
      { ...base, id: '3', key: 'c', label: 'Gamma', sortOrder: 0 },
    ];
    expect(sortFieldDefinitions(list).map((d) => d.label)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('does not mutate the input', () => {
    const list = [createFieldDefinition({ label: 'B', type: 'text', sortOrder: 1 })];
    const before = [...list];
    sortFieldDefinitions(list);
    expect(list).toEqual(before);
  });
});

describe('resolveDefinitionsForCategory', () => {
  const globalPriority = {
    ...createFieldDefinition({ label: 'Priority', type: 'priority', sortOrder: 0 }),
    categoryId: null,
  } as const;
  const workAssigner = {
    ...createFieldDefinition({ label: 'Assigner', type: 'text', sortOrder: 1 }),
    categoryId: 'work-category',
  } as const;
  const workPriorityOverride = {
    ...createFieldDefinition({ label: 'Priority', type: 'priority', sortOrder: 0 }),
    categoryId: 'work-category',
  } as const;
  const all = [globalPriority, workAssigner, workPriorityOverride];

  it('includes global and category definitions', () => {
    const resolved = resolveDefinitionsForCategory(all, 'work-category');
    expect(resolved.map((d) => d.key)).toContain('assigner');
    expect(resolved.map((d) => d.key)).toContain('priority');
  });

  it('lets a category definition override a global one on the same key', () => {
    const resolved = resolveDefinitionsForCategory(all, 'work-category');
    const priorities = resolved.filter((d) => d.key === 'priority');
    expect(priorities).toHaveLength(1);
    expect(priorities[0]?.categoryId).toBe('work-category');
  });

  it('excludes another category’s definitions', () => {
    const resolved = resolveDefinitionsForCategory(all, 'home-category');
    expect(resolved.map((d) => d.key)).not.toContain('assigner');
  });

  it('returns globals in order when the category has no definitions of its own', () => {
    const resolved = resolveDefinitionsForCategory(all, 'empty-category');
    expect(resolved.map((d) => d.key)).toEqual(['priority']);
  });
});
