import { describe, expect, it } from 'vitest';
import {
  RESERVED_FIELD_KEYS,
  checkFieldKey,
  isValidFieldKey,
  resolveIsCore,
  slugifyFieldKey,
  uniqueFieldKey,
} from '../src/fields/keys.js';

describe('slugifyFieldKey', () => {
  it.each([
    ['Complete By', 'complete_by'],
    ['time estimate', 'time_estimate'],
    ['  Notes  ', 'notes'],
    ['Priority', 'priority'],
    ['Person', 'person'],
    ['People', 'people'],
    ['Assigned To', 'assignee'],
    ['Assigned By', 'assigner'],
    ['Point Of Contact', 'poc'],
    ['POC', 'poc'],
    ['For Who', 'for_who'],
    ['Due Date', 'deadline'],
  ])('derives %s as %s', (label, expected) => {
    expect(slugifyFieldKey(label)).toBe(expected);
  });

  it('splits camelCase labels', () => {
    expect(slugifyFieldKey('completeBy')).toBe('complete_by');
  });

  it('does not abbreviate a bare "person" to "poc"', () => {
    expect(slugifyFieldKey('Person')).not.toBe('poc');
    expect(slugifyFieldKey('For Who')).not.toBe('poc');
  });

  it('is deterministic', () => {
    expect(slugifyFieldKey('Complete By')).toBe(slugifyFieldKey('Complete By'));
  });

  it('strips punctuation', () => {
    expect(slugifyFieldKey("Boss's e-mail!")).toBe('boss_s_e_mail');
  });

  it('prefixes a key that would start with a digit', () => {
    expect(slugifyFieldKey('2nd review')).toBe('f_2nd_review');
  });

  it('truncates a very long label to the key length limit', () => {
    const key = slugifyFieldKey('a'.repeat(200));
    expect(key.length).toBeLessThanOrEqual(64);
  });

  it('returns an empty string for a label with no usable characters', () => {
    expect(slugifyFieldKey('!!!')).toBe('');
  });
});

describe('RESERVED_FIELD_KEYS', () => {
  it('covers the first-class item columns', () => {
    expect(RESERVED_FIELD_KEYS.has('title')).toBe(true);
    expect(RESERVED_FIELD_KEYS.has('deadline_at')).toBe(true);
    expect(RESERVED_FIELD_KEYS.has('when_at')).toBe(true);
    expect(RESERVED_FIELD_KEYS.has('estimate_min')).toBe(true);
  });

  it('covers the timestamps', () => {
    expect(RESERVED_FIELD_KEYS.has('created_at')).toBe(true);
    expect(RESERVED_FIELD_KEYS.has('completed_at')).toBe(true);
  });
});

describe('isValidFieldKey', () => {
  it('accepts lower snake_case', () => {
    expect(isValidFieldKey('complete_by')).toBe(true);
  });

  it.each(['Complete_By', '1st', 'has space', 'has-dash', '', 'a'.repeat(65)])(
    'rejects %s',
    (key) => {
      expect(isValidFieldKey(key)).toBe(false);
    },
  );

  it('rejects a reserved key', () => {
    expect(isValidFieldKey('title')).toBe(false);
  });
});

describe('checkFieldKey', () => {
  it('accepts an available key', () => {
    expect(checkFieldKey('poc', ['assigner'])).toEqual({ ok: true, errors: [] });
  });

  it('rejects a key already in use', () => {
    const result = checkFieldKey('poc', ['poc']);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('already used by another field');
  });

  it('allows a field to keep its own key unchanged', () => {
    expect(checkFieldKey('poc', ['poc'], 'poc')).toEqual({ ok: true, errors: [] });
  });

  it('reports a reserved key and a collision together', () => {
    const result = checkFieldKey('title', ['title']);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('reserved'))).toBe(true);
    expect(result.errors.some((error) => error.includes('already used'))).toBe(true);
  });

  it('rejects surrounding whitespace', () => {
    expect(checkFieldKey(' poc ', []).ok).toBe(false);
  });
});

describe('uniqueFieldKey', () => {
  it('returns the base when it is free', () => {
    expect(uniqueFieldKey('poc', ['other'])).toBe('poc');
  });

  it('suffixes on collision', () => {
    expect(uniqueFieldKey('poc', ['poc'])).toBe('poc_2');
  });

  it('keeps incrementing past several collisions', () => {
    expect(uniqueFieldKey('poc', ['poc', 'poc_2', 'poc_3'])).toBe('poc_4');
  });
});

describe('resolveIsCore', () => {
  it('promotes a sortable field to a real column', () => {
    expect(resolveIsCore({ key: 'k', type: 'text', sortable: true, filterable: false })).toBe(true);
  });

  it('promotes a filterable field to a real column', () => {
    expect(resolveIsCore({ key: 'k', type: 'text', sortable: false, filterable: true })).toBe(true);
  });

  it('promotes types the dashboard queries constantly', () => {
    for (const type of ['duration', 'priority', 'date', 'datetime', 'person'] as const) {
      expect(resolveIsCore({ key: 'k', type, sortable: false, filterable: false })).toBe(true);
    }
  });

  it('leaves an incidental field in the JSON blob', () => {
    expect(resolveIsCore({ key: 'k', type: 'text', sortable: false, filterable: false })).toBe(
      false,
    );
  });
});
