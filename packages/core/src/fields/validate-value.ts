/**
 * Value validation and normalisation for configurable fields.
 *
 * Two things happen here, and the distinction matters:
 *
 * - **Normalisation** turns loosely typed JSON arriving from a form, the CLI or
 *   an API client into the canonical stored shape. Trimming strings, collapsing
 *   `"yes"` to `true`, discarding duplicates. This is forgiving on purpose.
 * - **Validation** rejects values that cannot be represented. A duration of
 *   `-5`, a date of `2026-02-30`, a `select` value that is not one of the
 *   configured choices. This is strict on purpose.
 *
 * Normalising first and validating second means a caller never has to know
 * whether it was handed `"30"` or `30` for a duration.
 */

import { isIsoDate, isIsoDateTime, type IsoDate } from '../dates/index.js';
import {
  getFieldTypeSpec,
  type ChecklistEntry,
  type FieldDefinition,
  type FieldOptions,
  type FieldValue,
} from './types.js';

export interface FieldValidationIssue {
  /** The field key the issue belongs to, or `''` for definition-level issues. */
  key: string;
  message: string;
}

export interface FieldValidationResult {
  ok: boolean;
  /** Present when `ok` is true. Canonical stored value. */
  value: FieldValue;
  issues: FieldValidationIssue[];
}

function ok(value: FieldValue): FieldValidationResult {
  return { ok: true, value, issues: [] };
}

function fail(key: string, message: string): FieldValidationResult {
  return { ok: false, value: null, issues: [{ key, message }] };
}

function choiceValues(options: FieldOptions): Set<string> {
  return options.kind === 'choices'
    ? new Set(options.choices.map((choice) => choice.value))
    : new Set();
}

/**
 * Treats a whitespace-only string as absent.
 *
 * Trimming before the decision matters: a required field whose value is `"   "`
 * is empty as far as any human is concerned, and letting it through produces an
 * item that looks filled in but stores `''`.
 */
function isBlank(raw: unknown): boolean {
  if (raw === undefined || raw === null) {
    return true;
  }
  return typeof raw === 'string' && raw.trim() === '';
}

function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Parses a duration that may arrive as `"1h 30m"`, `"90"`, `90` or `"1:30"`. */
function parseDurationMinutes(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim().toLowerCase();
  if (text === '') {
    return null;
  }

  const clock = /^(\d+):([0-5]?\d)$/.exec(text);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }

  const compound = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
  if (compound && (compound[1] || compound[2])) {
    return Number(compound[1] ?? 0) * 60 + Number(compound[2] ?? 0);
  }

  const plain = Number(text);
  return Number.isFinite(plain) ? plain : null;
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'on']);
const FALSY = new Set(['false', 'no', 'n', '0', 'off', '']);

function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'number') {
    return raw !== 0 ? null : false;
  }
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (TRUTHY.has(text)) return true;
    if (FALSY.has(text)) return false;
  }
  return null;
}

/**
 * Validates and normalises a single value against its definition.
 *
 * A blank input is never an error. It resolves to the type's empty value, which
 * is what lets a form submit an untouched optional field as `""`.
 */
export function validateFieldValue(
  definition: FieldDefinition,
  raw: unknown,
): FieldValidationResult {
  const spec = getFieldTypeSpec(definition.type);
  const { key } = definition;

  if (definition.required && isBlank(raw)) {
    return fail(key, `"${definition.label}" is required`);
  }

  if (isBlank(raw)) {
    return ok(structuredClone(spec.emptyValue));
  }

  switch (definition.type) {
    case 'text':
    case 'longtext': {
      if (typeof raw !== 'string') {
        return fail(key, `"${definition.label}" must be text`);
      }
      const trimmed = raw.trim();
      if (trimmed.length > (definition.type === 'text' ? 500 : 100_000)) {
        return fail(key, `"${definition.label}" is too long`);
      }
      return ok(trimmed);
    }

    case 'url': {
      if (typeof raw !== 'string') {
        return fail(key, `"${definition.label}" must be a URL`);
      }
      let parsed: URL;
      try {
        parsed = new URL(raw.trim());
      } catch {
        return fail(key, `"${definition.label}" is not a valid URL`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail(key, `"${definition.label}" must be an http or https URL`);
      }
      return ok(parsed.toString());
    }

    case 'number': {
      const parsed = parseNumber(raw);
      if (parsed === null) {
        return fail(key, `"${definition.label}" must be a number`);
      }
      if (definition.options.kind === 'number') {
        const { min, max } = definition.options;
        if (min !== null && parsed < min) {
          return fail(key, `"${definition.label}" must be at least ${min}`);
        }
        if (max !== null && parsed > max) {
          return fail(key, `"${definition.label}" must be at most ${max}`);
        }
      }
      return ok(parsed);
    }

    case 'duration': {
      const parsed = parseDurationMinutes(raw);
      if (parsed === null) {
        return fail(key, `"${definition.label}" must be a duration in minutes`);
      }
      if (parsed < 0) {
        return fail(key, `"${definition.label}" cannot be negative`);
      }
      // Sub-minute estimates are meaningless and create rounding noise in
      // estimates totals, so they are rejected rather than silently rounded.
      if (!Number.isInteger(parsed)) {
        return fail(key, `"${definition.label}" must be a whole number of minutes`);
      }
      return ok(parsed);
    }

    case 'select':
    case 'priority': {
      if (typeof raw !== 'string') {
        return fail(key, `"${definition.label}" must be a single value`);
      }
      const allowed = choiceValues(definition.options);
      if (!allowed.has(raw)) {
        return fail(key, `"${raw}" is not an option of "${definition.label}"`);
      }
      return ok(raw);
    }

    case 'multiselect': {
      if (!Array.isArray(raw)) {
        return fail(key, `"${definition.label}" must be a list of values`);
      }
      const allowed = choiceValues(definition.options);
      const seen = new Set<string>();
      const out: string[] = [];
      const invalid: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'string') {
          invalid.push(String(entry));
          continue;
        }
        if (!allowed.has(entry)) {
          invalid.push(entry);
          continue;
        }
        if (!seen.has(entry)) {
          seen.add(entry);
          out.push(entry);
        }
      }
      if (invalid.length > 0) {
        return fail(
          key,
          `${invalid.map((v) => `"${v}"`).join(', ')} not an option of "${definition.label}"`,
        );
      }
      return ok(out);
    }

    case 'boolean': {
      const parsed = parseBoolean(raw);
      if (parsed === null) {
        return fail(key, `"${definition.label}" must be true or false`);
      }
      return ok(parsed);
    }

    case 'date': {
      if (typeof raw !== 'string') {
        return fail(key, `"${definition.label}" must be a date`);
      }
      const text = raw.trim();
      if (!isIsoDate(text)) {
        return fail(key, `"${definition.label}" must be a real calendar date in YYYY-MM-DD`);
      }
      return ok(text);
    }

    case 'datetime': {
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime())
          ? fail(key, `"${definition.label}" is not a valid date`)
          : ok(raw.toISOString());
      }
      if (typeof raw !== 'string') {
        return fail(key, `"${definition.label}" must be a date and time`);
      }
      const text = raw.trim();
      // A bare calendar day is accepted and promoted to midnight UTC, because a
      // user scheduling an all-day event should not have to invent a time.
      if (isIsoDate(text)) {
        return ok(`${text}T00:00:00.000Z`);
      }
      if (!isIsoDateTime(text)) {
        return fail(
          key,
          `"${definition.label}" must be an ISO 8601 date-time with a timezone offset`,
        );
      }
      return ok(new Date(text).toISOString());
    }

    case 'person': {
      if (typeof raw !== 'string') {
        return fail(key, `"${definition.label}" must be a person reference`);
      }
      const text = raw.trim();
      if (text === '') {
        return ok('');
      }
      return ok(text);
    }

    case 'people': {
      if (!Array.isArray(raw)) {
        return fail(key, `"${definition.label}" must be a list of person references`);
      }
      const seen = new Set<string>();
      const out: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'string') {
          continue;
        }
        const text = entry.trim();
        if (text !== '' && !seen.has(text)) {
          seen.add(text);
          out.push(text);
        }
      }
      return ok(out);
    }

    case 'checklist': {
      if (!Array.isArray(raw)) {
        return fail(key, `"${definition.label}" must be a checklist`);
      }
      const maxItems = definition.options.kind === 'checklist' ? definition.options.maxItems : null;
      if (maxItems !== null && raw.length > maxItems) {
        return fail(key, `"${definition.label}" allows at most ${maxItems} items`);
      }
      const seen = new Set<string>();
      const rows: ChecklistEntry[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) {
          continue;
        }
        const candidate = entry as Record<string, unknown>;
        const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
        if (label === '') {
          continue;
        }
        let id = typeof candidate.id === 'string' && candidate.id !== '' ? candidate.id : label;
        // Two rows sharing an id would break future "toggle one row" updates.
        while (seen.has(id)) {
          id = `${id}~`;
        }
        seen.add(id);
        rows.push({ id, label, done: candidate.done === true });
      }
      return ok(rows);
    }

    default: {
      return fail(key, `Unsupported field type: ${String(definition.type)}`);
    }
  }
}

/** Aggregate result of validating a whole set of field values. */
export interface FieldValuesResult {
  ok: boolean;
  /** Canonical values keyed by field key. Present even when invalid, minus rejected keys. */
  values: Record<string, FieldValue>;
  issues: FieldValidationIssue[];
}

export interface ValidateFieldValuesOptions {
  /**
   * Require every field marked required to be present.
   *
   * Off by default, because the same function validates partial updates where an
   * absent key means "leave this field alone" and demanding it would be wrong.
   * Turn it on when materialising a complete item, such as on create.
   */
  enforceRequired?: boolean;
}

/**
 * Validates a map of raw values against a set of definitions.
 *
 * Unknown keys are rejected rather than dropped, because silently discarding a
 * value the client believed it had saved is how data goes missing without any
 * error ever surfacing.
 */
export function validateFieldValues(
  definitions: readonly FieldDefinition[],
  raw: Record<string, unknown>,
  options: ValidateFieldValuesOptions = {},
): FieldValuesResult {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const values: Record<string, FieldValue> = {};
  const issues: FieldValidationIssue[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!byKey.has(key)) {
      issues.push({ key, message: `Unknown field "${key}" for this category` });
      continue;
    }
    const definition = byKey.get(key);
    if (!definition) {
      continue;
    }
    const result = validateFieldValue(definition, value);
    if (result.ok) {
      values[key] = result.value;
    } else {
      issues.push(...result.issues);
    }
  }

  if (options.enforceRequired === true) {
    for (const definition of definitions) {
      if (!definition.required || definition.key in raw) {
        continue;
      }
      issues.push({ key: definition.key, message: `"${definition.label}" is required` });
    }
  }

  return { ok: issues.length === 0, values, issues };
}

/**
 * Fills in defaults for fields absent from `raw`.
 *
 * Used when creating an item so that a category's defaults are always present
 * without every caller having to remember them.
 *
 * A default equal to the type's own empty value is treated as "no default
 * configured" and omitted. Definitions cannot otherwise distinguish a default
 * the user deliberately set to empty from one that was simply never supplied,
 * and materialising every such field would bloat every item's data with empty
 * strings that mean nothing.
 */
export function applyFieldDefaults(
  definitions: readonly FieldDefinition[],
  raw: Record<string, FieldValue> = {},
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const definition of definitions) {
    const defaultValue = definition.defaultValue;
    if (defaultValue === null || defaultValue === undefined) {
      continue;
    }
    const empty = getFieldTypeSpec(definition.type).emptyValue;
    if (JSON.stringify(defaultValue) === JSON.stringify(empty)) {
      continue;
    }
    const validated = validateFieldValue(definition, defaultValue);
    if (validated.ok) {
      out[definition.key] = validated.value;
    }
  }
  return { ...out, ...raw };
}

/** Extracts the subset of a value map that belongs to fields of a given type. */
export function valuesOfType(
  values: Record<string, FieldValue>,
  definitions: readonly FieldDefinition[],
  type: FieldDefinition['type'],
): Array<{ key: string; value: FieldValue }> {
  const keys = new Set(
    definitions.filter((definition) => definition.type === type).map((d) => d.key),
  );
  return Object.entries(values)
    .filter(([key]) => keys.has(key))
    .map(([key, value]) => ({ key, value }));
}

/** Convenience re-export so callers can build an empty value without the registry import. */
export function emptyValueFor(type: FieldDefinition['type']): FieldValue {
  return structuredClone(getFieldTypeSpec(type).emptyValue);
}

export type { IsoDate };
