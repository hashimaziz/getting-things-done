/**
 * Formatting cell values.
 *
 * Kept out of the table so the interesting decisions are testable without rendering
 * a table, and so the same formatting is used by the item card, the dashboard and
 * anywhere else a value appears.
 *
 * The rules are deliberately lossy in one direction only. Durations are shortened
 * because "90m" is read faster than "1 hour 30 minutes" in a column. Dates are *not*
 * shortened to numbers: a date shown as "3" is unreadable out of context, and a list
 * is a place where context is missing.
 */

import type { FieldDefinition, FieldValue, Item } from '@/lib/types';

/** "90" becomes "1h 30m", "45" stays "45m". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) {
    return '';
  }
  if (!Number.isFinite(minutes)) {
    return '';
  }
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) {
    return `${total}m`;
  }
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A calendar day, in the viewer's own terms.
 *
 * Parsed by splitting rather than by `new Date`, because `new Date('2026-03-01')` is
 * midnight UTC and therefore the previous day for anyone west of Greenwich. A
 * deadline that displays one day early is not a formatting bug, it is a lie.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const parts = value.slice(0, 10).split('-');
  if (parts.length !== 3) {
    return value;
  }
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return value;
  }
  return `${day} ${MONTHS[month - 1] ?? ''}`.trim();
}

/** A date and time, in the viewer's own timezone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const day = formatDate(date.toISOString());
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day} ${time}`;
}

/** Whole days from today to a calendar day. Negative means past. */
export function daysUntil(value: string | null | undefined, today: string): number | null {
  if (!value) {
    return null;
  }
  const target = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(now)) {
    return null;
  }
  return Math.round((target - now) / 86_400_000);
}

/**
 * Whether a deadline deserves to be called out.
 *
 * Overdue is styled differently from today, and today differently from the next
 * week. A column where everything is equally red is a column nobody reads, and the
 * one item that is actually overdue is the reason the column exists.
 */
export function deadlineUrgency(
  value: string | null | undefined,
  today: string,
): 'overdue' | 'today' | 'soon' | 'later' | 'none' {
  const days = daysUntil(value, today);
  if (days === null) {
    return 'none';
  }
  if (days < 0) {
    return 'overdue';
  }
  if (days === 0) {
    return 'today';
  }
  if (days <= 7) {
    return 'soon';
  }
  return 'later';
}

/** The value for one column of one item, normalised to something renderable. */
export function cellValue(item: Item, key: string): FieldValue | undefined {
  if (key === 'title') {
    return item.title;
  }
  if (key === 'deadlineOn') {
    return item.deadlineOn;
  }
  if (key === 'whenAt') {
    return item.whenAt;
  }
  if (key === 'estimateMinutes') {
    return item.estimateMinutes;
  }
  if (key === 'projectId') {
    return item.projectId;
  }
  if (key === 'waitingOnPersonId') {
    return item.waitingOnPersonId;
  }
  if (key === 'followUpAt') {
    return item.followUpAt;
  }
  if (key === 'categoryId') {
    return item.categoryId;
  }
  if (key === 'createdAt') {
    return item.createdAt;
  }
  if (key === 'completedAt') {
    return item.completedAt;
  }
  if (key === 'contexts') {
    return item.contextIds;
  }
  return item.values?.[key];
}

/**
 * Renders a raw value as text, given the field's type.
 *
 * Reference fields hold ids, and an id in a list is useless to a person. Labels are
 * resolved by the caller passing them in, and an id with no matching label is shown as
 * the id rather than hidden: a silent blank means "no project" and a wrong value.
 */
export function formatCellValue(
  value: FieldValue | undefined,
  definition: FieldDefinition | undefined,
  labels: {
    projects?: Record<string, string>;
    people?: Record<string, string>;
    contexts?: Record<string, string>;
  } = {},
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (Array.isArray(value)) {
    // A checklist value is a list of done/not-done objects; only the text matters in
    // a list column, and the progress belongs in the editor.
    if (value.length === 0) {
      return '';
    }
    if (typeof value[0] === 'object') {
      return `${value.filter((entry) => (entry as { done: boolean }).done).length}/${value.length}`;
    }
    const names = value.map((entry) => {
      const id = String(entry);
      return labels.contexts?.[id] ?? labels.people?.[id] ?? id;
    });
    return names.join(', ');
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    if (definition?.type === 'duration') {
      return formatDuration(value);
    }
    return String(value);
  }

  const text = String(value);

  if (definition?.type === 'date') {
    return formatDate(text);
  }
  if (definition?.type === 'datetime') {
    return formatDateTime(text);
  }
  if (definition?.type === 'priority' || definition?.type === 'select') {
    // The stored value is a slug; the label is what a person chose.
    const choice =
      definition.options?.kind === 'choices'
        ? definition.options.choices.find((entry) => entry.value === text)
        : undefined;
    return choice?.label ?? text;
  }
  // A custom field named after a project or a person still holds an id, and an id in
  // a list is not information. Resolved by key as well as by type, because someone
  // adding a project field will call it something like "project" or "project_name".
  if (definition?.type === 'person' || definition?.type === 'people') {
    return labels.people?.[text] ?? text;
  }
  if (looksLikeProjectReference(definition)) {
    return labels.projects?.[text] ?? text;
  }

  return text;
}

function looksLikeProjectReference(definition: FieldDefinition | undefined): boolean {
  return definition?.key.includes('project') ?? false;
}
