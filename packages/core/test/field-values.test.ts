import { describe, expect, it } from 'vitest';
import {
  applyFieldDefaults,
  createFieldDefinition,
  validateFieldValue,
  validateFieldValues,
  type FieldDefinition,
  type FieldType,
  type FieldValue,
} from '../src/fields/index.js';

/** Builds a valid definition of the given type with test-friendly options. */
function def(type: FieldType, options?: FieldDefinition['options']): FieldDefinition {
  // `exactOptionalPropertyTypes` forbids passing an explicit `undefined`, so the
  // key is only present when options were actually supplied.
  return createFieldDefinition({
    label: `Test ${type}`,
    type,
    existingKeys: [],
    ...(options ? { options } : {}),
  });
}

const CHOICES = {
  kind: 'choices' as const,
  choices: [
    { value: 'low', label: 'Low', color: null, order: 0 },
    { value: 'high', label: 'High', color: null, order: 1 },
  ],
};

describe('text', () => {
  const definition = def('text');

  it('trims surrounding whitespace', () => {
    expect(validateFieldValue(definition, '  hello  ').value).toBe('hello');
  });

  it('rejects a non-string', () => {
    expect(validateFieldValue(definition, 42).ok).toBe(false);
  });

  it('rejects an over-long single-line value', () => {
    expect(validateFieldValue(definition, 'x'.repeat(501)).ok).toBe(false);
  });

  it('allows a long notes value', () => {
    const long = def('longtext');
    expect(validateFieldValue(long, 'x'.repeat(5_000)).ok).toBe(true);
  });
});

describe('url', () => {
  const definition = def('url');

  it('accepts an https URL', () => {
    const result = validateFieldValue(definition, 'https://example.com/a');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('https://example.com/a');
  });

  it('rejects a non-http scheme', () => {
    expect(validateFieldValue(definition, 'javascript:alert(1)').ok).toBe(false);
    expect(validateFieldValue(definition, 'file:///etc/passwd').ok).toBe(false);
  });

  it('rejects a bare word', () => {
    expect(validateFieldValue(definition, 'example').ok).toBe(false);
  });
});

describe('duration', () => {
  const definition = def('duration');

  it.each([
    [90, 90],
    ['90', 90],
    ['1h 30m', 90],
    ['1:30', 90],
    ['2h', 120],
    ['45m', 45],
    ['45', 45],
  ])('normalises %s to %s minutes', (input, expected) => {
    const result = validateFieldValue(definition, input);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(expected);
  });

  it('rejects a negative duration', () => {
    expect(validateFieldValue(definition, -5).ok).toBe(false);
  });

  it('rejects a fractional duration rather than rounding it', () => {
    const result = validateFieldValue(definition, 10.5);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('whole number of minutes');
  });

  it('accepts zero', () => {
    expect(validateFieldValue(definition, 0).value).toBe(0);
  });
});

describe('number', () => {
  const definition = def('number', {
    kind: 'number',
    min: 1,
    max: 10,
    step: 1,
    prefix: null,
    suffix: null,
  });

  it('parses a numeric string', () => {
    expect(validateFieldValue(definition, '4').value).toBe(4);
  });

  it('rejects a value below the minimum', () => {
    expect(validateFieldValue(definition, 0).ok).toBe(false);
  });

  it('rejects a value above the maximum', () => {
    expect(validateFieldValue(definition, 11).ok).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    expect(validateFieldValue(definition, 'many').ok).toBe(false);
  });
});

describe('select and priority', () => {
  const definition = def('select', CHOICES);

  it('accepts a configured choice', () => {
    expect(validateFieldValue(definition, 'high').value).toBe('high');
  });

  it('rejects an unconfigured choice', () => {
    const result = validateFieldValue(definition, 'urgent');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('not an option');
  });

  it('resolves a blank to the empty value', () => {
    expect(validateFieldValue(definition, '').value).toBe('');
  });
});

describe('multiselect', () => {
  const definition = def('multiselect', CHOICES);

  it('accepts several choices', () => {
    expect(validateFieldValue(definition, ['low', 'high']).value).toEqual(['low', 'high']);
  });

  it('deduplicates', () => {
    expect(validateFieldValue(definition, ['low', 'low']).value).toEqual(['low']);
  });

  it('rejects the whole set when any entry is invalid', () => {
    const result = validateFieldValue(definition, ['low', 'nope']);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('"nope"');
  });

  it('rejects a non-array', () => {
    expect(validateFieldValue(definition, 'low').ok).toBe(false);
  });
});

describe('boolean', () => {
  const definition = def('boolean');

  it.each([
    [true, true],
    ['true', true],
    ['yes', true],
    ['1', true],
    [false, false],
    ['no', false],
    ['0', false],
    ['', false],
  ])('normalises %s to %s', (input, expected) => {
    const result = validateFieldValue(definition, input);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(expected);
  });

  it('rejects an unrecognised string', () => {
    expect(validateFieldValue(definition, 'maybe').ok).toBe(false);
  });
});

describe('date', () => {
  const definition = def('date');

  it('accepts a real calendar day', () => {
    expect(validateFieldValue(definition, '2026-10-08').value).toBe('2026-10-08');
  });

  it('rejects a non-existent day', () => {
    expect(validateFieldValue(definition, '2026-02-30').ok).toBe(false);
  });

  it('rejects a datetime', () => {
    expect(validateFieldValue(definition, '2026-10-08T00:00:00Z').ok).toBe(false);
  });

  it('rejects an ambiguous format', () => {
    expect(validateFieldValue(definition, '10/08/2026').ok).toBe(false);
  });
});

describe('datetime', () => {
  const definition = def('datetime');

  it('accepts an instant with an offset and normalises to UTC', () => {
    expect(validateFieldValue(definition, '2026-10-08T10:00:00+05:30').value).toBe(
      '2026-10-08T04:30:00.000Z',
    );
  });

  it('accepts a bare day and promotes it to midnight UTC', () => {
    expect(validateFieldValue(definition, '2026-10-08').value).toBe('2026-10-08T00:00:00.000Z');
  });

  it('accepts a Date instance', () => {
    expect(validateFieldValue(definition, new Date('2026-10-08T10:00:00.000Z')).value).toBe(
      '2026-10-08T10:00:00.000Z',
    );
  });

  it('rejects a local datetime with no offset', () => {
    const result = validateFieldValue(definition, '2026-10-08T10:00:00');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('timezone offset');
  });

  it('rejects an invalid Date instance', () => {
    expect(validateFieldValue(definition, new Date('nope')).ok).toBe(false);
  });
});

describe('person and people', () => {
  it('trims a single person reference', () => {
    expect(validateFieldValue(def('person'), '  abc  ').value).toBe('abc');
  });

  it('deduplicates and trims a people list', () => {
    expect(validateFieldValue(def('people'), ['a', ' a ', 'b']).value).toEqual(['a', 'b']);
  });

  it('drops non-string entries from a people list', () => {
    expect(validateFieldValue(def('people'), ['a', 5, null]).value).toEqual(['a']);
  });
});

describe('checklist', () => {
  const definition = def('checklist');

  it('accepts rows and defaults done to false', () => {
    expect(validateFieldValue(definition, [{ label: 'wallet' }]).value).toEqual([
      { id: 'wallet', label: 'wallet', done: false },
    ]);
  });

  it('drops rows with a blank label', () => {
    expect(validateFieldValue(definition, [{ label: '  ' }, { label: 'keys' }]).value).toEqual([
      { id: 'keys', label: 'keys', done: false },
    ]);
  });

  it('disambiguates duplicate row ids', () => {
    const result = validateFieldValue(definition, [
      { id: 'a', label: 'x' },
      { id: 'a', label: 'y' },
    ]);
    const rows = result.value as Array<{ id: string }>;
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('enforces a maxItems limit', () => {
    const limited = def('checklist', { kind: 'checklist', maxItems: 2 });
    expect(validateFieldValue(limited, [{ label: 'a' }, { label: 'b' }, { label: 'c' }]).ok).toBe(
      false,
    );
  });
});

describe('required fields', () => {
  it('rejects a blank value', () => {
    const definition = createFieldDefinition({ label: 'Assigner', type: 'text', required: true });
    const result = validateFieldValue(definition, '   ');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('is required');
  });

  it('accepts a supplied value', () => {
    const definition = createFieldDefinition({ label: 'Assigner', type: 'text', required: true });
    expect(validateFieldValue(definition, 'Dana').ok).toBe(true);
  });

  it('rejects a blank that is only whitespace', () => {
    const definition = createFieldDefinition({
      label: 'Remarks',
      type: 'longtext',
      required: true,
    });
    expect(validateFieldValue(definition, '  ').ok).toBe(false);
  });
});

describe('validateFieldValues', () => {
  const definitions = [def('text'), def('duration'), def('select', CHOICES)];

  it('normalises a whole map', () => {
    const result = validateFieldValues(definitions, {
      test_text: '  a  ',
      test_duration: '30',
      test_select: 'low',
    });
    expect(result.ok).toBe(true);
    expect(result.values['test_duration']).toBe(30);
  });

  it('rejects an unknown field instead of silently dropping it', () => {
    const result = validateFieldValues(definitions, { nope: 'x' });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('Unknown field');
  });

  it('collects every issue rather than stopping at the first', () => {
    const result = validateFieldValues(definitions, {
      test_duration: -1,
      test_select: 'nope',
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
  });

  it('omits rejected keys from the values it does return', () => {
    const result = validateFieldValues(definitions, {
      test_text: 'ok',
      test_duration: -1,
    });
    expect(result.values['test_text']).toBe('ok');
    expect(result.values['test_duration']).toBeUndefined();
  });
});

describe('applyFieldDefaults', () => {
  it('fills a missing key from the definition default', () => {
    const definitions = [
      createFieldDefinition({
        label: 'Type',
        type: 'select',
        options: CHOICES,
        defaultValue: 'low',
      }),
      def('text'),
    ];
    const values = applyFieldDefaults(definitions, {});
    expect(values.type).toBe('low');
  });

  it('lets an explicit value win over the default', () => {
    const definitions = [
      createFieldDefinition({
        label: 'Type',
        type: 'select',
        options: CHOICES,
        defaultValue: 'low',
      }),
    ];
    expect(applyFieldDefaults(definitions, { type: 'high' }).type).toBe('high');
  });

  it('does not invent values for fields with no default', () => {
    expect(applyFieldDefaults([def('text')], {})).toEqual({});
  });
});

describe('field type formatting', () => {
  it('renders a duration in human units', async () => {
    const { getFieldTypeSpec } = await import('../src/fields/index.js');
    const spec = getFieldTypeSpec('duration');
    const options = { kind: 'duration' as const, presetsMinutes: [] };
    expect(spec.format(45, options)).toBe('45m');
    expect(spec.format(60, options)).toBe('1h');
    expect(spec.format(90, options)).toBe('1h 30m');
    expect(spec.format(0, options)).toBe('0m');
  });

  it('renders a choice as its label', async () => {
    const { getFieldTypeSpec } = await import('../src/fields/index.js');
    expect(getFieldTypeSpec('select').format('high', CHOICES)).toBe('High');
  });

  it('renders a checklist as a done fraction', async () => {
    const { getFieldTypeSpec } = await import('../src/fields/index.js');
    const rows: FieldValue = [
      { id: 'a', label: 'a', done: true },
      { id: 'b', label: 'b', done: false },
    ];
    expect(getFieldTypeSpec('checklist').format(rows, { kind: 'checklist', maxItems: null })).toBe(
      '1/2',
    );
  });

  it('orders select values by configured choice order', async () => {
    const { getFieldTypeSpec } = await import('../src/fields/index.js');
    expect(getFieldTypeSpec('priority').sortKey('high', CHOICES)).toBe(1);
    expect(getFieldTypeSpec('priority').sortKey('low', CHOICES)).toBe(0);
  });
});
