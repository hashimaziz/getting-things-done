import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConstraintViolationError,
  DuplicateKeyError,
  InvalidReferenceError,
  SQLITE_CONSTRAINT,
  constraintKind,
  createCategoriesRepo,
  createFieldDefsRepo,
  createItemsRepo,
  migrate,
  openMemoryDb,
  sqliteErrcode,
  translating,
  type Db,
} from '../src/index.js';

let db: Db;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
});

describe('sqliteErrcode', () => {
  it('reads the code off a driver error', () => {
    expect(sqliteErrcode({ errcode: SQLITE_CONSTRAINT.UNIQUE })).toBe(SQLITE_CONSTRAINT.UNIQUE);
  });

  it('returns null for a non-SQLite error', () => {
    expect(sqliteErrcode(new Error('boom'))).toBeNull();
    expect(sqliteErrcode(null)).toBeNull();
    expect(sqliteErrcode('nope')).toBeNull();
    expect(sqliteErrcode({})).toBeNull();
  });
});

describe('constraintKind', () => {
  it('maps every constraint code', () => {
    expect(constraintKind({ errcode: SQLITE_CONSTRAINT.UNIQUE })).toBe('unique');
    expect(constraintKind({ errcode: SQLITE_CONSTRAINT.PRIMARYKEY })).toBe('unique');
    expect(constraintKind({ errcode: SQLITE_CONSTRAINT.FOREIGNKEY })).toBe('foreign_key');
    expect(constraintKind({ errcode: SQLITE_CONSTRAINT.NOTNULL })).toBe('not_null');
    expect(constraintKind({ errcode: SQLITE_CONSTRAINT.CHECK })).toBe('check');
  });

  it('returns null for a SQLite error that is not a constraint', () => {
    // SQLITE_ERROR, "SQL logic error" — a bug, not a user mistake.
    expect(constraintKind({ errcode: 1 })).toBeNull();
  });

  it('keeps unique and primary key as distinct codes reporting the same kind', () => {
    // The remedy is identical in both cases: pick a different value.
    expect(SQLITE_CONSTRAINT.UNIQUE).not.toBe(SQLITE_CONSTRAINT.PRIMARYKEY);
    expect(constraintKind({ errcode: SQLITE_CONSTRAINT.PRIMARYKEY })).toBe(
      constraintKind({ errcode: SQLITE_CONSTRAINT.UNIQUE }),
    );
  });
});

describe('translating', () => {
  it('returns the value when nothing throws', () => {
    expect(translating({ entity: 'Thing' }, () => 42)).toBe(42);
  });

  it('passes a non-constraint error through untouched', () => {
    // Genuine bugs must never be disguised as user errors.
    const bug = new TypeError('undefined is not a function');
    expect(() =>
      translating({ entity: 'Thing' }, () => {
        throw bug;
      }),
    ).toThrow(bug);
  });

  it('passes a non-constraint SQLite error through untouched', () => {
    const error = new Error('no such table: nope');
    Object.assign(error, { errcode: 1 });
    expect(() =>
      translating({ entity: 'Thing' }, () => {
        throw error;
      }),
    ).toThrow(error);
  });

  it('translates a unique violation into a duplicate-key error', () => {
    const error = new Error('UNIQUE constraint failed: categories.key');
    Object.assign(error, { errcode: SQLITE_CONSTRAINT.UNIQUE });
    expect(() =>
      translating({ entity: 'Category', unique: { key: 'key' } }, () => {
        throw error;
      }),
    ).toThrow(DuplicateKeyError);
  });

  it('includes the offending column and label', () => {
    const error = new Error('UNIQUE constraint failed: categories.key');
    Object.assign(error, { errcode: SQLITE_CONSTRAINT.UNIQUE });
    try {
      translating({ entity: 'Category', unique: { key: 'key' } }, () => {
        throw error;
      });
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(DuplicateKeyError);
      expect((caught as DuplicateKeyError).column).toBe('key');
      expect((caught as DuplicateKeyError).label).toBe('key');
      expect((caught as Error).message).toBe('A Category with that key already exists.');
    }
  });

  it('picks the right column when several are declared', () => {
    const error = new Error('UNIQUE constraint failed: categories.slug');
    Object.assign(error, { errcode: SQLITE_CONSTRAINT.UNIQUE });
    try {
      translating({ entity: 'Category', unique: { key: 'key', slug: 'slug' } }, () => {
        throw error;
      });
      expect.unreachable();
    } catch (caught) {
      expect((caught as DuplicateKeyError).column).toBe('slug');
    }
  });

  it('falls back to the first declared column when the message names none', () => {
    const error = new Error('UNIQUE constraint failed');
    Object.assign(error, { errcode: SQLITE_CONSTRAINT.UNIQUE });
    try {
      translating({ entity: 'Category', unique: { key: 'key' } }, () => {
        throw error;
      });
      expect.unreachable();
    } catch (caught) {
      expect((caught as DuplicateKeyError).column).toBe('key');
    }
  });

  it('translates a foreign-key violation into an invalid-reference error', () => {
    const error = new Error('FOREIGN KEY constraint failed');
    Object.assign(error, { errcode: SQLITE_CONSTRAINT.FOREIGNKEY });
    try {
      translating({ entity: 'Item', references: { category_id: 'category' } }, () => {
        throw error;
      });
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(InvalidReferenceError);
      expect((caught as Error).message).toBe('That category does not exist.');
    }
  });

  it('falls back to a generic violation for an unmapped constraint', () => {
    const error = new Error('NOT NULL constraint failed: categories.name');
    Object.assign(error, { errcode: SQLITE_CONSTRAINT.NOTNULL });
    try {
      translating({ entity: 'Category' }, () => {
        throw error;
      });
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(ConstraintViolationError);
      expect((caught as ConstraintViolationError).kind).toBe('not_null');
    }
  });

  it('falls back to a generic violation for an unmapped unique constraint', () => {
    const error = new Error('UNIQUE constraint failed: categories.id');
    Object.assign(error, { errcode: SQLITE_CONSTRAINT.PRIMARYKEY });
    try {
      translating({ entity: 'Category' }, () => {
        throw error;
      });
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(ConstraintViolationError);
      expect((caught as ConstraintViolationError).kind).toBe('unique');
    }
  });
});

describe('repositories raise domain errors', () => {
  it('category create rejects a duplicate key with a duplicate-key error', () => {
    const categories = createCategoriesRepo(db);
    categories.create({ key: 'work', name: 'Work' });
    expect(() => categories.create({ key: 'work', name: 'Other' })).toThrow(DuplicateKeyError);
  });

  it('category create duplicate names the entity and the key', () => {
    const categories = createCategoriesRepo(db);
    categories.create({ key: 'work', name: 'Work' });
    try {
      categories.create({ key: 'work', name: 'Other' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('A Category with that key already exists.');
    }
  });

  it('category update rejects a duplicate key', () => {
    const categories = createCategoriesRepo(db);
    categories.create({ key: 'work', name: 'Work' });
    const home = categories.create({ key: 'home', name: 'Home' });
    expect(() => categories.update(home.id, { key: 'work' })).toThrow(DuplicateKeyError);
  });

  it('field definition create rejects a duplicate key in the same scope', () => {
    const categories = createCategoriesRepo(db);
    const category = categories.create({ key: 'work', name: 'Work' });
    const fields = createFieldDefsRepo(db);
    fields.create({ label: 'Assigner', type: 'text', categoryId: category.id, key: 'assigner' });
    expect(() =>
      fields.create({ label: 'Other', type: 'text', categoryId: category.id, key: 'assigner' }),
    ).toThrow(DuplicateKeyError);
  });

  it('field definition create allows the same key in another scope', () => {
    const categories = createCategoriesRepo(db);
    const work = categories.create({ key: 'work', name: 'Work' });
    const home = categories.create({ key: 'home', name: 'Home' });
    const fields = createFieldDefsRepo(db);
    fields.create({ label: 'Assigner', type: 'text', categoryId: work.id, key: 'assigner' });
    expect(() =>
      fields.create({ label: 'Assigner', type: 'text', categoryId: home.id, key: 'assigner' }),
    ).not.toThrow();
  });

  it('item create reports a missing category as an invalid reference', () => {
    const categories = createCategoriesRepo(db);
    const items = createItemsRepo(db, { onInvariantViolation: () => {} });
    const category = categories.create({ key: 'work', name: 'Work' });
    expect(() => items.create({ categoryId: 'missing', title: 'x' })).toThrow(
      InvalidReferenceError,
    );
    expect(() => items.create({ categoryId: category.id, title: 'x' })).not.toThrow();
  });

  it('item create reports a missing project as an invalid reference', () => {
    const categories = createCategoriesRepo(db);
    const items = createItemsRepo(db, { onInvariantViolation: () => {} });
    const category = categories.create({ key: 'work', name: 'Work' });
    expect(() =>
      items.create({ categoryId: category.id, title: 'x', projectId: 'missing' }),
    ).toThrow(InvalidReferenceError);
  });

  it('a genuine bug still surfaces as itself', () => {
    const categories = createCategoriesRepo(db);
    const items = createItemsRepo(db, { onInvariantViolation: () => {} });
    categories.create({ key: 'work', name: 'Work' });
    // Completing a row that does not exist throws ItemNotFoundError, which must
    // not be swallowed into a generic constraint error.
    expect(() => items.complete('missing')).toThrow(/No item with id/);
  });
});
