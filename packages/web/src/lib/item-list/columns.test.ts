import { describe, expect, it } from 'vitest';
import {
  CORE_COLUMNS,
  applyColumnConfig,
  defaultColumns,
  moveColumn,
  toggleHidden,
} from './columns';
import type { FieldDefinition } from '../types';

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: overrides.key ?? 'f1',
    categoryId: null,
    key: 'my_field',
    label: 'My field',
    description: null,
    type: 'text',
    options: { kind: 'none' },
    required: false,
    defaultValue: null,
    groupLabel: null,
    showInTable: true,
    showInCard: false,
    filterable: true,
    sortable: true,
    isCore: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as FieldDefinition;
}

describe('default columns', () => {
  it('always has a title', () => {
    expect(defaultColumns('inbox', []).at(0)?.key).toBe('title');
  });

  it('has a deadline and an estimate for an ordinary list', () => {
    const keys = defaultColumns('next_action', []).map((column) => column.key);

    expect(keys).toContain('deadlineOn');
    expect(keys).toContain('estimateMinutes');
  });

  /*
   * A calendar list without a hard date is not a calendar list. The core set differs
   * per container because the columns that matter differ: what you are waiting for is
   * a person and a date, what you are doing now is a time.
   */
  it('adds the hard date for the calendar', () => {
    expect(defaultColumns('calendar', []).map((column) => column.key)).toContain('whenAt');
  });

  it('adds the person and follow-up for waiting', () => {
    const keys = defaultColumns('waiting', []).map((column) => column.key);

    expect(keys).toContain('waitingOnPersonId');
    expect(keys).toContain('followUpAt');
  });

  it('adds completion for done', () => {
    expect(defaultColumns('done', []).map((column) => column.key)).toContain('completedAt');
  });

  it('includes custom fields marked for tables', () => {
    const keys = defaultColumns('inbox', [field()]).map((column) => column.key);

    expect(keys).toContain('my_field');
  });

  it('leaves out custom fields not marked for tables', () => {
    // A field added once, for one specific project, should not appear in every list.
    const keys = defaultColumns('inbox', [field({ showInTable: false })]).map(
      (column) => column.key,
    );

    expect(keys).not.toContain('my_field');
  });

  it('keeps the core column when a custom field shares its key', () => {
    // Someone labelling their own field "Title" must not replace the real title,
    // which is the one with a value in it.
    const columns = defaultColumns('inbox', [field({ key: 'title', label: 'Title' })]);

    expect(columns.filter((column) => column.key === 'title')).toHaveLength(1);
  });

  it('right-aligns numbers, because numbers read wrong left-aligned in a column', () => {
    expect(
      defaultColumns('inbox', []).find((column) => column.key === 'estimateMinutes')?.align,
    ).toBe('right');
  });

  it('has no duplicate keys', () => {
    const columns = defaultColumns('waiting', [field(), field({ key: 'other' })]);

    expect(new Set(columns.map((column) => column.key)).size).toBe(columns.length);
  });
});

describe('applying configuration', () => {
  const defaults = defaultColumns('inbox', [field()]);

  it('returns the defaults with no configuration', () => {
    expect(applyColumnConfig(defaults, null)).toEqual(defaults);
  });

  it('hides what was hidden', () => {
    const config = { hidden: ['estimateMinutes'], order: [] };
    const keys = applyColumnConfig(defaults, config).map((column) => column.key);

    expect(keys).not.toContain('estimateMinutes');
    expect(keys).toContain('title');
  });

  it('reorders by the saved order', () => {
    const config = { hidden: [], order: ['estimateMinutes', 'title'] };
    const keys = applyColumnConfig(defaults, config).map((column) => column.key);

    expect(keys.slice(0, 2)).toEqual(['estimateMinutes', 'title']);
  });

  /*
   * A view pinned to an exact column list would not show a field added last week,
   * which is exactly the moment someone goes looking for it.
   */
  it('keeps default columns not mentioned in the saved order', () => {
    const config = { hidden: [], order: ['estimateMinutes'] };
    const keys = applyColumnConfig(defaults, config).map((column) => column.key);

    expect(keys).toContain('deadlineOn');
  });

  it('puts unordered columns after ordered ones', () => {
    const config = { hidden: [], order: ['my_field'] };
    const keys = applyColumnConfig(defaults, config).map((column) => column.key);

    expect(keys.at(0)).toBe('my_field');
  });
});

describe('toggling', () => {
  it('hides a visible column', () => {
    expect(toggleHidden(null, 'title').hidden).toEqual(['title']);
  });

  it('shows a hidden column again', () => {
    expect(toggleHidden({ hidden: ['title'], order: [] }, 'title').hidden).toEqual([]);
  });

  it('keeps the order it already had', () => {
    const config = { hidden: ['a'], order: ['b', 'a'] };

    expect(toggleHidden(config, 'c').order).toEqual(['b', 'a']);
  });
});

describe('moving', () => {
  it('pins the order before moving something not yet ordered', () => {
    /*
     * Without this, one move puts a single column at the front and leaves everything
     * else in an order nobody chose. Moving a column implies an opinion about the
     * whole order, so the whole order gets written down at that moment.
     */
    const config = moveColumn(null, 'estimateMinutes', 1);

    expect(config.order).toEqual(['estimateMinutes']);
  });

  it('moves a column along the order', () => {
    const config = { hidden: [], order: ['a', 'b', 'c'] };
    expect(moveColumn(config, 'c', -1).order).toEqual(['a', 'c', 'b']);
  });

  it('cannot move past the ends', () => {
    const config = { hidden: [], order: ['a', 'b'] };

    expect(moveColumn(config, 'a', -1).order).toEqual(['a', 'b']);
    expect(moveColumn(config, 'b', 1).order).toEqual(['a', 'b']);
  });

  it('keeps hidden columns in the order rather than dropping them', () => {
    const config = { hidden: ['b'], order: ['a', 'b', 'c'] };

    expect(moveColumn(config, 'c', -1).order).toEqual(['a', 'c', 'b']);
  });
});

describe('the core column set', () => {
  it('has no duplicate keys', () => {
    expect(new Set(CORE_COLUMNS.map((column) => column.key)).size).toBe(CORE_COLUMNS.length);
  });

  it('never offers to sort by an id nobody reads', () => {
    // `id` is a core column so items can be fetched by it, but no list has ever
    // been sorted by it.
    expect(CORE_COLUMNS.map((column) => column.key)).not.toContain('id');
  });
});
