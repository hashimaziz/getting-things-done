/**
 * Building an archive query.
 *
 * Three decisions that are easy to get wrong and impossible to notice, which is why
 * they live here with tests rather than inline in a component.
 */

import type { FilterNode, SortRule } from './types';

export interface ArchiveFacetValue {
  value: string;
  label: string;
  count: number;
}

export interface ArchiveFacet {
  field: string;
  label: string;
  type: string;
  /** False for a field whose values are a closed list of choices. */
  isOpen: boolean;
  values: ArchiveFacetValue[];
}

/**
 * The condition for selecting one facet value.
 *
 * Returns null when the field cannot be filtered by a single value, which is the case
 * the first version got wrong.
 *
 * The archive's facets are computed per field type, and multi-valued fields
 * (`multiselect`, `people`) are counted by walking the JSON array. Their filter has to
 * walk it too, with `has_any` — sending `equals`, as the earlier version did for every
 * field, is an operator those types do not accept, so the server rejects the request and
 * the facet button fails silently with a 400 in the console and no visible change.
 *
 * An "open" facet — a number, a duration, a date — has no closed list of values to
 * pick from, so it gets no button and no condition rather than pretending otherwise.
 */
export function facetCondition(facet: ArchiveFacet, value: string): FilterNode | null {
  const multi = facet.type === 'multiselect' || facet.type === 'people';

  if (multi) {
    return { kind: 'condition', field: facet.field, operator: 'has_any', value: [value] };
  }

  if (facet.isOpen) {
    // A number or a date. "Equals 12" is a different question from "what are the
    // values in this column", and offering it as a button would answer the wrong one.
    return null;
  }

  if (facet.type === 'boolean') {
    return { kind: 'condition', field: facet.field, operator: 'equals', value };
  }

  return { kind: 'condition', field: facet.field, operator: 'equals', value };
}

/**
 * Whether a facet's values can be selected at all.
 *
 * A facet with no values has nothing to click, whatever its type supports.
 */
export function isSelectableFacet(facet: ArchiveFacet): boolean {
  return facet.values.length > 0 && facetCondition(facet, facet.values[0]?.value ?? '') !== null;
}

export interface ArchiveQuery {
  search: string;
  categoryId: string;
  facet: { field: string; value: string } | null;
  /** The facet a selection refers to, for its type. */
  facets: ArchiveFacet[];
}

/**
 * The whole archive filter.
 *
 * One condition per source, combined with AND. Search is a title condition rather than
 * a separate query parameter, so it composes with the rest instead of overriding it.
 */
export function buildArchiveFilter(query: ArchiveQuery): FilterNode | null {
  const children: FilterNode[] = [];

  const search = query.search.trim();
  if (search !== '') {
    children.push({ kind: 'condition', field: 'title', operator: 'contains', value: search });
  }

  if (query.facet !== null) {
    const facet = query.facets.find((candidate) => candidate.field === query.facet?.field);
    // A facet from a field that no longer exists, or one whose type cannot be filtered
    // by a value. Dropped rather than sent, so a stale selection cannot 400 the page.
    const condition = facet === undefined ? null : facetCondition(facet, query.facet.value);
    if (condition !== null) {
      children.push(condition);
    }
  }

  if (children.length === 0) {
    return null;
  }
  return children.length === 1
    ? (children[0] as FilterNode)
    : { kind: 'group', conjunction: 'and', children };
}

/** What the archive is sorted by, when nothing else is chosen. */
export const DEFAULT_ARCHIVE_SORT: SortRule[] = [
  { field: 'completedAt', direction: 'desc', nulls: 'last' },
];

/**
 * Cycles a column's sort, in the same three states the container lists use.
 *
 * Descending, ascending, then back to the default. The third click matters: a sort that
 * cannot be removed is a sort someone works around by making another view, which is how
 * archives and lists multiply. Removing the *last* sort returns to the default rather
 * than leaving the table unsorted, which reads as arbitrary.
 */
export function applyArchiveSort(
  sort: SortRule[],
  field: string,
  fallback: SortRule[],
): SortRule[] {
  const existing = sort.find((rule) => rule.field === field);

  if (existing === undefined) {
    return [
      { field, direction: 'desc', nulls: 'last' },
      ...sort.filter((rule) => rule.field !== field),
    ];
  }

  if (existing.direction === 'desc') {
    return sort.map((rule) =>
      rule.field === field ? { ...rule, direction: 'asc' as const } : rule,
    );
  }

  const without = sort.filter((rule) => rule.field !== field);
  return without.length === 0 ? fallback : without;
}

export function isPrimaryArchiveSort(sort: SortRule[], field: string): boolean {
  return sort[0]?.field === field;
}
