/**
 * Shared shaping for item responses.
 *
 * An item is stored as a core record plus a map of user-defined values. The client
 * needs the resolved value for *every* field applying to the category, including
 * ones never set, so the editor can render a complete form without inferring
 * empty values itself. Several routes return items, so that shaping lives here
 * rather than in whichever route happens to need it first.
 */

import { emptyValueFor, type FieldDefinition, type FieldValue, type Item } from '@gtd/core';

/** The resolved value of every applicable field, defaulting the unset ones. */
export function toFieldValues(
  definitions: readonly FieldDefinition[],
  data: Record<string, FieldValue>,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const definition of definitions) {
    values[definition.key] =
      data[definition.key] ??
      (definition.defaultValue as FieldValue | undefined) ??
      emptyValueFor(definition.type);
  }
  return values;
}

/** An item plus its resolved field values. */
export interface ExpandedItem extends Item {
  values: Record<string, FieldValue>;
}

export function expandItem(item: Item, definitions: readonly FieldDefinition[]): ExpandedItem {
  return { ...item, values: toFieldValues(definitions, item.data) };
}
