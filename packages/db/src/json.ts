/**
 * JSON column helpers.
 *
 * Several columns hold JSON documents. Reading one must never throw on the way
 * through a query, because a single malformed value would make an entire list
 * endpoint fail. `readJson` therefore falls back rather than raising, and the
 * repository layer validates structure separately where it matters.
 */

/** Parses a JSON column, returning `fallback` for null, empty or invalid input. */
export function readJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/**
 * Serialises a value for a JSON column.
 *
 * `undefined` and `null` become SQL NULL via `nullIfUndefined`, so a cleared
 * value is stored as absent rather than as the four-character string "null".
 */
export function writeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function nullIfUndefined<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/** Coerces a SQLite INTEGER flag to a boolean. */
export function toBool(value: number | null | undefined): boolean {
  return value === 1;
}

/** Coerces a boolean to the INTEGER SQLite stores. */
export function fromBool(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}
