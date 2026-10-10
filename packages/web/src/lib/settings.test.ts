import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  buildFieldBody,
  describeField,
  needsChoices,
  parseChoices,
  slug,
  validateField,
} from './settings';

/**
 * Settings helpers.
 *
 * A field created here shapes every item editor, list column and filter for as long as
 * the database exists, which makes this the least forgiving place in the application to
 * get something subtly wrong.
 */

describe('field types', () => {
  it('offers all fourteen', () => {
    expect(FIELD_TYPES).toHaveLength(14);
  });

  it('marks the choice-based types', () => {
    expect(needsChoices('priority')).toBe(true);
    expect(needsChoices('select')).toBe(true);
    expect(needsChoices('multiselect')).toBe(true);
  });

  it('does not mark the others', () => {
    expect(needsChoices('text')).toBe(false);
    expect(needsChoices('duration')).toBe(false);
    expect(needsChoices('checklist')).toBe(false);
  });
});

describe('choices', () => {
  it('keeps the order given', () => {
    // Not alphabetical. For a priority field the first entry is the highest, so
    // sorting them silently inverts a scale somebody cared about — and the symptom
    // appears much later as "the priority sorting seems wrong".
    expect(parseChoices('high, medium, low').map((choice) => choice.value)).toEqual([
      'high',
      'medium',
      'low',
    ]);
  });

  it('slugifies the value and keeps the label as written', () => {
    expect(parseChoices('High Priority')[0]).toEqual({
      value: 'high_priority',
      label: 'High Priority',
      color: null,
      order: 0,
    });
  });

  it('ignores blank entries', () => {
    expect(parseChoices('high,  , low')).toHaveLength(2);
  });

  it('numbers them in order', () => {
    expect(parseChoices('a, b, c').map((choice) => choice.order)).toEqual([0, 1, 2]);
  });

  it('slugs consistently', () => {
    expect(slug('Do it now!')).toBe('do_it_now');
  });
});

describe('validating a field', () => {
  const base = { label: 'Priority', type: 'priority', choices: 'high, low', categoryId: 'c1' };

  it('accepts a good one', () => {
    expect(validateField(base)).toBeNull();
  });

  it('requires a label', () => {
    expect(validateField({ ...base, label: '  ' })).toContain('label');
  });

  it('requires a category', () => {
    expect(validateField({ ...base, categoryId: '' })).toContain('category');
  });

  /*
   * The gap the previous version had: a priority field could be created with no way to
   * set its options, so the server filled in "Option 1" and "Option 2" and the field
   * was useless in a way nothing on the screen explained.
   */
  it('requires options for a choice field', () => {
    expect(validateField({ ...base, choices: '' })).toContain('at least two');
    expect(validateField({ ...base, choices: 'only one' })).toContain('at least two');
  });

  it('does not require options for a text field', () => {
    expect(validateField({ ...base, type: 'text', choices: '' })).toBeNull();
  });

  /*
   * Two options that slugify the same make the first unreachable: filtering by that
   * value returns both, and the higher-priority one silently loses to the lower.
   */
  it('rejects two options with the same value', () => {
    expect(validateField({ ...base, choices: 'High Priority, high priority' })).toContain(
      'same value',
    );
  });

  it('allows a global field when the caller permits it', () => {
    expect(validateField({ ...base, categoryId: '', allowGlobal: true })).toBeNull();
  });
});

describe('the request body', () => {
  it('sends choices for a choice field', () => {
    const body = buildFieldBody({
      label: 'Priority',
      type: 'priority',
      choices: 'high, low',
      categoryId: 'c1',
      showInTable: true,
      filterable: true,
    });

    expect(body.options).toEqual({
      kind: 'choices',
      choices: [
        { value: 'high', label: 'high', color: null, order: 0 },
        { value: 'low', label: 'low', color: null, order: 1 },
      ],
    });
  });

  it('sends no options for a field that has none', () => {
    const body = buildFieldBody({
      label: 'Notes',
      type: 'text',
      choices: '',
      categoryId: 'c1',
      showInTable: false,
      filterable: false,
    });

    expect(body).not.toHaveProperty('options');
  });

  it('leaves sorting off by default', () => {
    // Sorting a custom field needs an index the server maintains. Opting in rather
    // than inheriting it means nobody pays for an index they did not ask for.
    const body = buildFieldBody({
      label: 'Priority',
      type: 'priority',
      choices: 'high, low',
      categoryId: 'c1',
      showInTable: true,
      filterable: true,
    });

    expect(body.sortable).toBe(false);
  });

  it('trims the label', () => {
    const body = buildFieldBody({
      label: '  Priority  ',
      type: 'text',
      choices: '',
      categoryId: 'c1',
      showInTable: false,
      filterable: false,
    });

    expect(body.label).toBe('Priority');
  });
});

describe('describing a field', () => {
  it('names the type', () => {
    expect(describeField({ label: 'Priority', type: 'priority' })).toBe('Priority');
  });

  it('mentions that it is required', () => {
    expect(describeField({ label: 'Ref', type: 'text', required: true })).toContain('required');
  });

  it('falls back to the raw type for one it does not know', () => {
    // A field from a newer build still has to be listed and deletable.
    expect(describeField({ label: 'Odd', type: 'hologram' })).toBe('hologram');
  });
});
