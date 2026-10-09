/**
 * Which columns a list shows, and in what order.
 *
 * The set is not fixed. Every field definition marked `showInTable` appears, and a
 * person can hide any of them and reorder what is left. That is the whole point of
 * configurable fields: a field you added because you care about it should be
 * visible in the list you work from, and a field you added once should be able to
 * disappear.
 *
 * Config is per view. Hiding "Waiting on" from next actions is exactly right and
 * hiding it from the waiting list is exactly wrong, so there is no global default
 * to get wrong.
 */

import type { FieldDefinition } from '../types';

export type ColumnKind =
  'text' | 'date' | 'datetime' | 'duration' | 'number' | 'boolean' | 'list' | 'person' | 'choice';

export interface ColumnSpec {
  /** The key used in sort rules and filters. */
  key: string;
  label: string;
  kind: ColumnKind;
  /** Right-aligned, because numbers and durations read wrong centred or left. */
  align: 'left' | 'right';
  /** Custom fields are looked up in `item.values`, core fields are on the item. */
  source: 'core' | 'custom';
}

/** Columns every list has, in a sensible default order. */
export const CORE_COLUMNS: ColumnSpec[] = [
  { key: 'title', label: 'Title', kind: 'text', align: 'left', source: 'core' },
  { key: 'deadlineOn', label: 'Deadline', kind: 'date', align: 'left', source: 'core' },
  { key: 'whenAt', label: 'Hard date', kind: 'datetime', align: 'left', source: 'core' },
  { key: 'estimateMinutes', label: 'Est.', kind: 'duration', align: 'right', source: 'core' },
  { key: 'projectId', label: 'Project', kind: 'text', align: 'left', source: 'core' },
  { key: 'contexts', label: 'Context', kind: 'list', align: 'left', source: 'core' },
  { key: 'waitingOnPersonId', label: 'Waiting on', kind: 'person', align: 'left', source: 'core' },
  { key: 'followUpAt', label: 'Follow up', kind: 'date', align: 'left', source: 'core' },
  { key: 'categoryId', label: 'Category', kind: 'text', align: 'left', source: 'core' },
  { key: 'createdAt', label: 'Captured', kind: 'datetime', align: 'left', source: 'core' },
  { key: 'completedAt', label: 'Completed', kind: 'datetime', align: 'left', source: 'core' },
];

const KIND_BY_TYPE: Record<string, ColumnKind> = {
  text: 'text',
  longtext: 'text',
  number: 'number',
  duration: 'duration',
  select: 'choice',
  multiselect: 'choice',
  priority: 'choice',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  person: 'person',
  people: 'list',
  checklist: 'list',
  url: 'text',
};

/**
 * The default columns for a view: the fields the person marked as table columns,
 * plus the core columns that matter for this container.
 *
 * A container gets a different core set on purpose. A calendar list without a hard
 * date column is useless, and a waiting list without "waiting on" is missing the
 * only thing that makes waiting actionable.
 */
export function defaultColumns(container: string, definitions: FieldDefinition[]): ColumnSpec[] {
  const core = new Set(['title', 'deadlineOn', 'estimateMinutes']);
  if (container === 'calendar') {
    core.add('whenAt');
  }
  if (container === 'waiting') {
    core.add('waitingOnPersonId');
    core.add('followUpAt');
  }
  if (container === 'done' || container === 'archive') {
    core.add('completedAt');
  }
  if (container === 'someday' || container === 'reference') {
    core.add('projectId');
  }

  const coreColumns = CORE_COLUMNS.filter((column) => core.has(column.key));
  const custom = definitions
    .filter((definition) => definition.showInTable)
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      kind: KIND_BY_TYPE[definition.type] ?? 'text',
      align: 'left' as const,
      source: 'custom' as const,
    }))
    // A custom field may shadow a core key if someone labelled theirs "Title";
    // the core column wins, because that is the one with a real value.
    .filter((column) => !coreColumns.some((existing) => existing.key === column.key));

  return [...coreColumns, ...custom];
}

export interface ColumnConfig {
  hidden: string[];
  /** Explicit order by key. Anything not listed keeps its default position. */
  order: string[];
}

/**
 * Applies saved configuration to the default set.
 *
 * Written as "hide and reorder" rather than "this exact list of columns" so that
 * adding a new field definition shows up in existing views. A view pinned to an exact
 * column list would silently not show a field someone just added, which is the exact
 * moment they would be looking for it.
 */
export function applyColumnConfig(
  defaults: ColumnSpec[],
  config: ColumnConfig | null,
): ColumnSpec[] {
  if (!config) {
    return defaults;
  }

  const hidden = new Set(config.hidden);
  const visible = defaults.filter((column) => !hidden.has(column.key));

  if (config.order.length === 0) {
    return visible;
  }

  const rank = new Map(config.order.map((key, index) => [key, index]));
  return [...visible].sort((a, b) => {
    const left = rank.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const right = rank.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    // Equal rank keeps the default order, which `sort` is not guaranteed to do.
    return left === right ? 0 : left - right;
  });
}

export function toggleHidden(config: ColumnConfig | null, key: string): ColumnConfig {
  const hidden = config?.hidden ?? [];
  return {
    ...(config ?? { order: [] }),
    hidden: hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key],
  };
}

export function moveColumn(config: ColumnConfig | null, key: string, delta: number): ColumnConfig {
  const current = config ?? { hidden: [], order: [] };
  const order = current.order.length > 0 ? [...current.order] : [];
  const index = order.indexOf(key);

  if (index === -1) {
    // Not explicitly ordered yet, so pin the whole current order first. Otherwise a
    // single move would put one column at the front and leave everything else in an
    // order the user never chose.
    return { ...current, order: [key] };
  }

  const target = Math.max(0, Math.min(order.length - 1, index + delta));
  order.splice(index, 1);
  order.splice(target, 0, key);
  return { ...current, order };
}
