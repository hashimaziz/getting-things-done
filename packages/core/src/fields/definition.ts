/**
 * Parsing, validation and construction of field definitions.
 *
 * A field definition is the unit of configurability in this app. Categories such
 * as HOME and WORK each define their own set, and the app must behave correctly
 * for a definition it has never seen before, including one the user creates
 * months from now. So definitions arriving from the database, the API and the
 * field builder are all put through the same schema before use.
 */

import { z } from 'zod';
import { nowIso } from '../dates/index.js';
import { isUuid, newId } from '../ids.js';
import { checkFieldKey, resolveIsCore, slugifyFieldKey } from './keys.js';
import {
  FIELD_TYPES,
  getFieldTypeSpec,
  type FieldDefinition,
  type FieldOptions,
  type FieldType,
  type FieldValue,
} from './types.js';
import { validateFieldValue } from './validate-value.js';

const fieldChoiceSchema = z.object({
  value: z
    .string()
    .min(1)
    .max(64)
    // Restrict to characters that are safe inside JSON paths and SQL bind
    // values, since choices become JSON keys.
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Choice value must be alphanumeric with . _ or -'),
  label: z.string().min(1).max(120),
  color: z.string().max(64).nullable().default(null),
  order: z.number().int().min(0).max(10_000).default(0),
});

const fieldOptionsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('choices'), choices: z.array(fieldChoiceSchema).max(200) }),
  z.object({
    kind: z.literal('number'),
    min: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
    step: z.number().positive().nullable().default(null),
    prefix: z.string().max(16).nullable().default(null),
    suffix: z.string().max(16).nullable().default(null),
  }),
  z.object({
    kind: z.literal('duration'),
    presetsMinutes: z.array(z.number().int().min(0).max(100_000)).max(50).default([]),
  }),
  z.object({
    kind: z.literal('checklist'),
    maxItems: z.number().int().min(1).max(1_000).nullable().default(null),
  }),
]);

const fieldValueSchema: z.ZodType<FieldValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      done: z.boolean(),
    }),
  ),
]);

export const fieldDefinitionSchema = z
  .object({
    id: z.string().refine(isUuid, 'Field id must be a UUID'),
    categoryId: z.string().refine(isUuid, 'Category id must be a UUID').nullable(),
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    description: z.string().max(500).nullable(),
    type: z.enum(FIELD_TYPES),
    options: fieldOptionsSchema,
    required: z.boolean(),
    defaultValue: fieldValueSchema,
    groupLabel: z.string().max(120).nullable(),
    showInTable: z.boolean(),
    showInCard: z.boolean(),
    filterable: z.boolean(),
    sortable: z.boolean(),
    isCore: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine((definition, ctx) => {
    const spec = getFieldTypeSpec(definition.type);

    // Options kind must match the type, otherwise the renderer would read a
    // shape it does not understand.
    if (spec.optionsKind !== null && definition.options.kind !== spec.optionsKind) {
      ctx.addIssue({
        code: 'custom',
        path: ['options', 'kind'],
        message: `A "${definition.type}" field requires options of kind "${spec.optionsKind}"`,
      });
    }
    if (spec.optionsKind === null && definition.options.kind !== 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['options', 'kind'],
        message: `A "${definition.type}" field does not accept options`,
      });
    }

    if (definition.options.kind === 'choices') {
      const values = definition.options.choices.map((choice) => choice.value);
      const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
      if (duplicates.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', 'choices'],
          message: `Duplicate choice values: ${[...new Set(duplicates)].join(', ')}`,
        });
      }
      if (definition.options.choices.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', 'choices'],
          message: `A "${definition.type}" field needs at least one option`,
        });
      }
    }

    if (definition.options.kind === 'number') {
      const { min, max } = definition.options;
      if (min !== null && max !== null && min > max) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Minimum cannot be greater than maximum',
        });
      }
    }

    const keyCheck = checkFieldKey(definition.key);
    if (!keyCheck.ok) {
      for (const message of keyCheck.errors) {
        ctx.addIssue({ code: 'custom', path: ['key'], message });
      }
    }

    // The default has to be storable, otherwise every new item in this category
    // would be born invalid. It is validated with `required` cleared, because a
    // required field's default is legitimately empty: the default means "not
    // supplied yet", and requiring it here would make the field impossible to
    // define in the first place.
    const defaultCheck = validateFieldValue(
      { ...definition, required: false } as FieldDefinition,
      definition.defaultValue,
    );
    if (!defaultCheck.ok) {
      for (const issue of defaultCheck.issues) {
        ctx.addIssue({ code: 'custom', path: ['defaultValue'], message: issue.message });
      }
    }
  });

export type ParsedFieldDefinition = FieldDefinition;

export function parseFieldDefinition(raw: unknown): FieldDefinition {
  return fieldDefinitionSchema.parse(raw) as FieldDefinition;
}

export function safeParseFieldDefinition(raw: unknown) {
  return fieldDefinitionSchema.safeParse(raw);
}

/** What the field builder supplies. Everything else is derived. */
export interface CreateFieldDefinitionInput {
  label: string;
  type: FieldType;
  /** `null` for a definition that applies to every category. */
  categoryId?: string | null;
  /** Derived from the label when omitted. */
  key?: string;
  description?: string | null;
  options?: FieldOptions;
  required?: boolean;
  defaultValue?: FieldValue;
  groupLabel?: string | null;
  showInTable?: boolean;
  showInCard?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  sortOrder?: number;
  /** Field keys already used in this scope, used to de-duplicate a derived key. */
  existingKeys?: Iterable<string>;
}

/**
 * Builds a complete, validated definition from builder input.
 *
 * Throws a `ZodError` when the result would be invalid. Callers that want to
 * surface field-level errors in a form should use `safeParseFieldDefinition`.
 */
export function createFieldDefinition(input: CreateFieldDefinitionInput): FieldDefinition {
  const spec = getFieldTypeSpec(input.type);
  const existingKeys = [...(input.existingKeys ?? [])];

  let key = input.key?.trim() || slugifyFieldKey(input.label);
  if (!input.key?.trim()) {
    // Only de-duplicate derived keys. An explicit key must survive verbatim so
    // the reserved-word check, not silent renaming, decides its fate.
    const taken = new Set(existingKeys);
    if (taken.has(key)) {
      for (let suffix = 2; suffix < 10_000; suffix += 1) {
        if (!taken.has(`${key}_${suffix}`)) {
          key = `${key}_${suffix}`;
          break;
        }
      }
    }
  }

  const timestamp = nowIso();
  const draft = {
    label: input.label,
    key,
    type: input.type,
    sortable: input.sortable ?? false,
    filterable: input.filterable ?? false,
  } as const;

  const definition = {
    id: newId(),
    categoryId: input.categoryId ?? null,
    key,
    label: input.label.trim(),
    description: input.description ?? null,
    type: input.type,
    options: normaliseOptions(input.type, input.options),
    required: input.required ?? false,
    defaultValue: input.defaultValue ?? structuredClone(spec.emptyValue),
    groupLabel: input.groupLabel ?? null,
    showInTable: input.showInTable ?? false,
    showInCard: input.showInCard ?? false,
    filterable: draft.filterable,
    sortable: draft.sortable,
    isCore: resolveIsCore(draft),
    sortOrder: input.sortOrder ?? 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return parseFieldDefinition(definition);
}

/**
 * Coerces supplied options into the shape the type requires.
 *
 * The field builder can offer a type without ever configuring options; this
 * supplies a valid empty default so the user is not forced through an options
 * step they may not need.
 */
export function normaliseOptions(type: FieldType, options: FieldOptions | undefined): FieldOptions {
  const kind = getFieldTypeSpec(type).optionsKind;
  if (kind === null) {
    return { kind: 'none' };
  }
  if (options && options.kind === kind) {
    return options;
  }
  switch (kind) {
    case 'choices':
      return {
        kind: 'choices',
        choices: [
          { value: 'option_1', label: 'Option 1', color: null, order: 0 },
          { value: 'option_2', label: 'Option 2', color: null, order: 1 },
        ],
      };
    case 'number':
      return { kind: 'number', min: null, max: null, step: null, prefix: null, suffix: null };
    case 'duration':
      return { kind: 'duration', presetsMinutes: [5, 15, 30, 60, 120] };
    case 'checklist':
      return { kind: 'checklist', maxItems: null };
    default:
      return { kind: 'none' };
  }
}

/** Sorts definitions into the order the editor and tables should render them. */
export function sortFieldDefinitions(definitions: readonly FieldDefinition[]): FieldDefinition[] {
  return [...definitions].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
}

/**
 * Resolves the definitions that apply to a category: its own plus every global
 * definition with `categoryId === null`.
 *
 * Category-specific definitions win over global ones on key collision, so a
 * global `priority` can be overridden per category without duplicating it.
 */
export function resolveDefinitionsForCategory(
  definitions: readonly FieldDefinition[],
  categoryId: string | null,
): FieldDefinition[] {
  const byKey = new Map<string, FieldDefinition>();
  for (const definition of definitions) {
    if (definition.categoryId === null) {
      byKey.set(definition.key, definition);
    }
  }
  for (const definition of definitions) {
    if (definition.categoryId === categoryId) {
      byKey.set(definition.key, definition);
    }
  }
  return sortFieldDefinitions([...byKey.values()]);
}
