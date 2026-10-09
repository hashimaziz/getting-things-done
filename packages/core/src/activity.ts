/**
 * The activity log's vocabulary.
 *
 * Every write to an item is recorded, because the completed archive, the undo
 * affordance and the dashboard's throughput charts all read from this rather than
 * from the item rows themselves. An item row only knows its current state; it
 * cannot say what it was last week.
 *
 * Diffing lives here, as a pure function, because "what changed" is domain logic
 * and not something a repository should be inventing while it writes.
 */

import type { ActivityVerb, Item } from './entities.js';

export interface FieldChange {
  /** Core field name, or a user-defined field key. */
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Core fields compared for changes.
 *
 * `id` is excluded because it cannot change, and `sortOrder` is included because
 * a deliberate reorder is a real change worth seeing in a history view.
 */
const COMPARED_FIELDS = [
  'title',
  'container',
  'notes',
  'whenAt',
  'deadlineOn',
  'estimateMinutes',
  'projectId',
  'waitingOnPersonId',
  'followUpAt',
  'contextIds',
  'recurrenceId',
  'sortOrder',
  'isTemplate',
] as const satisfies ReadonlyArray<keyof Item>;

/** True for a list of plain strings, which is how context ids are stored. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  // Reordering a list of ids is not a change worth recording: contexts are a set
  // from a user's point of view. This deliberately does *not* apply to arrays of
  // objects, because stringifying those yields "[object Object]" for every entry,
  // which would make any two checklist rows compare equal and silently hide a real
  // change.
  if (isStringList(a) && isStringList(b)) {
    if (a.length !== b.length) {
      return false;
    }
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((value, index) => value === right[index]);
  }

  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}

/**
 * The field-level changes between two versions of an item.
 *
 * Empty arrays are treated as equal to each other and to a missing value, so
 * clearing an already-empty list is not recorded as a change.
 */
export function diffItems(before: Item, after: Item): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const field of COMPARED_FIELDS) {
    const from = before[field];
    const to = after[field];
    if (!sameValue(from, to)) {
      changes.push({ field, from, to });
    }
  }

  // User-defined values are diffed per key, so a change to one field does not
  // report the whole map as replaced.
  const keys = new Set([...Object.keys(before.data), ...Object.keys(after.data)]);
  for (const key of keys) {
    const from = before.data[key];
    const to = after.data[key];
    if (!sameValue(from, to)) {
      changes.push({ field: key, from: from ?? null, to: to ?? null });
    }
  }

  return changes;
}

/**
 * A one-line summary of a set of changes, for a history row.
 *
 * `data.title` renders as "title"; a user-defined key renders as its key, since
 * the client knows how to label it and the server cannot be sure.
 */
export function summariseChanges(changes: readonly FieldChange[]): string {
  if (changes.length === 0) {
    return 'no changes';
  }
  const fields = changes.map((change) => change.field);
  if (fields.length === 1) {
    return fields[0] as string;
  }
  return `${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1] as string}`;
}

/** The verb to record for a transition between two containers. */
export function verbForTransition(from: Item['container'], to: Item['container']): ActivityVerb {
  if (to === 'done') {
    return 'completed';
  }
  if (from === 'done') {
    return 'reopened';
  }
  if (to === 'trash') {
    return 'trashed';
  }
  if (from === 'trash') {
    return 'restored';
  }
  if (from !== to) {
    return 'moved';
  }
  return 'updated';
}

/**
 * The activity entries implied by moving an item between containers.
 *
 * Kept separate from {@link verbForTransition} because a move is always recorded
 * even when nothing else changed, whereas an edit with no actual change is not
 * worth a row at all.
 */
export function transitionEntry(
  item: Item,
  to: Item['container'],
): {
  verb: ActivityVerb;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
} {
  return {
    verb: verbForTransition(item.container, to),
    from: { container: item.container },
    to: { container: to },
  };
}
