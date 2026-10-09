/**
 * Executes the compiler's output against a real SQLite database.
 *
 * The compiler tests in core assert on the SQL text. These assert on behaviour:
 * that the generated clauses actually select and order the rows they claim to.
 * A compiler can produce SQL that looks right and still behave wrongly, so the
 * two kinds of test are not interchangeable.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { compileQuery, createItemFieldResolver, type FilterNode, type SortRule } from '@gtd/core';
import { migrate, openMemoryDb, type Db } from '@gtd/db';

const resolver = createItemFieldResolver({
  fieldTypes: [
    { key: 'poc', type: 'text' },
    { key: 'priority', type: 'priority' },
    { key: 'estimate', type: 'duration' },
    { key: 'tags', type: 'multiselect' },
    { key: 'approved', type: 'boolean' },
    { key: 'due', type: 'date' },
  ],
});

let db: Db;
const CATEGORY = 'c0000000-0000-4000-8000-000000000001';

interface Fixture {
  title: string;
  container: string;
  whenAt?: string | null;
  deadlineOn?: string | null;
  estimateMinutes?: number | null;
  projectId?: string | null;
  contexts?: string[];
  data?: Record<string, unknown>;
}

function seed(items: Fixture[]): void {
  db.run(
    `INSERT INTO categories (id, key, name, created_at, updated_at) VALUES (?, 'work', 'Work', 't', 't')`,
    CATEGORY,
  );
  // items.project_id is a real foreign key, so the referenced project must exist.
  db.run(
    `INSERT INTO projects (id, name, created_at, updated_at)
     VALUES ('p1', 'Health', 't', 't')`,
  );
  items.forEach((item, index) => {
    db.run(
      `INSERT INTO items (id, category_id, title, container, when_at, deadline_on, estimate_min,
         project_id, contexts_json, data_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `i${index}`,
      CATEGORY,
      item.title,
      item.container,
      item.whenAt ?? null,
      item.deadlineOn ?? null,
      item.estimateMinutes ?? null,
      item.projectId ?? null,
      JSON.stringify(item.contexts ?? []),
      JSON.stringify(item.data ?? {}),
      index,
      // Uniform, so the id tiebreaker decides ordering and each sort test
      // isolates the field it is actually testing.
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  });
}

function titles(filter: FilterNode | null, sort?: SortRule[]): string[] {
  const compiled = compileQuery({ filter, ...(sort ? { sort } : {}) }, resolver);
  return db
    .all<{ title: string }>(`SELECT title FROM items ${compiled.clause}`, ...compiled.params)
    .map((row) => row.title);
}

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
  seed([
    {
      title: 'Call the dentist',
      container: 'next_action',
      estimateMinutes: 10,
      projectId: 'p1',
      data: { poc: 'Dana', priority: 'high', due: '2026-10-05', tags: ['health', 'phone'] },
    },
    {
      title: 'Buy groceries',
      container: 'next_action',
      estimateMinutes: 60,
      contexts: ['ctx-shop'],
      data: { poc: 'Sam', priority: 'low', due: '2026-10-20', tags: ['errand'] },
    },
    {
      title: 'Standup',
      container: 'calendar',
      whenAt: '2026-10-08T09:00:00.000Z',
      data: { priority: 'high' },
    },
    {
      title: 'Alpha review',
      container: 'next_action',
      estimateMinutes: 30,
      data: { poc: 'Dana', approved: true },
    },
    {
      title: 'Beta review',
      container: 'next_action',
      estimateMinutes: 30,
      data: { poc: 'Sam', approved: false },
    },
  ]);
});

describe('equality and inequality', () => {
  it('selects by core column', () => {
    expect(
      titles({ kind: 'condition', field: 'container', operator: 'equals', value: 'calendar' }),
    ).toEqual(['Standup']);
  });

  it('selects by custom JSON field', () => {
    expect(titles({ kind: 'condition', field: 'poc', operator: 'equals', value: 'Dana' })).toEqual(
      expect.arrayContaining(['Call the dentist', 'Alpha review']),
    );
  });

  it('includes unassigned rows in a not_equals filter', () => {
    const result = titles({
      kind: 'condition',
      field: 'poc',
      operator: 'not_equals',
      value: 'Dana',
    });
    expect(result).toContain('Buy groceries');
    expect(result).toContain('Standup');
    expect(result).not.toContain('Call the dentist');
  });
});

describe('numeric and temporal comparisons', () => {
  it('compares a numeric core column', () => {
    const result = titles({
      kind: 'condition',
      field: 'estimateMinutes',
      operator: 'gt',
      value: 30,
    });
    expect(result).toEqual(['Buy groceries']);
  });

  it('compares a datetime column', () => {
    const result = titles({
      kind: 'condition',
      field: 'whenAt',
      operator: 'gte',
      value: '2026-10-08T09:00:00.000Z',
    });
    expect(result).toEqual(['Standup']);
  });

  it('compares a date-typed custom field as text, which orders correctly', () => {
    const result = titles({
      kind: 'condition',
      field: 'due',
      operator: 'between',
      value: ['2026-10-01', '2026-10-10'],
    });
    expect(result).toEqual(['Call the dentist']);
  });

  it('excludes rows where a numeric column is null', () => {
    const result = titles({
      kind: 'condition',
      field: 'estimateMinutes',
      operator: 'is_null',
    });
    expect(result).toEqual(['Standup']);
  });
});

describe('empty and null semantics', () => {
  it('treats a missing JSON key as empty', () => {
    const result = titles({
      kind: 'condition',
      field: 'poc',
      operator: 'is_empty',
    });
    // Only Standup has no poc at all; the other four all carry one.
    expect(result).toEqual(['Standup']);
  });

  it('treats an empty JSON array as empty', () => {
    const withEmptyArray = titles({
      kind: 'condition',
      field: 'tags',
      operator: 'is_empty',
    });
    expect(withEmptyArray).not.toContain('Buy groceries');
    expect(withEmptyArray).toContain('Standup');
  });

  it('treats an empty string as empty', () => {
    db.run(
      `INSERT INTO items (id, category_id, title, container, data_json, created_at, updated_at)
       VALUES ('empty', ?, 'Empty', 'next_action', '{"poc":""}', 't', 't')`,
      CATEGORY,
    );
    const result = titles({ kind: 'condition', field: 'poc', operator: 'is_empty' });
    expect(result).toContain('Empty');
  });

  it('finds non-empty values', () => {
    const result = titles({ kind: 'condition', field: 'poc', operator: 'not_empty' });
    expect(result).not.toContain('Standup');
    expect(result).toContain('Alpha review');
  });
});

describe('JSON array membership', () => {
  it('matches a tag with has_any', () => {
    expect(
      titles({ kind: 'condition', field: 'tags', operator: 'has_any', value: ['health'] }),
    ).toEqual(['Call the dentist']);
  });

  it('matches several tags with has_any', () => {
    const result = titles({
      kind: 'condition',
      field: 'tags',
      operator: 'has_any',
      value: ['health', 'errand'],
    });
    expect(result.sort()).toEqual(['Buy groceries', 'Call the dentist']);
  });

  it('requires every tag with has_all', () => {
    expect(
      titles({ kind: 'condition', field: 'tags', operator: 'has_all', value: ['health', 'phone'] }),
    ).toEqual(['Call the dentist']);
    expect(
      titles({
        kind: 'condition',
        field: 'tags',
        operator: 'has_all',
        value: ['health', 'errand'],
      }),
    ).toEqual([]);
  });

  it('matches contexts through the contexts column', () => {
    expect(
      titles({ kind: 'condition', field: 'contexts', operator: 'has_any', value: ['ctx-shop'] }),
    ).toEqual(['Buy groceries']);
  });

  it('does not match a row whose array is empty', () => {
    expect(
      titles({ kind: 'condition', field: 'tags', operator: 'has_any', value: ['health'] }),
    ).not.toContain('Alpha review');
  });
});

describe('text matching', () => {
  it('matches a substring', () => {
    expect(
      titles({ kind: 'condition', field: 'title', operator: 'contains', value: 'review' }),
    ).toEqual(['Alpha review', 'Beta review']);
  });

  it('matches a prefix', () => {
    expect(
      titles({ kind: 'condition', field: 'title', operator: 'starts_with', value: 'A' }),
    ).toEqual(['Alpha review']);
  });

  it('matches a suffix', () => {
    expect(
      titles({ kind: 'condition', field: 'title', operator: 'ends_with', value: 'dentist' }),
    ).toEqual(['Call the dentist']);
  });

  it('treats a LIKE wildcard as a literal', () => {
    // If "%" were not escaped, this would match every row.
    expect(
      titles({ kind: 'condition', field: 'title', operator: 'starts_with', value: '%' }),
    ).toEqual([]);
    expect(
      titles({ kind: 'condition', field: 'title', operator: 'starts_with', value: '_' }),
    ).toEqual([]);
  });

  it('matches case-insensitively with contains', () => {
    expect(
      titles({ kind: 'condition', field: 'title', operator: 'contains', value: 'REVIEW' }),
    ).toEqual(['Alpha review', 'Beta review']);
  });
});

describe('boolean fields', () => {
  it('matches a boolean stored as a JSON 1', () => {
    expect(
      titles({ kind: 'condition', field: 'approved', operator: 'equals', value: true }),
    ).toEqual(['Alpha review']);
  });

  it('matches a boolean stored as a JSON 0', () => {
    expect(
      titles({ kind: 'condition', field: 'approved', operator: 'equals', value: false }),
    ).toEqual(['Beta review']);
  });
});

describe('in and not_in', () => {
  it('matches any of several containers', () => {
    const result = titles({
      kind: 'condition',
      field: 'container',
      operator: 'in',
      value: ['calendar', 'next_action'],
    });
    // Four next actions plus the one calendar item, which is every fixture row.
    expect(result).toHaveLength(5);
  });

  it('excludes containers not listed', () => {
    const result = titles({
      kind: 'condition',
      field: 'container',
      operator: 'in',
      value: ['calendar'],
    });
    expect(result).toEqual(['Standup']);
  });

  it('includes nulls in not_in', () => {
    const result = titles({
      kind: 'condition',
      field: 'projectId',
      operator: 'not_in',
      value: ['p1'],
    });
    expect(result).not.toContain('Call the dentist');
    expect(result).toContain('Buy groceries');
  });
});

describe('groups', () => {
  it('applies AND', () => {
    const result = titles({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'poc', operator: 'equals', value: 'Dana' },
        { kind: 'condition', field: 'estimateMinutes', operator: 'lt', value: 20 },
      ],
    });
    expect(result).toEqual(['Call the dentist']);
  });

  it('applies OR', () => {
    const result = titles({
      kind: 'group',
      conjunction: 'or',
      children: [
        { kind: 'condition', field: 'poc', operator: 'equals', value: 'Dana' },
        { kind: 'condition', field: 'container', operator: 'equals', value: 'calendar' },
      ],
    });
    expect(result.sort()).toEqual(['Alpha review', 'Call the dentist', 'Standup']);
  });

  it('does not let a nested OR leak past its AND sibling', () => {
    // Unparenthesised this would parse as
    //   (estimate >= 30 AND poc = 'Nobody') OR poc = 'Sam'
    // which would wrongly return Beta review.
    const result = titles({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'estimateMinutes', operator: 'gte', value: 30 },
        {
          kind: 'group',
          conjunction: 'or',
          children: [
            { kind: 'condition', field: 'poc', operator: 'equals', value: 'Nobody' },
            { kind: 'condition', field: 'poc', operator: 'equals', value: 'No One' },
          ],
        },
      ],
    });
    expect(result).toEqual([]);
  });

  it('does match when the nested OR genuinely applies', () => {
    // The control case for the test above: if this ever returned nothing, the
    // filter would be broken rather than merely correctly parenthesised.
    const result = titles({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'estimateMinutes', operator: 'gte', value: 30 },
        {
          kind: 'group',
          conjunction: 'or',
          children: [
            { kind: 'condition', field: 'poc', operator: 'equals', value: 'Dana' },
            { kind: 'condition', field: 'poc', operator: 'equals', value: 'No One' },
          ],
        },
      ],
    });
    expect(result).toEqual(['Alpha review']);
  });
});

describe('sorting', () => {
  it('sorts by a custom field, putting absent values last', () => {
    const result = titles(
      { kind: 'condition', field: 'container', operator: 'equals', value: 'next_action' },
      [{ field: 'poc', direction: 'asc' }],
    );
    // Dana, Sam, Sam, then the two rows with no poc.
    expect(result).toEqual(['Call the dentist', 'Alpha review', 'Buy groceries', 'Beta review']);
  });

  it('sorts by a numeric column', () => {
    const result = titles(
      { kind: 'condition', field: 'container', operator: 'equals', value: 'next_action' },
      [{ field: 'estimateMinutes', direction: 'asc' }],
    );
    expect(result[0]).toBe('Call the dentist');
    expect(result.at(-1)).toBe('Buy groceries');
  });

  it('sorts case-insensitively on text', () => {
    const result = titles(null, [{ field: 'title', direction: 'asc' }]);
    expect(result).toEqual([
      'Alpha review',
      'Beta review',
      'Buy groceries',
      'Call the dentist',
      'Standup',
    ]);
  });

  it('is stable for identical keys thanks to the id tiebreaker', () => {
    // Alpha and Beta both have estimate 30; reversing must not shuffle them.
    const asc = titles(
      { kind: 'condition', field: 'container', operator: 'equals', value: 'next_action' },
      [{ field: 'estimateMinutes', direction: 'asc' }],
    );
    const desc = titles(
      { kind: 'condition', field: 'container', operator: 'equals', value: 'next_action' },
      [{ field: 'estimateMinutes', direction: 'desc' }],
    );
    expect(asc.filter((t) => t.endsWith('review'))).toEqual(['Alpha review', 'Beta review']);
    expect(desc.filter((t) => t.endsWith('review'))).toEqual(['Alpha review', 'Beta review']);
  });

  it('repeats a sort identically across calls', () => {
    const spec: SortRule[] = [{ field: 'poc', direction: 'asc' }];
    const filter: FilterNode = {
      kind: 'condition',
      field: 'container',
      operator: 'equals',
      value: 'next_action',
    };
    expect(titles(filter, spec)).toEqual(titles(filter, spec));
  });
});

describe('injection resistance against a live database', () => {
  it('does not execute a hostile value', () => {
    const result = titles({
      kind: 'condition',
      field: 'title',
      operator: 'equals',
      value: "'; DROP TABLE items; --",
    });
    expect(result).toEqual([]);
    // The table is still there.
    expect(db.get<{ count: number }>('SELECT count(*) AS count FROM items')?.count).toBe(5);
  });

  it('does not execute a hostile key', () => {
    expect(() =>
      titles({ kind: 'condition', field: "x') OR ('1'='1", operator: 'equals', value: 'x' }),
    ).toThrow();
  });
});

describe('empty filter', () => {
  it('returns everything when the filter is absent', () => {
    expect(titles(null)).toHaveLength(5);
  });

  it('returns everything for an empty group', () => {
    expect(titles({ kind: 'group', conjunction: 'and', children: [] })).toHaveLength(5);
  });
});
