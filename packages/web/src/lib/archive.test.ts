import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARCHIVE_SORT,
  applyArchiveSort,
  buildArchiveFilter,
  facetCondition,
  isSelectableFacet,
  type ArchiveFacet,
} from './archive';

/**
 * Archive queries.
 *
 * The facet operator is the one worth defending. Facets are computed per field type, and
 * multi-valued fields are counted by walking their JSON array — so their filter has to
 * walk it too. The earlier version sent `equals` for every field, which is an operator
 * `multiselect` and `people` do not accept: the request was rejected and the facet button
 * did nothing visible except a 400 in the console.
 */

function facet(overrides: Partial<ArchiveFacet> = {}): ArchiveFacet {
  return {
    field: 'my_priority',
    label: 'Priority',
    type: 'priority',
    isOpen: false,
    values: [{ value: 'high', label: 'High', count: 3 }],
    ...overrides,
  };
}

describe('facet conditions', () => {
  it('uses equality for a single-valued choice', () => {
    expect(facetCondition(facet(), 'high')).toEqual({
      kind: 'condition',
      field: 'my_priority',
      operator: 'equals',
      value: 'high',
    });
  });

  it('uses has_any for a multiselect field', () => {
    const condition = facetCondition(facet({ field: 'tags', type: 'multiselect' }), 'urgent');

    // `equals` is not an operator this type accepts. Sending it fails the whole request.
    expect(condition).toEqual({
      kind: 'condition',
      field: 'tags',
      operator: 'has_any',
      value: ['urgent'],
    });
  });

  it('uses has_any for a people field', () => {
    expect(facetCondition(facet({ field: 'reviewers', type: 'people' }), 'p1')).toMatchObject({
      operator: 'has_any',
      value: ['p1'],
    });
  });

  it('refuses to filter an open field by a single value', () => {
    // A number, a duration, a date: "equals 12" answers a different question from
    // "what is in this column", and offering it as a button would answer the wrong one.
    expect(facetCondition(facet({ type: 'number', isOpen: true }), '12')).toBeNull();
    expect(facetCondition(facet({ type: 'date', isOpen: true }), '2026-03-01')).toBeNull();
  });

  it('refuses a boolean facet it cannot express', () => {
    // Booleans are stored as text; the values come back as "true"/"false" and are
    // filterable, so this is supported rather than refused.
    expect(facetCondition(facet({ type: 'boolean' }), 'true')).toMatchObject({
      operator: 'equals',
      value: 'true',
    });
  });
});

describe('which facets can be selected', () => {
  it('allows a closed list of choices', () => {
    expect(isSelectableFacet(facet())).toBe(true);
  });

  it('allows a multi-valued field', () => {
    expect(isSelectableFacet(facet({ type: 'multiselect' }))).toBe(true);
  });

  it('refuses an open field', () => {
    expect(isSelectableFacet(facet({ type: 'duration', isOpen: true }))).toBe(false);
  });

  it('refuses a facet with no values', () => {
    expect(isSelectableFacet(facet({ values: [] }))).toBe(false);
  });
});

describe('the whole filter', () => {
  const noFacets: ArchiveFacet[] = [];

  it('is null when nothing narrows it', () => {
    expect(
      buildArchiveFilter({ search: '', categoryId: '', facet: null, facets: noFacets }),
    ).toBeNull();
  });

  it('ignores a whitespace-only search', () => {
    expect(
      buildArchiveFilter({ search: '   ', categoryId: '', facet: null, facets: noFacets }),
    ).toBeNull();
  });

  it('searches the title', () => {
    expect(
      buildArchiveFilter({ search: 'tax', categoryId: '', facet: null, facets: noFacets }),
    ).toEqual({ kind: 'condition', field: 'title', operator: 'contains', value: 'tax' });
  });

  it('combines a search and a facet with AND', () => {
    const node = buildArchiveFilter({
      search: 'tax',
      categoryId: '',
      facet: { field: 'my_priority', value: 'high' },
      facets: [facet()],
    });

    expect(node).toEqual({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'title', operator: 'contains', value: 'tax' },
        { kind: 'condition', field: 'my_priority', operator: 'equals', value: 'high' },
      ],
    });
  });

  it('drops a facet whose field has disappeared', () => {
    // A stale selection in the URL must not be able to 400 the page forever.
    const node = buildArchiveFilter({
      search: '',
      categoryId: '',
      facet: { field: 'a_field_that_was_deleted', value: 'x' },
      facets: [facet()],
    });

    expect(node).toBeNull();
  });

  it('drops a facet on a field that cannot be filtered by a value', () => {
    const node = buildArchiveFilter({
      search: 'tax',
      categoryId: '',
      facet: { field: 'hours', value: '12' },
      facets: [facet({ field: 'hours', type: 'number', isOpen: true })],
    });

    expect(node).toEqual({ kind: 'condition', field: 'title', operator: 'contains', value: 'tax' });
  });
});

describe('sorting', () => {
  it('defaults to most recently completed', () => {
    // The archive is browsed by when, overwhelmingly.
    expect(DEFAULT_ARCHIVE_SORT).toEqual([
      { field: 'completedAt', direction: 'desc', nulls: 'last' },
    ]);
  });

  it('adds a column as the primary sort', () => {
    expect(applyArchiveSort(DEFAULT_ARCHIVE_SORT, 'title', DEFAULT_ARCHIVE_SORT)[0]).toMatchObject({
      field: 'title',
      direction: 'desc',
    });
  });

  it('flips to ascending on a second click', () => {
    const sorted = applyArchiveSort(DEFAULT_ARCHIVE_SORT, 'title', DEFAULT_ARCHIVE_SORT);

    expect(applyArchiveSort(sorted, 'title', DEFAULT_ARCHIVE_SORT)[0]?.direction).toBe('asc');
  });

  it('removes the sort on a third click, and shows the default', () => {
    // A sort that cannot be removed is a sort someone works around by making another
    // view, which is how archives multiply.
    const once = applyArchiveSort(DEFAULT_ARCHIVE_SORT, 'title', DEFAULT_ARCHIVE_SORT);
    const twice = applyArchiveSort(once, 'title', DEFAULT_ARCHIVE_SORT);

    expect(applyArchiveSort(twice, 'title', DEFAULT_ARCHIVE_SORT)).toEqual(DEFAULT_ARCHIVE_SORT);
  });

  it('never puts a column on twice', () => {
    const once = applyArchiveSort(DEFAULT_ARCHIVE_SORT, 'title', DEFAULT_ARCHIVE_SORT);

    expect(once.filter((rule) => rule.field === 'title')).toHaveLength(1);
  });

  it('keeps the other sorts when one is removed', () => {
    const fallback = [{ field: 'createdAt', direction: 'asc' as const }];
    const once = applyArchiveSort(fallback, 'title', fallback);
    const twice = applyArchiveSort(once, 'title', fallback);
    const cleared = applyArchiveSort(twice, 'title', fallback);

    // The other sort is still in force, so the table is never left unsorted — which
    // reads as arbitrary.
    expect(cleared).toEqual(fallback);
  });
});
