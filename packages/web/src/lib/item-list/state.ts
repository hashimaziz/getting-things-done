/**
 * The state of a list view.
 *
 * The whole thing lives in the URL. That is a deliberate decision with three
 * consequences worth naming:
 *
 * - A filtered list is a link. "Next actions in Work with no deadline, sorted by
 *   priority" can be bookmarked, sent to someone, or opened on a phone. In a GTD
 *   system, a view you cannot return to is a view you will rebuild from scratch.
 * - The back button undoes a filter change, which is the behaviour people expect
 *   and which no amount of cleverness in a state store reproduces.
 * - There is no server-side view state to keep in sync, so a list cannot disagree
 *   with the address bar.
 *
 * The parsing here is defensive on purpose. The URL is the one place a person can
 * edit by hand, so a malformed parameter produces the default view and a discarded
 * bad value rather than an error page.
 */

import type { FilterNode, SortRule } from '../types';

/** The fields a filter may name, in the order the filter editor offers them. */
export interface FilterFieldSpec {
  key: string;
  label: string;
  /** Which operators make sense, narrowing the choices to ones that mean something. */
  operators: string[];
  /** 'text' takes one value, 'list' takes several, 'none' is unary, 'date' a range. */
  valueKind: 'text' | 'number' | 'list' | 'none' | 'date';
}

export const FILTER_FIELDS: FilterFieldSpec[] = [
  {
    key: 'title',
    label: 'Title',
    operators: ['contains', 'equals', 'starts_with', 'is_empty', 'not_empty'],
    valueKind: 'text',
  },
  {
    key: 'container',
    label: 'Container',
    operators: ['equals', 'not_equals', 'in'],
    valueKind: 'list',
  },
  {
    key: 'categoryId',
    label: 'Category',
    operators: ['equals', 'not_equals'],
    valueKind: 'text',
  },
  {
    key: 'projectId',
    label: 'Project',
    operators: ['is_empty', 'not_empty', 'equals'],
    valueKind: 'text',
  },
  {
    key: 'deadlineOn',
    label: 'Deadline',
    operators: ['equals', 'lt', 'lte', 'gt', 'gte', 'between', 'is_null', 'is_not_null'],
    valueKind: 'date',
  },
  {
    key: 'whenAt',
    label: 'Hard date',
    operators: ['between', 'is_null', 'is_not_null'],
    valueKind: 'date',
  },
  {
    key: 'estimateMinutes',
    label: 'Estimate (minutes)',
    operators: ['lte', 'gte', 'between', 'is_null', 'is_not_null'],
    valueKind: 'number',
  },
  {
    key: 'waitingOnPersonId',
    label: 'Waiting on',
    operators: ['is_empty', 'not_empty', 'equals'],
    valueKind: 'text',
  },
  {
    key: 'followUpAt',
    label: 'Follow-up date',
    operators: ['lt', 'lte', 'between', 'is_null', 'is_not_null'],
    valueKind: 'date',
  },
  {
    key: 'contexts',
    label: 'Context',
    operators: ['has_any', 'has_all'],
    valueKind: 'list',
  },
  {
    key: 'createdAt',
    label: 'Captured',
    operators: ['between', 'lt', 'gte'],
    valueKind: 'date',
  },
];

/** Sortable fields, and whether ascending is the useful default. */
export const SORT_FIELDS: Array<{ key: string; label: string; defaultDirection: 'asc' | 'desc' }> =
  [
    { key: 'title', label: 'Title', defaultDirection: 'asc' },
    { key: 'deadlineOn', label: 'Deadline', defaultDirection: 'asc' },
    { key: 'whenAt', label: 'Hard date', defaultDirection: 'asc' },
    { key: 'estimateMinutes', label: 'Estimate', defaultDirection: 'asc' },
    { key: 'createdAt', label: 'Captured', defaultDirection: 'desc' },
    { key: 'sortOrder', label: 'Manual order', defaultDirection: 'asc' },
  ];

/** A single filter condition, as edited. */
export interface Condition {
  field: string;
  operator: string;
  /** A string, a number, a list, or nothing for unary operators. */
  value?: string | number | Array<string | number>;
}

export interface ListViewState {
  /** An extra container condition, or null when the view is not container-scoped. */
  container: string | null;
  conditions: Condition[];
  sort: SortRule[];
  page: number;
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 50;

export function defaultState(container: string | null): ListViewState {
  return {
    container,
    conditions: [],
    // Undated work sinks by default: a list of tasks should read as a list of tasks,
    // not as a wall of blanks. Nulls-last is what the server does anyway, so saying
    // it here keeps the URL honest about what is being asked for.
    sort: [{ field: 'deadlineOn', direction: 'asc', nulls: 'last' }],
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

/* ------------------------------------------------------------------ parsing */

function parseJson<T>(raw: string | null): T | null {
  if (raw === null || raw === '') {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A hand-edited or truncated URL parameter. Discarding it is better than
    // refusing to render the list.
    return null;
  }
}

function isCondition(value: unknown): value is Condition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Condition;
  return (
    typeof candidate.field === 'string' &&
    FILTER_FIELDS.some((field) => field.key === candidate.field) &&
    typeof candidate.operator === 'string'
  );
}

function isSortRule(value: unknown): value is SortRule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as SortRule;
  return (
    typeof candidate.field === 'string' &&
    (candidate.direction === 'asc' || candidate.direction === 'desc')
  );
}

/** Reads the list state out of URL search parameters. */
export function parseViewState(params: URLSearchParams, container: string | null): ListViewState {
  const base = defaultState(container);

  const conditions = parseJson<unknown[]>(params.get('filter'));
  const sort = parseJson<unknown[]>(params.get('sort'));
  const page = Number(params.get('page'));

  return {
    ...base,
    // Only conditions naming fields this build knows are kept. A filter saved by a
    // newer version, or typed by hand, must not be able to produce a query the
    // server will reject — the screen would be permanently broken with no way out
    // except editing the URL by hand.
    conditions: Array.isArray(conditions) ? conditions.filter(isCondition) : [],
    sort:
      Array.isArray(sort) && sort.length > 0 && sort.every(isSortRule)
        ? (sort as SortRule[])
        : base.sort,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Writes the state back into URL search parameters, omitting anything at default. */
export function serialiseViewState(
  state: ListViewState,
  container: string | null,
): URLSearchParams {
  const params = new URLSearchParams();

  if (state.conditions.length > 0) {
    params.set('filter', JSON.stringify(state.conditions));
  }
  if (state.sort.length > 0) {
    params.set('sort', JSON.stringify(state.sort));
  }
  if (state.page > 1) {
    params.set('page', String(state.page));
  }
  if (container !== state.container) {
    // A view scoped to one container reached from another keeps both, so the back
    // button and the link show what is actually being shown.
    params.set('container', state.container ?? '');
  }

  return params;
}

/**
 * The filter to send the server.
 *
 * The container and every condition are combined with AND. The UI builds flat
 * conjunctions because that is what "show me these things" means; the AST supports
 * arbitrary nesting for the API, and this is the one place the difference shows.
 */
export function buildFilterNode(state: ListViewState): FilterNode | null {
  const children: FilterNode[] = [];

  if (state.container !== null) {
    children.push({
      kind: 'condition',
      field: 'container',
      operator: 'equals',
      value: state.container,
    });
  }

  for (const condition of state.conditions) {
    children.push(
      condition.value === undefined
        ? { kind: 'condition', field: condition.field, operator: condition.operator }
        : {
            kind: 'condition',
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
          },
    );
  }

  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0] as FilterNode;
  }
  return { kind: 'group', conjunction: 'and', children };
}

/* ------------------------------------------------------------------ editing */

/**
 * Adds a condition, or replaces the existing one on the same field.
 *
 * Replacing rather than accumulating, because two conditions on one field are
 * almost always a mistake — "deadline before today" and "deadline after this
 * weekend" — and are nearly impossible to express correctly through a UI that
 * shows them as two separate rows.
 */
export function addCondition(state: ListViewState, condition: Condition): ListViewState {
  const withoutField = state.conditions.filter((existing) => existing.field !== condition.field);
  return {
    ...state,
    conditions: [...withoutField, condition],
    // A changed filter means a different result set, so the old page number is
    // meaningless. Staying on page 7 of a now three-page list shows an empty screen
    // and looks like data loss.
    page: 1,
  };
}

export function removeCondition(state: ListViewState, field: string): ListViewState {
  return {
    ...state,
    conditions: state.conditions.filter((existing) => existing.field !== field),
    page: 1,
  };
}

export function clearConditions(state: ListViewState): ListViewState {
  return { ...state, conditions: [], page: 1 };
}

/**
 * Clicking a column header.
 *
 * First click sorts ascending, second flips, third clears and returns to the
 * default. Clearing on the third click matters: a sort that cannot be removed is a
 * sort someone works around by making a new view.
 *
 * With shift held, the column becomes a secondary sort rather than replacing the
 * primary. Multi-column sorting is how you answer "which of these is due first",
 * which is the question a list usually exists to answer.
 */
export function applySort(
  state: ListViewState,
  field: string,
  options: { additive?: boolean } = {},
): ListViewState {
  const spec = SORT_FIELDS.find((entry) => entry.key === field);
  const existing = state.sort.find((rule) => rule.field === field);

  if (existing === undefined) {
    const added: SortRule[] = options.additive === true ? [...state.sort] : [];
    added.push({
      field,
      direction: spec?.defaultDirection ?? 'asc',
      nulls: 'last',
    });
    return { ...state, sort: added, page: 1 };
  }

  if (existing.direction === 'asc') {
    return {
      ...state,
      sort: state.sort.map((rule) =>
        rule.field === field ? { ...rule, direction: 'desc' as const } : rule,
      ),
      page: 1,
    };
  }

  // Third click: back to the default sort.
  const remaining = state.sort.filter((rule) => rule.field !== field);
  return {
    ...state,
    sort: remaining.length === 0 ? defaultState(state.container).sort : remaining,
    page: 1,
  };
}

/** Whether a column is the primary sort, for the header's `aria-sort`. */
export function primarySortDirection(state: ListViewState, field: string): 'asc' | 'desc' | 'none' {
  const rule = state.sort.find((entry) => entry.field === field);
  return rule?.direction ?? 'none';
}

/* -------------------------------------------------------------- describing */

/** The number of pages, at least one, so an empty list says "page 1 of 1". */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Clamps a requested page into range.
 *
 * After a filter change, or after items were completed elsewhere, the page in the
 * URL can point past the end. Showing the last page is nearly right; showing an
 * empty table is confidently wrong.
 */
export function clampPage(page: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize);
  if (page < 1) {
    return 1;
  }
  return Math.min(page, last);
}

const OPERATOR_LABELS: Record<string, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  gt: 'is after',
  gte: 'is on or after',
  lt: 'is before',
  lte: 'is on or before',
  in: 'is any of',
  not_in: 'is none of',
  between: 'is between',
  has_any: 'includes any of',
  has_all: 'includes all of',
  is_empty: 'is empty',
  not_empty: 'is not empty',
  is_null: 'is not set',
  is_not_null: 'is set',
};

/**
 * A plain description of one condition, for the filter chip.
 *
 * The alternative — showing the raw operator — produces "deadlineOn lt 2026-03-01",
 * which describes the query rather than the intent. The point of a filter chip is
 * that you can read back what you asked for.
 */
export function describeCondition(
  condition: Condition,
  fieldLabels: Record<string, string> = {},
): string {
  const label =
    fieldLabels[condition.field] ??
    FILTER_FIELDS.find((f) => f.key === condition.field)?.label ??
    condition.field;
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator;

  if (condition.value === undefined) {
    return `${label} ${operator}`;
  }

  const value = Array.isArray(condition.value)
    ? condition.value.join(', ')
    : condition.operator === 'between' &&
        Array.isArray(condition.value) === false &&
        typeof condition.value === 'string'
      ? condition.value
      : String(condition.value);

  return `${label} ${operator} ${value}`;
}

/** One line describing everything currently narrowing the list. */
export function describeFilters(state: ListViewState): string[] {
  return state.conditions.map((condition) => describeCondition(condition));
}
