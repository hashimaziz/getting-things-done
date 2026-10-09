/**
 * Removes `undefined` entries from an object.
 *
 * Zod's inferred output types every optional key as `T | undefined`, which under
 * `exactOptionalPropertyTypes` is not assignable to a domain patch type where an
 * absent key means "leave alone". Stripping the undefined keys turns the Zod
 * result into exactly that, and is clearer at the call site than spreading
 * `...(value === undefined ? {} : { value })` on every field.
 *
 * `null` is preserved: for a nullable field it means "clear this", which is a
 * meaningful instruction and must not be dropped.
 */

/**
 * Strips `undefined` from an optional key while leaving it optional, and leaves
 * a required key required.
 *
 * Zod's inferred output types every optional key as `T | undefined`, which under
 * `exactOptionalPropertyTypes` is not assignable to a domain input where an absent
 * key means "leave alone". The mapping is split into two passes because a single
 * `{ [K in keyof T]?: ... }` would also weaken keys that Zod requires.
 */
type Compacted<T> = {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
} & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

export function compact<T extends object>(input: T): Compacted<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as Compacted<T>;
}
