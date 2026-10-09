/**
 * Identifier generation shared by every package.
 *
 * `crypto.randomUUID` exists on `globalThis` in Node 19+ and every browser that
 * ships `crypto.randomUUID`, so no polyfill or Node import is needed. That
 * matters here because `@gtd/core` is loaded by the browser bundle as well as by
 * the server and the CLI, and importing `node:crypto` would break the web build.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Generates a random UUID v4. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
