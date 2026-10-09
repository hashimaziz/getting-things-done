/**
 * Types shared with the API.
 *
 * Re-declared rather than imported, because `@gtd/core` is a Node-targeted package:
 * importing it into the browser bundle would drag `date-fns`, `rrule` and the Zod
 * schema for field definitions into the client, which are all only needed
 * server-side. The types are structural, so drift is caught by the API tests rather
 * than by a compile error, which is the deliberate trade for a bundle that does not
 * ship a date library to run one screen.
 *
 * Everything here that could have come from core is documented as such.
 */

/** ISO calendar day, `YYYY-MM-DD`. Mirrors core's IsoDate. */
export type IsoDate = string;

/** ISO 8601 instant. Mirrors core's IsoDateTime. */
export type IsoDateTime = string;

/** Mirrors core's Container. */
export type Container =
  'inbox' | 'next_action' | 'calendar' | 'waiting' | 'someday' | 'reference' | 'done' | 'trash';

/** Mirrors core's FieldType. */
export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'duration'
  | 'select'
  | 'multiselect'
  | 'priority'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'person'
  | 'people'
  | 'checklist'
  | 'url';

export type FieldValue =
  string | number | boolean | null | string[] | Array<{ id: string; label: string; done: boolean }>;

/** Mirrors core's FieldChoice. */
export interface FieldChoice {
  value: string;
  label: string;
  color: string | null;
  order: number;
}

/** Mirrors core's FieldOptions. */
export type FieldOptions =
  | { kind: 'none' }
  | { kind: 'choices'; choices: FieldChoice[] }
  | {
      kind: 'number';
      min: number | null;
      max: number | null;
      step: number | null;
      prefix: string | null;
      suffix: string | null;
    }
  | { kind: 'duration'; presetsMinutes: number[] }
  | { kind: 'checklist'; maxItems: number | null };

/** Mirrors core's FieldDefinition. */
export interface FieldDefinition {
  id: string;
  categoryId: string | null;
  key: string;
  label: string;
  description: string | null;
  type: FieldType;
  options: FieldOptions;
  required: boolean;
  defaultValue: FieldValue;
  groupLabel: string | null;
  showInTable: boolean;
  showInCard: boolean;
  filterable: boolean;
  sortable: boolean;
  isCore: boolean;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Mirrors core's Category. */
export interface Category {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isArchived: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Mirrors core's Item, plus the resolved field values the API adds. */
export interface Item {
  id: string;
  categoryId: string;
  title: string;
  container: Container;
  notes: string | null;
  whenAt: IsoDateTime | null;
  deadlineOn: IsoDate | null;
  estimateMinutes: number | null;
  projectId: string | null;
  waitingOnPersonId: string | null;
  followUpAt: IsoDateTime | null;
  contextIds: string[];
  recurrenceId: string | null;
  parentItemId: string | null;
  occurrenceDate: IsoDate | null;
  isTemplate: boolean;
  data: Record<string, FieldValue>;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  trashedAt: IsoDateTime | null;
  /** Present on responses that expand the item. */
  values?: Record<string, FieldValue>;
}

/**
 * The static application identity, mirrored from core's `APP_CONFIG`.
 *
 * Only the parts the browser needs: the product name and the API path prefix.
 * Nothing here is user-configurable — anything a person should be able to change
 * belongs in the database, not in this object. A test asserts this stays in step
 * with core, which is the price of not importing a Node-targeted package for two
 * strings.
 */
export const APP_CONFIG = {
  identity: { name: 'GTD', shortName: 'GTD' },
  paths: { apiBasePath: '/api' },
} as const;

export type ExpandedLike = Item;

export interface Project {
  id: string;
  name: string;
  outcome: string | null;
  categoryId: string | null;
  status: 'active' | 'someday' | 'completed' | 'dropped';
  reviewAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  notes: string | null;
  categoryId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Context {
  id: string;
  name: string;
  categoryId: string | null;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Mirrors core's ActivityVerb. */
export type ActivityVerb =
  'created' | 'updated' | 'completed' | 'reopened' | 'trashed' | 'restored' | 'moved' | 'clarified';

export interface ActivityEntry {
  id: string;
  itemId: string;
  verb: ActivityVerb;
  at: IsoDateTime;
  from: Record<string, unknown> | null;
  to: Record<string, unknown> | null;
  title?: string;
}

/** Mirrors core's MetricPoint. */
export interface MetricPoint {
  key: string;
  label: string;
  count: number;
  minutes: number;
  estimated: number;
}

/** Mirrors core's DailyPoint. */
export interface DailyPoint {
  date: IsoDate;
  count: number;
  minutes: number;
}

/** Mirrors core's SystemHealth. */
export interface SystemHealth {
  inboxBacklog: number;
  inboxOldest: IsoDate | null;
  overdue: number;
  dueSoon: number;
  scheduledOn: IsoDate;
  scheduledCount: number;
  waiting: number;
  waitingOverdue: number;
  waitingOldestDays: number;
  someday: number;
  openWithoutEstimate: number;
  openMinutes: number;
  openWithoutProject: number;
  ageing?: Array<{ label: string; minDays: number; maxDays: number | null; count: number }>;
  projectsWithoutNextAction?: Array<{ id: string; name: string }>;
}

/** Mirrors core's InvariantKind. */
export type InvariantKind =
  | 'project_without_next_action'
  | 'waiting_without_follow_up'
  | 'calendar_without_date'
  | 'stale_inbox_item'
  | 'completed_without_timestamp'
  | 'open_without_estimate';

export interface SystemViolation {
  kind: InvariantKind;
  severity: 'error' | 'warning';
  message: string;
  itemIds: string[];
  projectIds: string[];
}

export interface ReviewStep {
  id: string;
  title: string;
  description: string;
  source: string;
  phase: 'get_clear' | 'get_current' | 'get_creative';
}

export interface ReviewProgress {
  step: ReviewStep;
  pending: number;
  problems: number;
  satisfied: boolean;
}

export interface Recommendation {
  id: string;
  kind: 'suggest_action' | 'flag_risk' | 'propose_schedule' | 'ask_question';
  title: string;
  detail: string;
  reason: string;
  confidence: number;
  itemId?: string;
  tags: string[];
  rank: number;
  item?: Item;
}

export interface ContainerSpec {
  container: Container;
  label: string;
  description: string;
  isActionContainer: boolean;
  isTransient: boolean;
  reviewCadence: 'daily' | 'weekly' | 'monthly' | 'rarely';
}

/** Mirrors core's FilterNode, the subset the web builds. */
export type FilterNode =
  | {
      kind: 'condition';
      field: string;
      operator: string;
      value?: string | number | boolean | null | Array<string | number>;
    }
  | { kind: 'group'; conjunction: 'and' | 'or'; children: FilterNode[] };

export interface SortRule {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface Facet {
  field: string;
  label: string;
  type: string;
  isOpen: boolean;
  values: FacetValue[];
}

/** A recurring series' occurrences. */
export interface Occurrence {
  date: IsoDate;
  at: IsoDateTime | null;
}

export interface RecurrenceSpec {
  rrule: string;
  timezone: string;
  anchorDate: IsoDate;
  timeOfDay: { hour: number; minute: number } | null;
  until: IsoDate | null;
  count: number | null;
}

export interface DashboardWidget {
  id: string;
  type: string;
  title: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, unknown>;
}

export interface Dashboard {
  id: string;
  key: string;
  name: string;
  widgets: DashboardWidget[];
  isDefault: boolean;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
