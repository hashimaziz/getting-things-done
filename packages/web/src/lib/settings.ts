/**
 * Helpers for the settings editors.
 *
 * Pure functions, because the settings screens are where the least interesting code
 * meets the most permanent consequences: a field created here shapes every item
 * editor, every list column and every filter for as long as the database exists.
 */

/** The field types a person can choose, with the type each one needs. */
export const FIELD_TYPES: Array<{ value: string; label: string; needsChoices: boolean }> = [
  { value: 'text', label: 'Text', needsChoices: false },
  { value: 'longtext', label: 'Long text', needsChoices: false },
  { value: 'number', label: 'Number', needsChoices: false },
  { value: 'duration', label: 'Duration', needsChoices: false },
  { value: 'priority', label: 'Priority', needsChoices: true },
  { value: 'select', label: 'Choice', needsChoices: true },
  { value: 'multiselect', label: 'Multiple choice', needsChoices: true },
  { value: 'boolean', label: 'Yes or no', needsChoices: false },
  { value: 'date', label: 'Date', needsChoices: false },
  { value: 'datetime', label: 'Date and time', needsChoices: false },
  { value: 'person', label: 'Person', needsChoices: false },
  { value: 'people', label: 'People', needsChoices: false },
  { value: 'checklist', label: 'Checklist', needsChoices: false },
  { value: 'url', label: 'Link', needsChoices: false },
];

export function fieldTypeSpec(
  type: string,
): { value: string; label: string; needsChoices: boolean } | undefined {
  return FIELD_TYPES.find((entry) => entry.value === type);
}

export function needsChoices(type: string): boolean {
  return fieldTypeSpec(type)?.needsChoices ?? false;
}

/**
 * Turns a comma-separated list of labels into ordered choices.
 *
 * Order is meaningful and is not alphabetical: for a priority field the first entry is
 * the highest, so a person who writes "high, medium, low" gets exactly that ranking.
 * Sorting them would silently invert a scale somebody cared about, and the symptom
 * appears much later as "the priority sorting seems wrong".
 */
export function parseChoices(
  input: string,
): Array<{ value: string; label: string; color: null; order: number }> {
  return input
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '')
    .map((label, order) => ({ value: slug(label), label, color: null, order }));
}

/** A stable slug for a label. `High Priority` becomes `high_priority`. */
export function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Problems with a field before it is created, or null when it is fine. */
export function validateField(input: {
  label: string;
  type: string;
  choices: string;
  categoryId: string;
  /** Creating a global field needs no category, unlike a scoped one. */
  allowGlobal?: boolean;
}): string | null {
  if (input.label.trim() === '') {
    return 'A field needs a label.';
  }

  if (!input.allowGlobal === true && input.categoryId === '') {
    return 'Choose which category this field belongs to.';
  }

  if (needsChoices(input.type) && parseChoices(input.choices).length < 2) {
    // The server accepts a single choice, and then every value is either that value or
    // empty. Two is the point at which the field can distinguish anything.
    return 'A choice or priority field needs at least two options.';
  }

  const values = parseChoices(input.choices).map((choice) => choice.value);
  if (new Set(values).size !== values.length) {
    // Two choices with the same slug would make the first unreachable: filtering by it
    // would return both.
    return 'Two options end up with the same value. Make them more distinct.';
  }

  return null;
}

/** The request body for creating a field. */
export function buildFieldBody(input: {
  label: string;
  type: string;
  choices: string;
  categoryId: string;
  showInTable: boolean;
  filterable: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    label: input.label.trim(),
    type: input.type,
    showInTable: input.showInTable,
    filterable: input.filterable,
    // Sorting a custom field needs an index the server maintains, so it is opt-in
    // rather than a default somebody inherits without knowing what it costs.
    sortable: false,
  };

  if (needsChoices(input.type)) {
    body.options = { kind: 'choices', choices: parseChoices(input.choices) };
  }

  return body;
}

/** A one-line summary of a field, for the list. */
export function describeField(field: {
  label: string;
  type: string;
  required?: boolean;
  filterable?: boolean;
}): string {
  const parts = [fieldTypeSpec(field.type)?.label ?? field.type];
  if (field.required === true) {
    parts.push('required');
  }
  if (field.filterable === true) {
    parts.push('filterable');
  }
  return parts.join(' · ');
}
