/**
 * Turning filter and sort ASTs into parameterised SQL.
 *
 * Two rules hold throughout:
 *
 * 1. Values are always bound, never interpolated. Field *keys* are interpolated,
 *    because a key has to sit inside a SQL expression and cannot be a bind
 *    parameter, so keys are checked against a strict pattern first.
 * 2. A key that no field definition claims is rejected rather than compiled. A
 *    typo in a filter should surface as an error, not as a query that silently
 *    returns nothing and looks like an empty list.
 */

import type { FieldType } from '../fields/index.js';
import {
  ARRAY_VALUE_OPERATORS,
  CONTEXTS_KEY,
  CORE_ITEM_COLUMNS,
  CORE_ITEM_TYPES,
  DATA_COLUMN,
  LIST_OPERATORS,
  MAX_FILTER_DEPTH,
  OPERATORS_BY_TYPE,
  SCALAR_VALUE_OPERATORS,
  UNARY_OPERATORS,
  type FilterCondition,
  type FilterNode,
  type FilterValue,
  type FieldRef,
  type QuerySpec,
  type SortRule,
} from './types.js';

/** A value bound into a clause. Matches the SQLite driver's parameter type. */
export type BindValue = string | number | null;

export interface CompiledWhere {
  sql: string;
  params: BindValue[];
}

/** Resolves a field key to a SQL expression plus the type used to validate operators. */
export interface FieldResolver {
  /** SQL expression yielding the field's value for a row of `items`. */
  expression(key: FieldRef): string;
  /** The field's type, or `null` when the key is not a known field. */
  type(key: FieldRef): FieldType | null;
  /** True when the value lives in a first-class column rather than the data blob. */
  isCore(key: FieldRef): boolean;
}

export class InvalidQueryError extends Error {
  readonly path: string;

  constructor(message: string, path = '') {
    super(path ? `${path}: ${message}` : message);
    this.name = 'InvalidQueryError';
    this.path = path;
  }
}

/**
 * Field keys are interpolated into SQL, so this pattern is the security boundary
 * for keys that are *not* fixed constants. Every derived field key already
 * satisfies it, being lower snake_case.
 */
const SAFE_CUSTOM_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Rejects a key that could break out of a SQL expression.
 *
 * Two namespaces share the key space. Core column keys are camelCase constants
 * drawn from `CORE_ITEM_COLUMNS`, so they are safe by construction and are
 * recognised via the resolver. Everything else is user-defined and must match the
 * snake_case pattern.
 */
function assertUsableKey(key: string, path: string, resolver: FieldResolver): void {
  if (resolver.isCore(key)) {
    return;
  }
  if (!SAFE_CUSTOM_KEY.test(key)) {
    throw new InvalidQueryError(`Unsafe field key "${key}"`, path);
  }
}

/** json_extract over the data blob. `data_json` is a literal, `key` is checked. */
function dataExpression(key: string): string {
  return `json_extract(${DATA_COLUMN}, '$.${key}')`;
}

/** Subquery testing membership in a JSON array expression. */
function jsonEachExists(expression: string): string {
  return `EXISTS (SELECT 1 FROM json_each(${expression}) WHERE value = ?)`;
}

/**
 * Escapes LIKE wildcards so a search for "50%" does not match everything.
 *
 * The caller supplies `ESCAPE '\'`.
 */
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

/** Booleans are stored as 0/1 in JSON payloads, since SQLite has no boolean literal. */
function toBindable(value: FilterValue | undefined): BindValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return typeof value === 'number' ? value : String(value);
}

function bind(value: FilterValue | undefined, params: BindValue[]): string {
  params.push(toBindable(value));
  return '?';
}

function validateCondition(
  condition: FilterCondition,
  resolver: FieldResolver,
  path: string,
): void {
  assertUsableKey(condition.field, path, resolver);

  const type = resolver.type(condition.field);
  if (type === null) {
    throw new InvalidQueryError(`Unknown field "${condition.field}"`, path);
  }

  const allowed = OPERATORS_BY_TYPE[type];
  if (!allowed.includes(condition.operator)) {
    throw new InvalidQueryError(
      `Operator "${condition.operator}" is not valid for a "${type}" field. Allowed: ${allowed.join(', ')}`,
      path,
    );
  }

  if (UNARY_OPERATORS.has(condition.operator)) {
    if (condition.value !== undefined) {
      throw new InvalidQueryError(`Operator "${condition.operator}" takes no value`, path);
    }
    return;
  }

  if (condition.value === undefined) {
    throw new InvalidQueryError(`Operator "${condition.operator}" requires a value`, path);
  }

  if (ARRAY_VALUE_OPERATORS.has(condition.operator)) {
    if (!Array.isArray(condition.value) || condition.value.length !== 2) {
      throw new InvalidQueryError(
        `Operator "${condition.operator}" requires an array of exactly two values`,
        path,
      );
    }
    return;
  }

  if (LIST_OPERATORS.has(condition.operator)) {
    if (!Array.isArray(condition.value) || condition.value.length === 0) {
      throw new InvalidQueryError(
        `Operator "${condition.operator}" requires a non-empty array`,
        path,
      );
    }
    return;
  }

  if (SCALAR_VALUE_OPERATORS.has(condition.operator) && Array.isArray(condition.value)) {
    throw new InvalidQueryError(
      `Operator "${condition.operator}" requires a single value, not an array`,
      path,
    );
  }
}

/**
 * Case-insensitive column expression, for the operators where users expect
 * search semantics rather than exact matching.
 *
 * `equals` deliberately stays case-sensitive, because it is what selects a
 * machine value such as a priority or a category key. `contains` and the
 * prefix/suffix operators are free-text search, and someone typing "dentist"
 * should find "Call the dentist" and "DENTIST appointment" alike.
 */
function searchable(expression: string, type: FieldType): string {
  switch (type) {
    case 'text':
    case 'longtext':
    case 'url':
      return `lower(${expression})`;
    default:
      return expression;
  }
}

function compileCondition(
  condition: FilterCondition,
  resolver: FieldResolver,
  params: BindValue[],
): string {
  const expression = resolver.expression(condition.field);
  const { operator, value } = condition;
  const type = resolver.type(condition.field);

  switch (operator) {
    case 'is_null':
      return `${expression} IS NULL`;

    case 'is_not_null':
      return `${expression} IS NOT NULL`;

    // One condition for every empty representation, because a field can be
    // absent from the blob, an empty string, or an empty JSON collection, and a
    // user filtering by "no assignee" means all three.
    case 'is_empty':
      return `(${expression} IS NULL OR ${expression} IN ('', '[]', '{}'))`;

    case 'not_empty':
      return `(${expression} IS NOT NULL AND ${expression} NOT IN ('', '[]', '{}'))`;

    case 'contains': {
      const haystack = searchable(`COALESCE(${expression}, '')`, type ?? 'text');
      const lowered = bind(
        typeof value === 'string' ? value.toLowerCase() : String(value ?? ''),
        params,
      );
      return `instr(${haystack}, ${lowered}) > 0`;
    }

    case 'not_contains': {
      const haystack = searchable(`COALESCE(${expression}, '')`, type ?? 'text');
      const lowered = bind(
        typeof value === 'string' ? value.toLowerCase() : String(value ?? ''),
        params,
      );
      return `instr(${haystack}, ${lowered}) = 0`;
    }

    case 'starts_with': {
      const prefix =
        typeof value === 'string'
          ? escapeLike(value.toLowerCase())
          : escapeLike(String(value ?? ''));
      return `${searchable(expression, type ?? 'text')} LIKE ${bind(`${prefix}%`, params)} ESCAPE '\\'`;
    }

    case 'ends_with': {
      const suffix =
        typeof value === 'string'
          ? escapeLike(value.toLowerCase())
          : escapeLike(String(value ?? ''));
      return `${searchable(expression, type ?? 'text')} LIKE ${bind(`%${suffix}`, params)} ESCAPE '\\'`;
    }

    case 'equals':
      return `${expression} = ${bind(value, params)}`;

    case 'not_equals':
      // Null never equals anything, so an explicit IS NULL branch is needed or
      // "not assigned" would exclude every unassigned item.
      return `(${expression} IS NULL OR ${expression} != ${bind(value, params)})`;

    case 'gt':
      return `${expression} > ${bind(value, params)}`;
    case 'gte':
      return `${expression} >= ${bind(value, params)}`;
    case 'lt':
      return `${expression} < ${bind(value, params)}`;
    case 'lte':
      return `${expression} <= ${bind(value, params)}`;

    case 'between': {
      const [low, high] = value as [FilterValue, FilterValue];
      return `${expression} BETWEEN ${bind(low, params)} AND ${bind(high, params)}`;
    }

    case 'in':
    case 'not_in': {
      const values = value as FilterValue[];
      const placeholders = values.map((entry) => bind(entry, params)).join(', ');
      return operator === 'in'
        ? `${expression} IN (${placeholders})`
        : `(${expression} IS NULL OR ${expression} NOT IN (${placeholders}))`;
    }

    case 'has_any': {
      // A single EXISTS with the values IN-list, so one subquery rather than one
      // per value.
      const values = value as FilterValue[];
      const placeholders = values.map((entry) => bind(entry, params)).join(', ');
      return `EXISTS (SELECT 1 FROM json_each(${expression}) WHERE value IN (${placeholders}))`;
    }

    case 'has_all': {
      // One EXISTS per value: all of them must be present.
      const values = value as FilterValue[];
      return `(${values
        .map((entry) => {
          params.push(toBindable(entry));
          return jsonEachExists(expression);
        })
        .join(' AND ')})`;
    }

    default:
      throw new InvalidQueryError(`Unhandled operator "${String(operator)}"`);
  }
}

function compileNode(
  node: FilterNode,
  resolver: FieldResolver,
  params: BindValue[],
  depth: number,
  path: string,
): string {
  if (depth > MAX_FILTER_DEPTH) {
    throw new InvalidQueryError(`Filter nested deeper than ${MAX_FILTER_DEPTH} levels`, path);
  }

  if (node.kind === 'condition') {
    validateCondition(node, resolver, path);
    return compileCondition(node, resolver, params);
  }

  if (node.kind === 'group') {
    if (node.children.length === 0) {
      // An empty group constrains nothing. Matching everything keeps callers from
      // having to special-case a group that lost all its children.
      return '1 = 1';
    }
    const parts = node.children.map((child, index) =>
      compileNode(child, resolver, params, depth + 1, `${path}[${index}]`),
    );
    const joiner = node.conjunction === 'or' ? ' OR ' : ' AND ';
    // Parenthesised so a nested OR cannot escape its enclosing group.
    return `(${parts.join(joiner)})`;
  }

  throw new InvalidQueryError('Unknown filter node', path);
}

/**
 * Compiles a filter tree into a WHERE clause.
 *
 * An absent filter compiles to an empty clause with no parameters, so callers do
 * not have to branch.
 */
export function compileFilter(
  filter: FilterNode | null | undefined,
  resolver: FieldResolver,
): CompiledWhere {
  if (filter === null || filter === undefined) {
    return { sql: '', params: [] };
  }
  const params: BindValue[] = [];
  return { sql: compileNode(filter, resolver, params, 1, 'filter'), params };
}

/** Case-insensitive collation for text-like types, so "apple" and "Apple" sort together. */
function collationFor(type: FieldType): string {
  switch (type) {
    case 'text':
    case 'longtext':
    case 'url':
    case 'select':
    case 'priority':
      return ' COLLATE NOCASE';
    default:
      return '';
  }
}

/**
 * Compiles sort rules into an ORDER BY clause.
 *
 * Every clause ends with `id ASC` as a tiebreaker. Without it, two items with
 * identical keys can swap places between requests, which shows up in the UI as
 * rows visibly jumping when a column is clicked to reverse the sort.
 */
export function compileSort(sort: SortRule[] | undefined, resolver: FieldResolver): string {
  if (!sort || sort.length === 0) {
    return 'created_at DESC, id ASC';
  }

  const parts: string[] = [];
  const sorted = new Set<string>();

  for (const rule of sort) {
    assertUsableKey(rule.field, 'sort', resolver);
    const type = resolver.type(rule.field);
    if (type === null) {
      throw new InvalidQueryError(`Unknown field "${rule.field}"`, 'sort');
    }
    sorted.add(rule.field);

    const direction = rule.direction === 'desc' ? 'DESC' : 'ASC';
    // Undated work sinks by default rather than crowding the top of the list.
    // Normalised to upper case so every emitted clause reads identically,
    // whatever casing the request used.
    const nulls = (rule.nulls ?? (rule.direction === 'desc' ? 'first' : 'last')).toUpperCase();
    parts.push(
      `${resolver.expression(rule.field)}${collationFor(type)} ${direction} NULLS ${nulls}`,
    );
  }

  if (!sorted.has('createdAt')) {
    parts.push('created_at DESC');
  }
  parts.push('id ASC');

  return parts.join(', ');
}

export function resolvePageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return 50;
  }
  return Math.min(Math.floor(limit), 500);
}

export function resolveOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset <= 0) {
    return 0;
  }
  return Math.floor(offset);
}

/**
 * A caller-supplied SQL predicate to AND in before the caller's filter.
 *
 * Used for scoping a query to a subset the AST cannot express, such as "exclude
 * recurring series templates". The SQL is written by repository code against a
 * known table, never by a client, so it is not an injection vector; callers must
 * still bind any values through `params`.
 */
export interface SqlGuard {
  sql: string;
  params?: BindValue[];
}

export interface CompiledQuery {
  /**
   * A complete trailing clause, ready to concatenate after a `FROM items`.
   *
   * Assembled here rather than by the caller because getting it wrong is easy
   * and produces either a syntax error or a silently unfiltered query: an absent
   * filter must not leave a dangling `WHERE`, and an absent offset must not leave
   * a dangling comma.
   *
   * Always non-empty, since ORDER BY always contributes at least a tiebreaker.
   */
  clause: string;
  /** Bind values for `clause`, in placeholder order. */
  params: BindValue[];
  /** The `WHERE` fragment on its own, including the keyword. */
  whereSql: string;
  /** Bind values for `whereSql`, in placeholder order. */
  whereParams: BindValue[];
}

/**
 * Compiles a whole query specification into a trailing SQL clause.
 *
 * Used as `SELECT ... FROM items ${compiled.clause}` with `compiled.params`
 * spread into the call. The `whereSql`/`whereParams` pair is exposed so a caller
 * can run a COUNT over exactly the same rows, which is what stops a paged result
 * and its total disagreeing.
 */
export function compileQuery(
  spec: QuerySpec,
  resolver: FieldResolver,
  guards: SqlGuard[] = [],
): CompiledQuery {
  const where = compileFilter(spec.filter, resolver);
  const orderBy = compileSort(spec.sort, resolver);
  const limit = resolvePageSize(spec.limit);
  const offset = resolveOffset(spec.offset);

  // Guard parameters bind first, matching the order the guards appear in.
  const guardParams: BindValue[] = [];
  const predicates = guards.map((guard) => {
    for (const value of guard.params ?? []) {
      guardParams.push(value);
    }
    return `(${guard.sql})`;
  });

  if (where.sql !== '') {
    predicates.push(`(${where.sql})`);
  }
  if (predicates.length === 0) {
    predicates.push('1 = 1');
  }

  const whereSql = `WHERE ${predicates.join(' AND ')}`;
  const whereParams = [...guardParams, ...where.params];

  const parts = [whereSql, `ORDER BY ${orderBy}`];

  // SQLite requires LIMIT before OFFSET. Both are bound, so a limit is never
  // spliced in as a literal.
  parts.push('LIMIT ?');

  const params = [...whereParams, limit];
  if (offset > 0) {
    parts.push('OFFSET ?');
    params.push(offset);
  }

  return { clause: parts.join(' '), params, whereSql, whereParams };
}

export interface ItemFieldResolverOptions {
  /**
   * CamelCase names of first-class item columns. Defaults to every column.
   * Narrowing this is how a caller restricts a query to a category's own schema.
   */
  coreKeys?: Iterable<string>;
  /**
   * User-defined fields, so their operators can be validated. Without these, a
   * filter on a custom field is rejected as unknown rather than compiled.
   */
  fieldTypes?: Iterable<{ key: string; type: FieldType }>;
}

const DEFAULT_CORE_KEYS: readonly string[] = Object.keys(CORE_ITEM_COLUMNS);

/**
 * Builds a resolver over the items table.
 *
 * Core keys map to their real column, `contexts` maps to the JSON array column,
 * and everything else is resolved against the data blob.
 */
export function createItemFieldResolver(options: ItemFieldResolverOptions = {}): FieldResolver {
  const core = new Set(options.coreKeys ?? DEFAULT_CORE_KEYS);
  const custom = new Map<string, FieldType>();
  for (const field of options.fieldTypes ?? []) {
    custom.set(field.key, field.type);
  }

  const resolver: FieldResolver = {
    expression(key: string): string {
      assertUsableKey(key, 'field', resolver);
      if (key === CONTEXTS_KEY) {
        return 'contexts_json';
      }
      const column = CORE_ITEM_COLUMNS[key as keyof typeof CORE_ITEM_COLUMNS];
      if (core.has(key) && column) {
        return column;
      }
      return dataExpression(key);
    },

    type(key: string): FieldType | null {
      if (key === CONTEXTS_KEY) {
        return 'multiselect';
      }
      const coreType = CORE_ITEM_TYPES[key as keyof typeof CORE_ITEM_TYPES];
      if (core.has(key) && coreType) {
        return coreType;
      }
      return custom.get(key) ?? null;
    },

    isCore(key: string): boolean {
      return key === CONTEXTS_KEY || (core.has(key) && key in CORE_ITEM_COLUMNS);
    },
  };

  return resolver;
}
