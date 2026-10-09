/**
 * Domain entities.
 *
 * These live in `core` rather than in `db` because the web app may only import
 * `core`. Repositories map SQLite rows to these types, so the shape a client
 * receives is defined in one dependency-free place.
 */

import type { IsoDate, IsoDateTime } from './dates/index.js';
import type { FieldDefinition, FieldValue } from './fields/index.js';
import type { Container } from './gtd/index.js';

/* ------------------------------------------------------------------ categories */

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

export interface CreateCategoryInput {
  /** Optional. Derived from the name when omitted or blank. */
  key?: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryPatch {
  key?: string;
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isArchived?: boolean;
}

/* --------------------------------------------------------------------- people */

export interface Person {
  id: string;
  name: string;
  email: string | null;
  notes: string | null;
  /** `null` means the person is relevant regardless of category. */
  categoryId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreatePersonInput {
  name: string;
  email?: string | null;
  notes?: string | null;
  categoryId?: string | null;
}

export interface UpdatePersonPatch {
  name?: string;
  email?: string | null;
  notes?: string | null;
  categoryId?: string | null;
}

/* ------------------------------------------------------------------- contexts */

export interface Context {
  id: string;
  name: string;
  /** `null` means the context applies to every category. */
  categoryId: string | null;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateContextInput {
  name: string;
  categoryId?: string | null;
  sortOrder?: number;
}

export interface UpdateContextPatch {
  name?: string;
  categoryId?: string | null;
  sortOrder?: number;
}

/* ------------------------------------------------------------------- projects */

/**
 * A project is any outcome needing more than one action.
 *
 * Deliberately minimal. Sub-projects and the Natural Planning Model are roadmap
 * items that build on this record rather than replace it.
 */
export type ProjectStatus = 'active' | 'someday' | 'completed' | 'dropped';

export interface Project {
  id: string;
  name: string;
  outcome: string | null;
  categoryId: string | null;
  status: ProjectStatus;
  /** When the project was last reviewed in a weekly review. */
  reviewAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateProjectInput {
  name: string;
  outcome?: string | null;
  categoryId?: string | null;
  status?: ProjectStatus;
}

export interface UpdateProjectPatch {
  name?: string;
  outcome?: string | null;
  categoryId?: string | null;
  status?: ProjectStatus;
  reviewAt?: IsoDateTime | null;
}

/* ----------------------------------------------------------------- recurrence */

export interface RecurrenceRule {
  id: string;
  /** An iCalendar RRULE string, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`. */
  rrule: string;
  timezone: string;
  /** The date the series starts from, which fixes the phase of the pattern. */
  anchorDate: IsoDate;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateRecurrenceRuleInput {
  rrule: string;
  timezone: string;
  anchorDate: IsoDate;
}

export interface UpdateRecurrenceRulePatch {
  rrule?: string;
  timezone?: string;
  anchorDate?: IsoDate;
}

/* -------------------------------------------------------------------- items */

/**
 * A single item. The unit that carries a container, so it is also the unit that
 * the clarify tree classifies and the engagement engine selects.
 */
export interface Item {
  id: string;
  categoryId: string;
  title: string;
  container: Container;
  notes: string | null;
  /** A hard commitment, shown on the calendar. */
  whenAt: IsoDateTime | null;
  /** A soft deadline, a calendar day. Never drives the calendar. */
  deadlineOn: IsoDate | null;
  estimateMinutes: number | null;
  projectId: string | null;
  waitingOnPersonId: string | null;
  followUpAt: IsoDateTime | null;
  contextIds: string[];
  recurrenceId: string | null;
  /** Set on a materialised occurrence of a recurring series. */
  parentItemId: string | null;
  occurrenceDate: IsoDate | null;
  /**
   * True when this row is a recurring series definition rather than a task.
   *
   * A template is excluded from every list and every count. It exists to carry
   * the rule and the fields that new occurrences inherit.
   */
  isTemplate: boolean;
  /** User-defined field values, keyed by field definition key. */
  data: Record<string, FieldValue>;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  trashedAt: IsoDateTime | null;
}

export interface CreateItemInput {
  categoryId: string;
  title: string;
  container?: Container;
  notes?: string | null;
  whenAt?: IsoDateTime | null;
  deadlineOn?: IsoDate | null;
  estimateMinutes?: number | null;
  projectId?: string | null;
  waitingOnPersonId?: string | null;
  followUpAt?: IsoDateTime | null;
  contextIds?: string[];
  recurrenceId?: string | null;
  parentItemId?: string | null;
  occurrenceDate?: IsoDate | null;
  isTemplate?: boolean;
  data?: Record<string, FieldValue>;
  sortOrder?: number;
}

export interface UpdateItemPatch {
  title?: string;
  categoryId?: string;
  container?: Container;
  notes?: string | null;
  whenAt?: IsoDateTime | null;
  deadlineOn?: IsoDate | null;
  estimateMinutes?: number | null;
  projectId?: string | null;
  waitingOnPersonId?: string | null;
  followUpAt?: IsoDateTime | null;
  contextIds?: string[];
  recurrenceId?: string | null;
  sortOrder?: number;
  /**
   * Replaces the whole data map, not a merge. Callers must send the complete set
   * of values they want to keep, which is why the route merges against the
   * existing item before calling.
   */
  data?: Record<string, FieldValue>;
}

/** An item together with the field definitions that apply to its category. */
export interface ItemWithDefinitions {
  item: Item;
  definitions: FieldDefinition[];
}

/* -------------------------------------------------------- checklist templates */

export interface ChecklistTemplateEntry {
  id: string;
  label: string;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  entries: ChecklistTemplateEntry[];
  /** Field keys this template is offered for. Empty means any checklist field. */
  appliesTo: string[];
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateChecklistTemplateInput {
  name: string;
  entries: ChecklistTemplateEntry[];
  appliesTo?: string[];
  sortOrder?: number;
}

export interface UpdateChecklistTemplatePatch {
  name?: string;
  entries?: ChecklistTemplateEntry[];
  appliesTo?: string[];
  sortOrder?: number;
}

/* ------------------------------------------------------------------ dashboards */

/**
 * A widget on a dashboard.
 *
 * Widgets are stored as JSON rather than as rows because a dashboard is only ever
 * read and written as a whole document, never queried across. Each widget names
 * a type that the web app's widget registry resolves, and carries the props that
 * type understands.
 */
export interface DashboardWidget {
  id: string;
  /** A key into the web app's widget registry. */
  type: string;
  title: string | null;
  /** Grid geometry, in column units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Type-specific configuration, such as which filter a list widget shows. */
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

export interface CreateDashboardInput {
  key: string;
  name: string;
  widgets?: DashboardWidget[];
  isDefault?: boolean;
  sortOrder?: number;
}

export interface UpdateDashboardPatch {
  key?: string;
  name?: string;
  widgets?: DashboardWidget[];
  isDefault?: boolean;
  sortOrder?: number;
}

/* --------------------------------------------------------------- activity log */

/** The verbs the activity log records. Append-only. */
export type ActivityVerb =
  'created' | 'updated' | 'completed' | 'reopened' | 'trashed' | 'restored' | 'moved' | 'clarified';

export interface ActivityEntry {
  id: string;
  itemId: string;
  verb: ActivityVerb;
  at: IsoDateTime;
  from: Record<string, unknown> | null;
  to: Record<string, unknown> | null;
}

/* -------------------------------------------------------------------- settings */

export interface Setting<T = unknown> {
  key: string;
  value: T;
  updatedAt: IsoDateTime;
}

/** Keys of settings the app reads at startup. Free-form otherwise. */
export const SETTING_KEYS = {
  /** Set by the setup wizard on completion. Gates the wizard route. */
  setupCompleted: 'setup.completed',
  timezone: 'app.timezone',
  weekStartsOn: 'app.weekStartsOn',
  /** Reminds the user to run a weekly review. */
  lastWeeklyReviewAt: 'review.last_weekly_at',
  nextWeeklyReviewAt: 'review.next_weekly_at',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
