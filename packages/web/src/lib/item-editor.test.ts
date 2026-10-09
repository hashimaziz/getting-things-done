import { describe, expect, it } from 'vitest';
import {
  choicesOf,
  coerceValue,
  emptyValueFor,
  groupDefinitions,
  isEmptyValue,
  isMultiValued,
  validateItem,
  widgetFor,
} from './item-editor';
import type { FieldDefinition, FieldValue } from './types';

/**
 * Field editing rules.
 *
 * The tests concentrate on emptiness, because that is where the interesting failures
 * are. A required field that can never be satisfied is the worst bug a form can have:
 * it looks like the app is broken rather than like the field is unset.
 */

function definition(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: 'f1',
    categoryId: null,
    key: 'my_field',
    label: 'My field',
    description: null,
    type: 'text',
    options: { kind: 'none' },
    required: false,
    defaultValue: null,
    groupLabel: null,
    showInTable: false,
    showInCard: false,
    filterable: false,
    sortable: false,
    isCore: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as FieldDefinition;
}

/** Core fields for an item in an ordinary container, where none of the extra rules apply. */
const ok = { title: 'Something' };

describe('emptiness', () => {
  it('treats null and undefined as empty', () => {
    expect(isEmptyValue('text', null)).toBe(true);
    expect(isEmptyValue('text', undefined)).toBe(true);
  });

  it('treats a whitespace-only string as empty', () => {
    expect(isEmptyValue('text', '   ')).toBe(true);
  });

  it('treats an empty string as empty', () => {
    expect(isEmptyValue('text', '')).toBe(true);
  });

  it('treats an empty list as empty', () => {
    expect(isEmptyValue('multiselect', [])).toBe(true);
  });

  /*
   * The three cases where a shared "is it falsy" test is wrong. Each of these is a
   * real answer, and treating any of them as absent breaks something visible.
   */
  it('does not treat false as empty', () => {
    // A required yes/no field would be impossible to satisfy.
    expect(isEmptyValue('boolean', false)).toBe(false);
  });

  it('does not treat zero as empty', () => {
    // Zero minutes is a real estimate: "this takes no time".
    expect(isEmptyValue('duration', 0)).toBe(false);
    expect(isEmptyValue('number', 0)).toBe(false);
  });

  it('treats true as filled in', () => {
    expect(isEmptyValue('boolean', true)).toBe(false);
  });
});

describe('empty values', () => {
  it('is an empty list for multi-valued types', () => {
    expect(emptyValueFor('multiselect')).toEqual([]);
    expect(emptyValueFor('people')).toEqual([]);
  });

  /*
   * An empty string would be the wrong stored value for these. A number field holding
   * `""` and one holding `null` are different rows, and only one of them sorts.
   */
  it('is null for numbers, durations and booleans', () => {
    expect(emptyValueFor('number')).toBeNull();
    expect(emptyValueFor('duration')).toBeNull();
    expect(emptyValueFor('boolean')).toBeNull();
  });

  it('is an empty string for text', () => {
    expect(emptyValueFor('text')).toBe('');
  });
});

describe('multi-valued types', () => {
  it('knows which types hold more than one value', () => {
    expect(isMultiValued('multiselect')).toBe(true);
    expect(isMultiValued('people')).toBe(true);
    expect(isMultiValued('checklist')).toBe(true);
    expect(isMultiValued('select')).toBe(false);
    expect(isMultiValued('text')).toBe(false);
  });
});

describe('validation', () => {
  it('accepts a valid item', () => {
    expect(validateItem([], {}, ok)).toEqual([]);
  });

  it('requires a title', () => {
    expect(validateItem([], {}, { title: '  ' })).toContainEqual({
      field: 'title',
      message: 'An item needs a title.',
    });
  });

  it('names the required field that is missing', () => {
    const problems = validateItem([definition({ required: true })], {}, ok);

    expect(problems.at(0)?.message).toBe('My field is required.');
  });

  it('accepts a required field that is filled in', () => {
    expect(validateItem([definition({ required: true })], { my_field: 'set' }, ok)).toEqual([]);
  });

  it('accepts a required boolean answered "no"', () => {
    const problems = validateItem(
      [definition({ type: 'boolean', required: true })],
      { my_field: false },
      ok,
    );

    expect(problems).toEqual([]);
  });

  it('accepts a required number that is zero', () => {
    expect(
      validateItem([definition({ type: 'number', required: true })], { my_field: 0 }, ok),
    ).toEqual([]);
  });

  /*
   * Sent as-is, the server rejects the whole item, so everything else typed is lost.
   * Catching it here means the estimate is marked and the rest of the form survives.
   */
  it('rejects a negative estimate', () => {
    const problems = validateItem([definition({ type: 'duration' })], { my_field: -5 }, ok);

    expect(problems.at(0)?.message).toBe('An estimate cannot be negative.');
  });

  it('rejects a non-finite number', () => {
    const problems = validateItem([definition({ type: 'number' })], { my_field: Number.NaN }, ok);

    expect(problems).toHaveLength(1);
  });

  it('rejects a choice the field no longer offers', () => {
    // Reached when a choice is renamed while items still carry the old value. Sending
    // it produces a server rejection, so it is surfaced instead.
    const priority = definition({
      type: 'priority',
      options: {
        kind: 'choices',
        choices: [{ value: 'urgent', label: 'Urgent', color: null, order: 0 }],
      },
    });

    const problems = validateItem([priority], { my_field: 'high' }, ok);

    expect(problems.at(0)?.message).toContain('high');
  });

  it('accepts a choice the field does offer', () => {
    const priority = definition({
      type: 'priority',
      options: {
        kind: 'choices',
        choices: [{ value: 'urgent', label: 'Urgent', color: null, order: 0 }],
      },
    });

    expect(validateItem([priority], { my_field: 'urgent' }, ok)).toEqual([]);
  });

  /*
   * A calendar item with no hard date is not a calendar item. The rule only applies
   * when the caller passes the key at all, which is how the editor says "this
   * container does not care".
   */
  it('requires a hard date for a calendar item', () => {
    const problems = validateItem([], {}, { title: 'x', whenAt: '' });

    expect(problems.at(0)?.message).toBe('A calendar item needs a hard date and time.');
  });

  it('ignores the hard date for an item in another container', () => {
    expect(validateItem([], {}, ok)).toEqual([]);
  });

  it('requires a follow-up date for a waiting item', () => {
    const problems = validateItem([], {}, { title: 'x', waitingOnPersonId: 'p1', followUpAt: '' });

    expect(problems.at(0)?.message).toBe('A waiting item needs a date to follow up.');
  });

  it('does not require a follow-up date for an item that is not waiting', () => {
    expect(validateItem([], {}, { title: 'x' })).toEqual([]);
  });

  it('reports every problem at once, rather than one per attempt', () => {
    // Fixing them one at a time, with a save in between, is how a form loses work.
    const problems = validateItem(
      [definition({ required: true }), definition({ key: 'other', type: 'duration' })],
      { other: -1 },
      { title: '' },
    );

    expect(problems).toHaveLength(3);
  });

  it('does not check a field the item does not have', () => {
    expect(validateItem([definition({ required: true })], {}, ok)).toHaveLength(1);
    expect(validateItem([definition({ required: true })], { my_field: 'set' }, ok)).toEqual([]);
  });
});

describe('grouping', () => {
  const plain = definition({ key: 'a', groupLabel: null, sortOrder: 1 });
  const alsoPlain = definition({ key: 'b', groupLabel: null, sortOrder: 0 });
  const scheduled = definition({ key: 'c', groupLabel: 'Scheduling', sortOrder: 2 });

  it('puts ungrouped fields first', () => {
    // Pushed to the bottom they would look like an afterthought.
    expect(groupDefinitions([scheduled, plain, alsoPlain]).at(0)?.label).toBeNull();
  });

  it('orders fields within a group by their sort order', () => {
    const group = groupDefinitions([plain, alsoPlain]).at(0);

    expect(group?.fields.map((field) => field.key)).toEqual(['b', 'a']);
  });

  it('orders groups by their earliest field, not by argument order', () => {
    // Definitions are sorted before grouping, so group order follows sortOrder. That is
    // the order the person arranged the fields in, which is the order they expect to
    // read them in.
    const groups = groupDefinitions([scheduled, plain]);

    expect(groups.map((group) => group.label)).toEqual([null, 'Scheduling']);
  });

  it('handles no definitions', () => {
    expect(groupDefinitions([])).toEqual([]);
  });
});

describe('choices', () => {
  it('returns them in the order the person arranged', () => {
    const field = definition({
      options: {
        kind: 'choices',
        choices: [
          { value: 'low', label: 'Low', color: null, order: 2 },
          { value: 'high', label: 'High', color: null, order: 0 },
        ],
      },
    });

    expect(choicesOf(field).map((choice) => choice.value)).toEqual(['high', 'low']);
  });

  it('is empty for a type with no choices', () => {
    expect(choicesOf(definition())).toEqual([]);
  });
});

describe('coercion', () => {
  /*
   * Done in one place so every path produces the same stored value. "30" and 30 in the
   * same column means the same item looks different depending on how it was entered,
   * and sorting by it stops working.
   */
  it('turns a numeric string into a number', () => {
    expect(coerceValue('number', '30')).toBe(30);
    expect(coerceValue('duration', '30')).toBe(30);
  });

  it('turns an empty numeric field into null, not an empty string', () => {
    expect(coerceValue('number', '')).toBeNull();
    expect(coerceValue('duration', '  ')).toBeNull();
  });

  it('turns nonsense into null rather than NaN', () => {
    // NaN stored in JSON survives a round trip as null and reappears as a type error
    // in a chart three weeks later.
    expect(coerceValue('number', 'abc')).toBeNull();
  });

  it('keeps a number as a number', () => {
    expect(coerceValue('number', '0')).toBe(0);
    expect(coerceValue('number', '-5')).toBe(-5);
  });

  it('turns a checkbox into a boolean', () => {
    expect(coerceValue('boolean', 'true')).toBe(true);
    expect(coerceValue('boolean', 'false')).toBe(false);
  });

  it('leaves text alone', () => {
    expect(coerceValue('text', '  hello  ')).toBe('  hello  ');
    expect(coerceValue('date', '2026-03-01')).toBe('2026-03-01');
  });
});

describe('widgets', () => {
  it('maps each type to an input', () => {
    expect(widgetFor('text')).toBe('text');
    expect(widgetFor('longtext')).toBe('longtext');
    expect(widgetFor('duration')).toBe('duration');
    expect(widgetFor('select')).toBe('choice');
    expect(widgetFor('priority')).toBe('choice');
    expect(widgetFor('multiselect')).toBe('multi-choice');
    expect(widgetFor('person')).toBe('people');
    expect(widgetFor('people')).toBe('people');
    expect(widgetFor('checklist')).toBe('checklist');
    expect(widgetFor('url')).toBe('url');
  });

  it('falls back to a text input for a type it does not know', () => {
    // A field saved by a newer build must still be editable rather than crashing the
    // whole editor.
    expect(widgetFor('hologram')).toBe('text');
  });
});

describe('values as stored', () => {
  it('keeps a number a number through validation', () => {
    const values: Record<string, FieldValue> = { my_field: 30 };
    expect(validateItem([definition({ type: 'duration' })], values, ok)).toEqual([]);
  });
});
