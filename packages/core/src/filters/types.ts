/**
 * A typed filter and sort AST.
 *
 * Queries arrive from the UI as nested JSON, and a request like "next actions in
 * Work with a deadline this week, sorted by priority" has to become
 * parameterised SQL. Doing that with string concatenation is how query bugs and
 * injection holes happen, so the request is modelled as data, validated against
 * the field definitions, and only then compiled.
 *
 * Keeping this in `core` rather than in the API means the same compiler serves
 * the web app's list views, the server's REST handlers and the analytics queries,
 * and they cannot drift apart.
 */

import type { FieldType } from '../fields/index.js';

/** A reference to a field by key. Core columns and user-defined fields share one namespace. */
export type FieldRef = string;

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'between'
  | 'has_any'
  | 'has_all'
  | 'is_empty'
  | 'not_empty'
  | 'is_null'
  | 'is_not_null';

export type FilterValue = string | number | boolean | null | Array<string | number>;

export interface FilterCondition {
  kind: 'condition';
  field: FieldRef;
  operator: FilterOperator;
  /** Absent for unary operators. */
  value?: FilterValue;
}

export interface FilterGroup {
  kind: 'group';
  conjunction: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export type SortDirection = 'asc' | 'desc';

export interface SortRule {
  field: FieldRef;
  direction: SortDirection;
  /**
   * Where absent values go. Defaults to last when ascending and first when
   * descending, which matches how a list of tasks should read: undated work
   * sinks, rather than crowding the top.
   */
  nulls?: 'first' | 'last';
}

export interface QuerySpec {
  filter?: FilterNode | null;
  sort?: SortRule[];
  limit?: number;
  offset?: number;
}

/** Hard ceiling on page size, so a client cannot ask for the whole table. */
export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 50;

/** Nesting limit, to keep a hand-crafted request from building a pathological tree. */
export const MAX_FILTER_DEPTH = 6;

/**
 * Operators that take no value. Listing them explicitly lets the validator reject
 * a stray `value` instead of silently ignoring it.
 */
export const UNARY_OPERATORS: ReadonlySet<FilterOperator> = new Set<FilterOperator>([
  'is_empty',
  'not_empty',
  'is_null',
  'is_not_null',
]);

/**
 * Which operators each field type accepts.
 *
 * `contains` on a boolean is not a question anyone means to ask, and letting it
 * compile would silently produce nonsense rather than an error.
 */
export const OPERATORS_BY_TYPE: Record<FieldType, readonly FilterOperator[]> = {
  text: [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'is_empty',
    'not_empty',
    'in',
    'not_in',
  ],
  longtext: ['contains', 'not_contains', 'is_empty', 'not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  duration: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  select: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'not_empty', 'is_null'],
  multiselect: ['has_any', 'has_all', 'is_empty', 'not_empty'],
  priority: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'not_empty', 'is_null'],
  boolean: ['equals', 'not_equals'],
  date: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  datetime: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  person: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'not_empty'],
  people: ['has_any', 'has_all', 'is_empty', 'not_empty'],
  checklist: ['is_empty', 'not_empty'],
  url: ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'is_empty', 'not_empty'],
};

/** Operators that compare against a list of values. */
export const LIST_OPERATORS: ReadonlySet<FilterOperator> = new Set<FilterOperator>([
  'in',
  'not_in',
  'has_any',
  'has_all',
]);

/** Operators that require an array value. */
export const ARRAY_VALUE_OPERATORS: ReadonlySet<FilterOperator> = new Set<FilterOperator>([
  'between',
  'has_all',
]);

/** Operators that require a scalar value. */
export const SCALAR_VALUE_OPERATORS: ReadonlySet<FilterOperator> = new Set<FilterOperator>([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
]);

/** First-class `items` columns, keyed by the camelCase name the API exposes. */
export const CORE_ITEM_COLUMNS = {
  id: 'id',
  title: 'title',
  container: 'container',
  categoryId: 'category_id',
  notes: 'notes',
  whenAt: 'when_at',
  deadlineOn: 'deadline_on',
  estimateMinutes: 'estimate_min',
  projectId: 'project_id',
  waitingOnPersonId: 'waiting_on_person_id',
  followUpAt: 'follow_up_at',
  recurrenceId: 'recurrence_id',
  parentItemId: 'parent_item_id',
  occurrenceDate: 'occurrence_date',
  sortOrder: 'sort_order',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  completedAt: 'completed_at',
  trashedAt: 'trashed_at',
} as const satisfies Record<string, string>;

export type CoreFieldKey = keyof typeof CORE_ITEM_COLUMNS;

/** The declared type of each core column, for operator validation. */
export const CORE_ITEM_TYPES: Record<CoreFieldKey, FieldType> = {
  id: 'text',
  title: 'text',
  container: 'text',
  categoryId: 'text',
  notes: 'longtext',
  whenAt: 'datetime',
  deadlineOn: 'date',
  estimateMinutes: 'duration',
  projectId: 'text',
  waitingOnPersonId: 'text',
  followUpAt: 'datetime',
  recurrenceId: 'text',
  parentItemId: 'text',
  occurrenceDate: 'date',
  sortOrder: 'number',
  createdAt: 'datetime',
  updatedAt: 'datetime',
  completedAt: 'datetime',
  trashedAt: 'datetime',
};

/** Contexts live in a JSON array column rather than a first-class column. */
export const CONTEXTS_KEY = 'contexts';

/** The user-defined field values live in a JSON blob rather than real columns. */
export const DATA_COLUMN = 'data_json';
