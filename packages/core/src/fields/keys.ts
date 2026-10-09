/**
 * Field keys: the stable machine names that item data is stored under.
 *
 * A key is what survives a label rename. Renaming "Complete By" to "Due Date"
 * must not orphan existing values, so labels are cosmetic and keys are not.
 */

import { type FieldDefinition } from './types.js';

/** Matches a lower snake_case identifier. Keys always start with a letter. */
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Names that a configurable field may never take.
 *
 * These either collide with first-class `items` columns or with the envelope
 * around user data. Allowing one would let a field definition silently shadow
 * real data, so they are rejected at definition time rather than at query time.
 */
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set([
  // Identity and envelope
  'id',
  'data',
  'sort_order',
  // Core item columns
  'title',
  'notes',
  'container',
  'category_id',
  'when_at',
  'deadline_at',
  'estimate_min',
  'project_id',
  'waiting_on_person_id',
  'follow_up_at',
  'contexts',
  'recurrence',
  'parent_item_id',
  'occurrence_date',
  // Timestamps
  'created_at',
  'updated_at',
  'completed_at',
  'trashed_at',
]);

/**
 * Multi-word abbreviations, applied before tokenising.
 *
 * These must be handled as phrases because each maps to a single token that no
 * amount of per-word substitution could produce. Ordering is significant: the
 * first match wins, so longer phrases come first.
 */
const PHRASE_ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpoint\s+of\s+contact\b/g, 'poc'],
  [/\bperson\s+of\s+contact\b/g, 'poc'],
  [/\btime\s+to\s+contact\b/g, 'ttc'],
  [/\bassigned\s+to\b/g, 'assignee'],
  [/\bassigned\s+by\b/g, 'assigner'],
  [/\bowned\s+by\b/g, 'owner'],
  [/\bdue\s+date\b/g, 'deadline'],
  [/\bdue\s+by\b/g, 'deadline'],
];

/** Single-word abbreviations applied per token, after phrase substitution. */
const WORD_ABBREVIATIONS: Readonly<Record<string, string>> = {
  description: 'desc',
  assigned: 'assignee',
  assignment: 'assignee',
  assign: 'assignee',
  estimated: 'estimate',
};

/**
 * Derives a stable field key from a human label.
 *
 * "Complete By" becomes `complete_by`, "POC" becomes `poc`, "Assigned By"
 * becomes `assigner`. The result is deterministic so regenerating keys from the
 * same labels produces the same keys.
 */
export function slugifyFieldKey(label: string): string {
  // camelCase is split before lowercasing, because once the capital is gone the
  // word boundary is gone too: "completeBy" would otherwise collapse to
  // "completeby".
  const spaced = label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks so "Señor" becomes "senor" rather than "senor".
    .replace(/[̀-ͯ]/g, '');

  let abbreviated = spaced;
  for (const [pattern, replacement] of PHRASE_ABBREVIATIONS) {
    abbreviated = abbreviated.replace(pattern, replacement);
  }

  const tokens = abbreviated
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => WORD_ABBREVIATIONS[token] ?? token);

  // The head noun is kept exactly as the user wrote it. No pluralisation or
  // other inflection is applied, because a key that silently becomes
  // `priorities` when the label was `Priority` is a surprise that costs more
  // than the tidiness is worth.
  const normalized = tokens;

  let key = normalized.join('_');
  if (key.length > 64) {
    key = key.slice(0, 64).replace(/_+$/, '');
  }
  if (key.length > 0 && /^[0-9]/.test(key)) {
    key = `f_${key}`;
  }
  return key;
}

export function isValidFieldKey(key: string): boolean {
  return FIELD_KEY_PATTERN.test(key) && !RESERVED_FIELD_KEYS.has(key);
}

/**
 * Produces a key that is not already in use within `existing`.
 *
 * Collisions are suffixed `2`, `3` and so on rather than a random string, so the
 * result stays readable and predictable in the field builder.
 */
export function uniqueFieldKey(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new RangeError(`Could not derive a unique key from "${base}"`);
}

/** Result of checking a proposed definition against the keys already in use. */
export interface FieldKeyCheck {
  ok: boolean;
  errors: string[];
}

/**
 * Validates the key of a definition being created or updated.
 *
 * `existingKeys` should be the keys already defined for the same scope (the same
 * category, plus global definitions). `currentKey` is excluded so that saving an
 * unchanged definition is not reported as a collision with itself.
 */
export function checkFieldKey(
  key: string,
  existingKeys: Iterable<string> = [],
  currentKey?: string,
): FieldKeyCheck {
  const errors: string[] = [];

  if (key !== key.trim()) {
    errors.push('Key must not have leading or trailing whitespace');
  }
  if (!FIELD_KEY_PATTERN.test(key)) {
    errors.push('Key must be lower snake_case, start with a letter and be at most 64 characters');
  }
  if (RESERVED_FIELD_KEYS.has(key)) {
    errors.push(`Key "${key}" is reserved because it collides with a built-in item property`);
  }
  // A field keeping its own key unchanged is never a collision with itself.
  // When `currentKey` is absent this is a create, so any existing key collides.
  if (key !== currentKey && new Set(existingKeys).has(key)) {
    errors.push(`Key "${key}" is already used by another field`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Determines whether a definition must be stored in a first-class column.
 *
 * Core fields are the ones the dashboard queries and charts on constantly, plus
 * the ones the GTD containers themselves depend on. Promoting them to real
 * indexed columns keeps those queries fast and sortable.
 */
export function resolveIsCore(
  definition: Pick<FieldDefinition, 'key' | 'type' | 'sortable' | 'filterable'>,
): boolean {
  if (definition.sortable || definition.filterable) {
    return true;
  }
  return ['duration', 'priority', 'date', 'datetime', 'person'].includes(definition.type);
}
