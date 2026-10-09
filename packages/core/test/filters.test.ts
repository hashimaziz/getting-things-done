import { describe, expect, it } from 'vitest';
import {
  InvalidQueryError,
  compileFilter,
  compileSort,
  createItemFieldResolver,
  resolveOffset,
  resolvePageSize,
  type FieldResolver,
  type FilterNode,
  type SortRule,
} from '../src/filters/index.js';

const resolver = createItemFieldResolver({
  fieldTypes: [
    { key: 'poc', type: 'text' },
    { key: 'priority', type: 'priority' },
    { key: 'estimate', type: 'duration' },
    { key: 'assigner', type: 'text' },
    { key: 'watchers', type: 'people' },
    { key: 'tags', type: 'multiselect' },
    { key: 'approved', type: 'boolean' },
    { key: 'due', type: 'date' },
  ],
});

function cond(node: FilterNode) {
  return compileFilter(node, resolver);
}

describe('createItemFieldResolver', () => {
  it('maps a core key to its real column', () => {
    expect(resolver.expression('whenAt')).toBe('when_at');
    expect(resolver.expression('title')).toBe('title');
    expect(resolver.expression('deadlineOn')).toBe('deadline_on');
  });

  it('maps a custom key to a json_extract', () => {
    expect(resolver.expression('poc')).toBe("json_extract(data_json, '$.poc')");
  });

  it('maps contexts to the JSON array column', () => {
    expect(resolver.expression('contexts')).toBe('contexts_json');
    expect(resolver.type('contexts')).toBe('multiselect');
  });

  it('reports the declared type of core and custom keys', () => {
    expect(resolver.type('whenAt')).toBe('datetime');
    expect(resolver.type('deadlineOn')).toBe('date');
    expect(resolver.type('estimateMinutes')).toBe('duration');
    expect(resolver.type('poc')).toBe('text');
  });

  it('returns null for an unknown key', () => {
    expect(resolver.type('nope')).toBeNull();
  });

  it('distinguishes core from custom', () => {
    expect(resolver.isCore('title')).toBe(true);
    expect(resolver.isCore('poc')).toBe(false);
  });

  it('honours a narrowed core key set', () => {
    const narrow = createItemFieldResolver({ coreKeys: ['title'] });
    expect(narrow.expression('title')).toBe('title');
    expect(narrow.type('title')).toBe('text');
    // Not in the narrowed set, so treated as a custom field.
    expect(narrow.type('whenAt')).toBeNull();
  });
});

describe('compileFilter: absence', () => {
  it('compiles undefined to an empty clause', () => {
    expect(compileFilter(undefined, resolver)).toEqual({ sql: '', params: [] });
  });

  it('compiles null to an empty clause', () => {
    expect(compileFilter(null, resolver)).toEqual({ sql: '', params: [] });
  });
});

describe('compileFilter: conditions', () => {
  it('compiles equality with a bound parameter', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'container',
      operator: 'equals',
      value: 'next_action',
    });
    expect(sql).toBe('container = ?');
    expect(params).toEqual(['next_action']);
  });

  it('compiles inequality so null rows are included', () => {
    // "Not Work" should return unassigned items too, not silently exclude them.
    const { sql } = cond({
      kind: 'condition',
      field: 'projectId',
      operator: 'not_equals',
      value: 'p1',
    });
    expect(sql).toBe('(project_id IS NULL OR project_id != ?)');
  });

  it('compiles gt on a numeric core column', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'estimateMinutes',
      operator: 'gt',
      value: 30,
    });
    expect(sql).toBe('estimate_min > ?');
    expect(params).toEqual([30]);
  });

  it('compiles between', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'due',
      operator: 'between',
      value: ['2026-10-01', '2026-10-31'],
    });
    expect(sql).toBe("json_extract(data_json, '$.due') BETWEEN ? AND ?");
    expect(params).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('compiles in', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'container',
      operator: 'in',
      value: ['inbox', 'next_action'],
    });
    expect(sql).toBe('container IN (?, ?)');
    expect(params).toEqual(['inbox', 'next_action']);
  });

  it('compiles is_null and is_not_null', () => {
    expect(cond({ kind: 'condition', field: 'whenAt', operator: 'is_null' }).sql).toBe(
      'when_at IS NULL',
    );
    expect(cond({ kind: 'condition', field: 'whenAt', operator: 'is_not_null' }).sql).toBe(
      'when_at IS NOT NULL',
    );
  });

  it('compiles is_empty across every empty representation', () => {
    const { sql } = cond({ kind: 'condition', field: 'assigner', operator: 'is_empty' });
    expect(sql).toContain("IN ('', '[]', '{}')");
  });

  it('compiles not_empty', () => {
    expect(cond({ kind: 'condition', field: 'assigner', operator: 'not_empty' }).sql).toContain(
      'NOT IN',
    );
  });

  it('converts a boolean value to 0 or 1', () => {
    const { params } = cond({
      kind: 'condition',
      field: 'approved',
      operator: 'equals',
      value: true,
    });
    expect(params).toEqual([1]);
  });
});

describe('compileFilter: text operators', () => {
  it('compiles contains as a case-insensitive instr', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'contains',
      value: 'Dentist',
    });
    expect(sql).toBe("instr(lower(COALESCE(title, '')), ?) > 0");
    // The needle is lowered in the parameter too, so the bind is the only place
    // the value appears.
    expect(params).toEqual(['dentist']);
  });

  it('leaves equals case-sensitive', () => {
    // equals selects machine values such as a priority, so it must not fold case.
    const { sql } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'equals',
      value: 'x',
    });
    expect(sql).not.toContain('lower(');
  });

  it('escapes LIKE wildcards for starts_with', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'starts_with',
      value: '50%_off',
    });
    expect(params).toEqual(['50\\%\\_off%']);
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).toContain('lower(title)');
  });

  it('escapes a backslash itself', () => {
    const { params } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'ends_with',
      value: 'a\\b',
    });
    expect(params).toEqual(['%a\\\\b']);
  });

  it('does not use LIKE for contains, so no escaping is needed', () => {
    const { params } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'contains',
      value: '50%',
    });
    expect(params).toEqual(['50%']);
  });
});

describe('compileFilter: JSON arrays', () => {
  it('compiles has_any as a single EXISTS', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'tags',
      operator: 'has_any',
      value: ['home', 'errand'],
    });
    expect(sql).toBe(
      "EXISTS (SELECT 1 FROM json_each(json_extract(data_json, '$.tags')) WHERE value IN (?, ?))",
    );
    expect(params).toEqual(['home', 'errand']);
  });

  it('compiles has_all as one EXISTS per value', () => {
    const { sql, params } = cond({
      kind: 'condition',
      field: 'tags',
      operator: 'has_all',
      value: ['home', 'errand'],
    });
    expect(sql.match(/EXISTS/g)).toHaveLength(2);
    expect(params).toEqual(['home', 'errand']);
  });

  it('filters contexts through the contexts column', () => {
    const { sql } = cond({
      kind: 'condition',
      field: 'contexts',
      operator: 'has_any',
      value: ['ctx-1'],
    });
    expect(sql).toBe('EXISTS (SELECT 1 FROM json_each(contexts_json) WHERE value IN (?))');
  });
});

describe('compileFilter: groups', () => {
  it('joins an AND group', () => {
    const { sql, params } = cond({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'container', operator: 'equals', value: 'next_action' },
        { kind: 'condition', field: 'priority', operator: 'equals', value: 'high' },
      ],
    });
    expect(sql).toBe("(container = ? AND json_extract(data_json, '$.priority') = ?)");
    expect(params).toEqual(['next_action', 'high']);
  });

  it('joins an OR group', () => {
    const { sql } = cond({
      kind: 'group',
      conjunction: 'or',
      children: [
        { kind: 'condition', field: 'container', operator: 'equals', value: 'inbox' },
        { kind: 'condition', field: 'container', operator: 'equals', value: 'someday' },
      ],
    });
    expect(sql).toBe('(container = ? OR container = ?)');
  });

  it('parenthesises so a nested OR cannot escape its group', () => {
    const { sql } = cond({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'container', operator: 'equals', value: 'next_action' },
        {
          kind: 'group',
          conjunction: 'or',
          children: [
            { kind: 'condition', field: 'priority', operator: 'equals', value: 'high' },
            { kind: 'condition', field: 'priority', operator: 'equals', value: 'low' },
          ],
        },
      ],
    });
    expect(sql).toBe(
      "(container = ? AND (json_extract(data_json, '$.priority') = ? OR json_extract(data_json, '$.priority') = ?))",
    );
  });

  it('compiles an empty group to a tautology', () => {
    expect(cond({ kind: 'group', conjunction: 'and', children: [] }).sql).toBe('1 = 1');
  });

  it('preserves parameter order through nesting', () => {
    const { params } = cond({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'title', operator: 'contains', value: 'first' },
        {
          kind: 'group',
          conjunction: 'or',
          children: [
            { kind: 'condition', field: 'title', operator: 'contains', value: 'second' },
            { kind: 'condition', field: 'title', operator: 'contains', value: 'third' },
          ],
        },
      ],
    });
    expect(params).toEqual(['first', 'second', 'third']);
  });
});

describe('compileFilter: validation', () => {
  it('rejects an unknown field', () => {
    expect(() =>
      cond({ kind: 'condition', field: 'nope', operator: 'equals', value: 'x' }),
    ).toThrow(/Unknown field/);
  });

  it('rejects an operator invalid for the type', () => {
    expect(() =>
      cond({ kind: 'condition', field: 'approved', operator: 'contains', value: 'x' }),
    ).toThrow(/not valid for a "boolean" field/);
  });

  it('lists the allowed operators in the message', () => {
    try {
      cond({ kind: 'condition', field: 'approved', operator: 'contains', value: 'x' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('equals');
    }
  });

  it('rejects a value on a unary operator', () => {
    expect(() =>
      cond({ kind: 'condition', field: 'assigner', operator: 'is_empty', value: 'x' }),
    ).toThrow(/takes no value/);
  });

  it('rejects a missing value', () => {
    expect(() => cond({ kind: 'condition', field: 'title', operator: 'equals' })).toThrow(
      /requires a value/,
    );
  });

  it('rejects an array for a scalar operator', () => {
    expect(() =>
      cond({ kind: 'condition', field: 'title', operator: 'equals', value: ['a', 'b'] }),
    ).toThrow(/single value/);
  });

  it('rejects a non-array for in', () => {
    expect(() => cond({ kind: 'condition', field: 'title', operator: 'in', value: 'a' })).toThrow(
      /non-empty array/,
    );
  });

  it('rejects an empty array for in', () => {
    expect(() => cond({ kind: 'condition', field: 'title', operator: 'in', value: [] })).toThrow(
      /non-empty array/,
    );
  });

  it('rejects a badly sized array for between', () => {
    expect(() =>
      cond({ kind: 'condition', field: 'due', operator: 'between', value: ['a'] }),
    ).toThrow(/exactly two values/);
  });

  it('rejects a key that is not lower snake_case', () => {
    expect(() =>
      cond({ kind: 'condition', field: 'poc; DROP TABLE items', operator: 'equals', value: 'x' }),
    ).toThrow(InvalidQueryError);
  });

  it('rejects a key with a quote in it', () => {
    expect(() =>
      cond({ kind: 'condition', field: "poc'", operator: 'equals', value: 'x' }),
    ).toThrow(/Unsafe field key/);
  });

  it('rejects a filter nested beyond the depth limit', () => {
    let node: FilterNode = {
      kind: 'condition',
      field: 'title',
      operator: 'equals',
      value: 'x',
    };
    for (let i = 0; i < 10; i += 1) {
      node = { kind: 'group', conjunction: 'and', children: [node] };
    }
    expect(() => cond(node)).toThrow(/nested deeper/);
  });

  it('reports the path of the failing condition', () => {
    try {
      cond({
        kind: 'group',
        conjunction: 'and',
        children: [
          { kind: 'condition', field: 'title', operator: 'equals', value: 'x' },
          { kind: 'condition', field: 'nope', operator: 'equals', value: 'x' },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidQueryError).path).toBe('filter[1]');
    }
  });
});

describe('compileSort', () => {
  it('defaults to newest first', () => {
    expect(compileSort(undefined, resolver)).toBe('created_at DESC, id ASC');
  });

  it('compiles a direction', () => {
    expect(compileSort([{ field: 'title', direction: 'asc' }], resolver)).toBe(
      'title COLLATE NOCASE ASC NULLS LAST, created_at DESC, id ASC',
    );
  });

  it('adds a tiebreaker so equal keys do not swap places', () => {
    const sql = compileSort([{ field: 'title', direction: 'desc' }], resolver);
    expect(sql.endsWith('id ASC')).toBe(true);
  });

  it('does not repeat created_at when already sorted by it', () => {
    const sql = compileSort([{ field: 'createdAt', direction: 'asc' }], resolver);
    expect(sql.match(/created_at/g)).toHaveLength(1);
  });

  it('uses NOCASE only for text-like types', () => {
    expect(compileSort([{ field: 'whenAt', direction: 'desc' }], resolver)).toContain(
      'when_at DESC',
    );
    expect(compileSort([{ field: 'whenAt', direction: 'desc' }], resolver)).not.toContain(
      'COLLATE',
    );
  });

  it('honours an explicit nulls placement', () => {
    expect(
      compileSort([{ field: 'whenAt', direction: 'asc', nulls: 'first' }], resolver),
    ).toContain('NULLS FIRST');
  });

  it('sorts ascending with nulls last by default', () => {
    expect(compileSort([{ field: 'whenAt', direction: 'asc' }], resolver)).toContain('NULLS LAST');
  });

  it('sorts descending with nulls first by default', () => {
    expect(compileSort([{ field: 'whenAt', direction: 'desc' }], resolver)).toContain(
      'NULLS FIRST',
    );
  });

  it('supports multi-key sort', () => {
    const sql = compileSort(
      [
        { field: 'container', direction: 'asc' },
        { field: 'whenAt', direction: 'asc' },
      ],
      resolver,
    );
    expect(sql.indexOf('container')).toBeLessThan(sql.indexOf('when_at'));
  });

  it('rejects an unknown field', () => {
    expect(() => compileSort([{ field: 'nope', direction: 'asc' }], resolver)).toThrow(
      /Unknown field/,
    );
  });

  it('rejects an unsafe key', () => {
    expect(() =>
      compileSort([{ field: 'a; DROP TABLE items', direction: 'asc' }], resolver),
    ).toThrow(/Unsafe field key/);
  });

  it('sorts on a custom field via json_extract', () => {
    expect(compileSort([{ field: 'poc', direction: 'asc' }], resolver)).toContain(
      "json_extract(data_json, '$.poc')",
    );
  });
});

describe('pagination helpers', () => {
  it('defaults the page size', () => {
    expect(resolvePageSize(undefined)).toBe(50);
  });

  it('clamps an over-large page size', () => {
    expect(resolvePageSize(10_000)).toBe(500);
  });

  it('handles a negative or non-finite limit', () => {
    expect(resolvePageSize(-5)).toBe(50);
    expect(resolvePageSize(Number.NaN)).toBe(50);
  });

  it('floors a fractional limit', () => {
    expect(resolvePageSize(10.9)).toBe(10);
  });

  it('defaults the offset to zero', () => {
    expect(resolveOffset(undefined)).toBe(0);
    expect(resolveOffset(-1)).toBe(0);
    expect(resolveOffset(20)).toBe(20);
  });
});

describe('resolver is reusable across queries', () => {
  it('compiles the same filter identically twice', () => {
    const spec: FilterNode = {
      kind: 'group',
      conjunction: 'and',
      children: [{ kind: 'condition', field: 'title', operator: 'contains', value: 'x' }],
    };
    expect(cond(spec).sql).toBe(cond(spec).sql);
  });

  it('accepts a resolver with no custom fields, rejecting custom filters', () => {
    const bare = createItemFieldResolver();
    expect(() =>
      compileFilter({ kind: 'condition', field: 'poc', operator: 'equals', value: 'x' }, bare),
    ).toThrow(/Unknown field/);
  });
});

describe('compiler output is a single injection barrier', () => {
  it('never emits a caller-supplied value into the SQL text', () => {
    const hostile = "'; DROP TABLE items; --";
    const { sql, params } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'contains',
      value: hostile,
    });
    expect(sql).not.toContain('DROP TABLE');
    // Bound as a parameter, lowercased for the case-insensitive comparison.
    expect(params).toEqual([hostile.toLowerCase()]);
  });

  it('does not emit a caller-supplied value for an exact match either', () => {
    const hostile = "'; DROP TABLE items; --";
    const { sql, params } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'equals',
      value: hostile,
    });
    expect(sql).toBe('title = ?');
    expect(params).toEqual([hostile]);
  });

  it('escapes a hostile value used with starts_with', () => {
    const { sql } = cond({
      kind: 'condition',
      field: 'title',
      operator: 'starts_with',
      value: "' OR 1=1 --",
    });
    expect(sql).not.toContain('1=1 --');
  });
});

export type { FieldResolver, SortRule };
