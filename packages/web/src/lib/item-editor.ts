/**
 * The rules for editing a custom field's value.
 *
 * Fourteen field types, and the interesting work is not the widgets — it is deciding
 * what each type considers *empty*, and what a value means when it is not empty. Get
 * that wrong in one direction and required fields can never be satisfied; get it
 * wrong in the other and "required" silently stops meaning anything.
 *
 * The emptiness rule is per type rather than a shared "is it falsy" test, because the
 * types do not agree. A priority of `0` is a real value. A duration of `0` is a real
 * value too, and "no estimate" is null. A boolean of `false` is a real answer, and it
 * is the answer to a question — treating it as empty means a required yes/no field
 * can never be filled in, which is the worst possible bug in a form.
 */

import type { FieldDefinition, FieldValue } from './types';

/** Whether a field type can hold more than one value. */
export function isMultiValued(type: string): boolean {
  return type === 'multiselect' || type === 'people' || type === 'checklist' || type === 'contexts';
}

/**
 * Whether a value counts as not filled in.
 *
 * The four cases that make a shared test impossible, each commented where it appears
 * below: `0`, `false`, `[]` for a single-valued field, and a whitespace-only string.
 */
export function isEmptyValue(type: string, value: FieldValue | undefined): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'boolean') {
    // `false` is an answer, not an absence. A required yes/no field would otherwise
    // be impossible to satisfy.
    return false;
  }

  if (typeof value === 'number') {
    // Zero minutes is a real estimate — "this takes no time" — and zero is also a
    // legitimate value for most numeric fields.
    return false;
  }

  if (typeof value === 'string') {
    return value.trim() === '';
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

/** The value to store when a field is cleared. Typed, because `''` is wrong for most types. */
export function emptyValueFor(type: string): FieldValue {
  if (isMultiValued(type)) {
    return [];
  }
  if (type === 'boolean') {
    return null;
  }
  if (type === 'number' || type === 'duration') {
    return null;
  }
  return '';
}

export interface ValidationProblem {
  field: string;
  message: string;
}

/**
 * Checks a draft item against its field definitions.
 *
 * Returns problems rather than throwing, so the editor can mark each field and keep
 * everything the person typed. Two kinds of problem, both worth catching here rather
 * than at the server:
 *
 * - A required field with no value. Caught client-side so the form can point at the
 *   field instead of showing "validation failed" at the top of a form.
 * - A value that does not fit its type, such as text in a duration field. Sent as-is
 *   the server rejects the whole item, so nothing is saved and the work is lost.
 */
export function validateItem(
  definitions: FieldDefinition[],
  values: Record<string, FieldValue>,
  core: {
    title: string;
    whenAt?: string | null;
    waitingOnPersonId?: string | null;
    followUpAt?: string | null;
    projectId?: string | null;
  },
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  if (core.title.trim() === '') {
    problems.push({ field: 'title', message: 'An item needs a title.' });
  }

  /*
   * A calendar item without a hard date is not a calendar item, and a waiting item
   * without a follow-up date is a thing nobody will ever chase. Both are invariants
   * the server enforces too; catching them here means the error lands on the field.
   *
   * `undefined` means the caller does not apply the rule at all — the key is omitted
   * rather than present-and-empty, so an ordinary next action is not asked for a hard
   * date it has no reason to have.
   */
  if (core.whenAt !== undefined && String(core.whenAt).trim() === '') {
    problems.push({ field: 'whenAt', message: 'A calendar item needs a hard date and time.' });
  }
  if (
    core.waitingOnPersonId !== undefined &&
    core.followUpAt !== undefined &&
    String(core.followUpAt).trim() === ''
  ) {
    problems.push({ field: 'followUpAt', message: 'A waiting item needs a date to follow up.' });
  }

  for (const definition of definitions) {
    const value = values[definition.key];

    if (definition.required && isEmptyValue(definition.type, value)) {
      problems.push({ field: definition.key, message: `${definition.label} is required.` });
      continue;
    }

    if (isEmptyValue(definition.type, value)) {
      continue;
    }

    if (definition.type === 'duration' && typeof value === 'number' && value < 0) {
      // Negative time is a typo, not a plan. Caught here because the server rejects
      // the whole item, which loses everything else that was typed.
      problems.push({ field: definition.key, message: 'An estimate cannot be negative.' });
    }

    if (definition.type === 'number' && typeof value === 'number' && !Number.isFinite(value)) {
      problems.push({ field: definition.key, message: `${definition.label} must be a number.` });
    }

    if (
      (definition.type === 'select' || definition.type === 'priority') &&
      typeof value === 'string' &&
      definition.options.kind === 'choices' &&
      !definition.options.choices.some((choice: { value: string }) => choice.value === value)
    ) {
      /*
       * A value the field's own options do not contain. Reached when a choice is
       * renamed or removed while items still carry the old value. Sending it produces
       * a server rejection, so it is surfaced as a problem the person can see and fix
       * rather than as a failed save.
       */
      problems.push({
        field: definition.key,
        message: `"${value}" is not one of the current options for ${definition.label}.`,
      });
    }
  }

  return problems;
}

/**
 * Splits definitions into editor groups.
 *
 * `groupLabel` exists so related fields sit together — scheduling fields, or
 * something domain-specific someone added — and ungrouped fields come first under an
 * empty label rather than being pushed to the bottom. Order within a group is the
 * definition's own `sortOrder`, so the order chosen when the field was created is
 * the order it appears in.
 */
export interface FieldGroup {
  label: string | null;
  fields: FieldDefinition[];
}

export function groupDefinitions(definitions: FieldDefinition[]): FieldGroup[] {
  const groups = new Map<string, FieldDefinition[]>();

  for (const definition of [...definitions].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = definition.groupLabel ?? '';
    const existing = groups.get(key) ?? [];
    existing.push(definition);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([label, fields]) => ({
    label: label === '' ? null : label,
    fields,
  }));
}

/** The choice list of a field, in the order the person arranged it. */
export function choicesOf(
  definition: FieldDefinition,
): Array<{ value: string; label: string; color: string | null }> {
  if (definition.options.kind !== 'choices') {
    return [];
  }
  return [...definition.options.choices].sort((a, b) => a.order - b.order);
}

/** The editor input a field type needs. Rendering picks a widget from this. */
export type FieldWidget =
  | 'text'
  | 'longtext'
  | 'number'
  | 'duration'
  | 'choice'
  | 'multi-choice'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'people'
  | 'checklist'
  | 'url';

export function widgetFor(type: string): FieldWidget {
  switch (type) {
    case 'longtext':
      return 'longtext';
    case 'number':
      return 'number';
    case 'duration':
      return 'duration';
    case 'select':
    case 'priority':
      return 'choice';
    case 'multiselect':
      return 'multi-choice';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'person':
    case 'people':
      return 'people';
    case 'checklist':
      return 'checklist';
    case 'url':
      return 'url';
    default:
      return 'text';
  }
}

/**
 * Coerces a DOM string into the value for a field type.
 *
 * Done here rather than in each widget so every path — typing, pasting, restoring a
 * draft — produces the same stored value. `"30"` and `30` must not both end up in
 * `data_json`, because then the same item looks different depending on how it was
 * entered, and sorting by it stops working.
 */
export function coerceValue(type: string, raw: string): FieldValue {
  switch (type) {
    case 'number':
    case 'duration': {
      const trimmed = raw.trim();
      if (trimmed === '') {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'boolean':
      return raw === 'true';
    default:
      return raw;
  }
}

/** How an empty duration is offered, in minutes. */
export const DURATION_PRESETS = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240];
