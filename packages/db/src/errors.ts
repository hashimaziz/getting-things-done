/**
 * Translating SQLite constraint failures into domain errors.
 *
 * Without this, a duplicate category key surfaces as an opaque 500. With it, the
 * repository says what went wrong and the API returns a 409.
 *
 * The kind of violation is decided by SQLite's primary result code, exposed as
 * `errcode` on the driver error. Those are documented, stable integers, unlike the
 * message text, so this does not depend on parsing an English sentence to know
 * whether a write failed because of a duplicate or a missing parent.
 */

import { APP_CONFIG } from '@gtd/core';

/** SQLite primary result codes for constraint failures. */
export const SQLITE_CONSTRAINT = {
  CHECK: 275,
  FOREIGNKEY: 787,
  NOTNULL: 1299,
  PRIMARYKEY: 1555,
  UNIQUE: 2067,
} as const;

export type ConstraintKind = 'unique' | 'foreign_key' | 'not_null' | 'check' | 'other';

/** Reads the SQLite result code off a driver error, or null if it is not one. */
export function sqliteErrcode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === 'number' ? code : null;
}

export function constraintKind(error: unknown): ConstraintKind | null {
  const code = sqliteErrcode(error);
  if (code === null) {
    return null;
  }
  switch (code) {
    case SQLITE_CONSTRAINT.UNIQUE:
    case SQLITE_CONSTRAINT.PRIMARYKEY:
      return 'unique';
    case SQLITE_CONSTRAINT.FOREIGNKEY:
      return 'foreign_key';
    case SQLITE_CONSTRAINT.NOTNULL:
      return 'not_null';
    case SQLITE_CONSTRAINT.CHECK:
      return 'check';
    default:
      return null;
  }
}

/** The entity a write was attempting, so a violation can name it. */
export interface WriteContext {
  /** Human-readable name, e.g. `Category`. */
  entity: string;
  /**
   * Columns under a unique constraint, mapped to a label for the message.
   * When more than one is declared, the driver message is consulted to tell which
   * was violated; with a single entry the message is not read at all.
   */
  unique?: Record<string, string>;
  /** Columns holding a foreign key, mapped to the name of the thing referenced. */
  references?: Record<string, string>;
}

export class DuplicateKeyError extends Error {
  readonly entity: string;
  readonly column: string;
  readonly label: string;

  constructor(entity: string, column: string, label: string) {
    super(`A ${entity} with that ${label} already exists.`);
    this.name = 'DuplicateKeyError';
    this.entity = entity;
    this.column = column;
    this.label = label;
  }
}

export class InvalidReferenceError extends Error {
  readonly entity: string;
  readonly column: string;
  readonly references: string;

  constructor(entity: string, column: string, references: string) {
    super(`That ${references} does not exist.`);
    this.name = 'InvalidReferenceError';
    this.entity = entity;
    this.column = column;
    this.references = references;
  }
}

/**
 * A constraint was violated that this codebase has no specific explanation for.
 *
 * Raised rather than letting the raw driver error escape, so an unexpected
 * violation still produces a domain-shaped error the API can describe.
 */
export class ConstraintViolationError extends Error {
  readonly kind: ConstraintKind;
  readonly entity: string;

  constructor(kind: ConstraintKind, entity: string, detail: string) {
    super(`${APP_CONFIG.identity.name} could not save that ${entity}: ${detail}`);
    this.name = 'ConstraintViolationError';
    this.kind = kind;
    this.entity = entity;
  }
}

/**
 * Reads the column list from a driver message.
 *
 * Only meaningful for UNIQUE and CHECK violations, which name their columns. A
 * foreign-key violation says only "FOREIGN KEY constraint failed", with no
 * indication of which relationship failed.
 */
function columnsFromMessage(error: unknown): string[] {
  const message = error instanceof Error ? error.message : '';
  const match = /constraint failed: (.+)$/i.exec(message);
  if (!match?.[1]) {
    return [];
  }
  return match[1].split(',').map((part) => {
    const segments = part.trim().split('.');
    return segments[segments.length - 1] ?? '';
  });
}

/** Chooses the declared column a violation refers to, or null if undecidable. */
function pickColumn(
  declared: Record<string, string> | undefined,
  error: unknown,
): { column: string; label: string } | null {
  if (!declared) {
    return null;
  }
  const entries = Object.entries(declared);
  const first = entries[0];
  if (!first) {
    return null;
  }
  if (entries.length === 1) {
    // No need to read the message when there is only one candidate.
    return { column: first[0], label: first[1] };
  }
  const violated = columnsFromMessage(error);
  const hit = entries.find(([column]) => violated.includes(column));
  return hit ? { column: hit[0], label: hit[1] } : null;
}

/** `a`, `a or b`, `a, b or c`, for a message naming several possibilities. */
function joinList(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? 'value';
  }
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/**
 * Runs a write, converting constraint failures into domain errors.
 *
 * Errors that are not constraint failures pass through untouched, so genuine
 * bugs are never disguised as user errors.
 */
export function translating<T>(context: WriteContext, run: () => T): T {
  try {
    return run();
  } catch (error) {
    const kind = constraintKind(error);
    if (kind === null) {
      throw error;
    }

    if (kind === 'unique') {
      const unique = pickColumn(context.unique, error);
      if (unique) {
        throw new DuplicateKeyError(context.entity, unique.column, unique.label);
      }
    }

    if (kind === 'foreign_key') {
      // A foreign-key message names no column, so when several relationships are
      // declared it is genuinely undecidable which one failed. Guessing would
      // confidently name the wrong field, so all the candidates are named
      // instead and the caller is told one of them is wrong.
      const declared = Object.values(context.references ?? {});
      if (declared.length === 1) {
        const column = Object.keys(context.references ?? {})[0] as string;
        throw new InvalidReferenceError(context.entity, column, declared[0] as string);
      }
      if (declared.length > 1) {
        throw new InvalidReferenceError(context.entity, 'reference', joinList(declared));
      }
    }

    throw new ConstraintViolationError(
      kind,
      context.entity,
      error instanceof Error ? error.message : String(error),
    );
  }
}
