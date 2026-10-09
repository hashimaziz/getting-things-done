import type { IsoDate, IsoDateTime } from '../dates/index.js';

/**
 * Every field type the configurable schema supports.
 *
 * This list is the contract between the field-definition layer, the SQLite
 * query compiler and the web form renderer. Adding a type here means adding a
 * value validator, an empty value, and a renderer; nothing else changes.
 */
export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'duration',
  'select',
  'multiselect',
  'priority',
  'boolean',
  'date',
  'datetime',
  'person',
  'people',
  'checklist',
  'url',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value);
}

/** One option in a `select`, `multiselect` or `priority` field. */
export interface FieldChoice {
  /** Stable machine value persisted in item data. Never shown to the user. */
  value: string;
  label: string;
  /** Optional CSS colour token or hex used for badges and chart series. */
  color: string | null;
  /**
   * Sort position within the field. Ascending order. For `priority` this is
   * meaningful: lower means more urgent.
   */
  order: number;
}

/**
 * Per-type configuration, discriminated on `kind` so the shape can be validated
 * and persisted as JSON without ambiguity.
 */
export type FieldOptions =
  | { kind: 'none' }
  | { kind: 'choices'; choices: FieldChoice[] }
  | {
      kind: 'number';
      min: number | null;
      max: number | null;
      step: number | null;
      prefix: string | null;
      suffix: string | null;
    }
  | { kind: 'duration'; presetsMinutes: number[] }
  | { kind: 'checklist'; maxItems: number | null };

export const FIELD_OPTION_KINDS = ['none', 'choices', 'number', 'duration', 'checklist'] as const;
export type FieldOptionsKind = (typeof FIELD_OPTION_KINDS)[number];

/** One row in a `checklist` field value. */
export interface ChecklistEntry {
  id: string;
  label: string;
  done: boolean;
}

/**
 * A stored value for a single field.
 *
 * Every field type stores one of these shapes, and the shapes are disjoint, so a
 * consumer narrows by inspecting the value rather than by consulting the
 * definition. That is deliberate: values arrive from JSON at runtime and have
 * lost any link to the definition that produced them, so a generic
 * `FieldValue<FieldDefinition>` would be a compile-time fiction.
 *
 * There is intentionally no nested-object variant. No field type stores a map,
 * and allowing one would make the alias self-referential, which TypeScript
 * cannot express directly.
 */
export type FieldValue = string | number | boolean | null | string[] | ChecklistEntry[];

/**
 * A configurable field definition.
 *
 * Definitions are the reason this app is configurable: a category such as WORK
 * can define `assigner`, `poc` and `priority`, while HOME defines `forWho` and
 * `timeEstimate`, with no code change and no schema migration.
 *
 * A definition with a `categoryId` of `null` applies to every category.
 */
export interface FieldDefinition {
  id: string;
  /** `null` means the field applies to all categories. */
  categoryId: string | null;
  /** Stable machine key. This, not `label`, is what item data is stored under. */
  key: string;
  label: string;
  description: string | null;
  type: FieldType;
  options: FieldOptions;
  required: boolean;
  /** Applied when creating an item. Must itself be valid for the type. */
  defaultValue: FieldValue;
  /** Groups related fields together in the editor, e.g. "Scheduling". */
  groupLabel: string | null;
  showInTable: boolean;
  showInCard: boolean;
  filterable: boolean;
  sortable: boolean;
  /**
   * True when the value is projected onto a first-class `items` column instead
   * of living in the `data_json` blob. Core fields are pre-indexed because
   * queries and charts hit them constantly.
   */
  isCore: boolean;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Static description of a field type. Drives the field builder UI and docs. */
export interface FieldTypeSpec {
  type: FieldType;
  label: string;
  description: string;
  /** Which options kind this type accepts. `null` means options are not configurable. */
  optionsKind: FieldOptionsKind | null;
  /** Whether multiple values can be stored, which decides list rendering. */
  isMultiValued: boolean;
  /** Whether values in this type should sort and compare numerically. */
  isNumeric: boolean;
  /** Whether the type participates in date filtering and the calendar. */
  isTemporal: boolean;
  /** An empty, valid value. Used to clear a field and to seed unstarted rows. */
  emptyValue: FieldValue;
  /** Human-readable rendering of a value, for list cells and chart legends. */
  format(value: FieldValue, options: FieldOptions): string;
  /** Comparable sort key for a value, used to order `select` and `priority`. */
  sortKey(value: FieldValue, options: FieldOptions): number | string;
}

const NONE: FieldOptions = { kind: 'none' };

function labelFor(value: FieldValue, options: FieldOptions, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  if (options.kind === 'choices') {
    return options.choices.find((choice) => choice.value === value)?.label ?? value;
  }
  return value;
}

function choicesOrder(value: FieldValue, options: FieldOptions): number {
  if (typeof value !== 'string' || options.kind !== 'choices') {
    return Number.MAX_SAFE_INTEGER;
  }
  return options.choices.find((choice) => choice.value === value)?.order ?? Number.MAX_SAFE_INTEGER;
}

function emptyStringArray(): FieldValue {
  return [];
}

function emptyChecklist(): FieldValue {
  return [];
}

/**
 * The field type registry.
 *
 * Lookups go through {@link getFieldTypeSpec}, which throws on an unknown type
 * rather than returning undefined, so a typo in a stored definition fails loudly
 * at the boundary instead of silently rendering nothing.
 */
export const FIELD_TYPE_REGISTRY: Record<FieldType, FieldTypeSpec> = {
  text: {
    type: 'text',
    label: 'Text',
    description: 'A single line of free text.',
    optionsKind: null,
    isMultiValued: false,
    isNumeric: false,
    isTemporal: false,
    emptyValue: '',
    format: (value) => (typeof value === 'string' ? value : ''),
    sortKey: (value) => (typeof value === 'string' ? value.toLowerCase() : ''),
  },
  longtext: {
    type: 'longtext',
    label: 'Notes',
    description: 'Multi-line free text, for detail that does not deserve its own field.',
    optionsKind: null,
    isMultiValued: false,
    isNumeric: false,
    isTemporal: false,
    emptyValue: '',
    format: (value) => (typeof value === 'string' ? value : ''),
    sortKey: (value) => (typeof value === 'string' ? value.toLowerCase() : ''),
  },
  number: {
    type: 'number',
    label: 'Number',
    description: 'A plain numeric value.',
    optionsKind: 'number',
    isMultiValued: false,
    isNumeric: true,
    isTemporal: false,
    emptyValue: null,
    format: (value, options) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '';
      }
      const { prefix, suffix } =
        options.kind === 'number' ? options : { prefix: null, suffix: null };
      return `${prefix ?? ''}${value}${suffix ?? ''}`;
    },
    sortKey: (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0),
  },
  duration: {
    type: 'duration',
    label: 'Time estimate',
    description: 'A duration in whole minutes.',
    optionsKind: 'duration',
    isMultiValued: false,
    isNumeric: true,
    isTemporal: false,
    emptyValue: null,
    format: (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return '';
      }
      if (value === 0) {
        return '0m';
      }
      const hours = Math.floor(value / 60);
      const minutes = value % 60;
      if (hours === 0) {
        return `${minutes}m`;
      }
      return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
    },
    sortKey: (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0),
  },
  select: {
    type: 'select',
    label: 'Select',
    description: 'Exactly one option from a configured list.',
    optionsKind: 'choices',
    isMultiValued: false,
    isNumeric: false,
    isTemporal: false,
    emptyValue: '',
    format: (value, options) => labelFor(value, options, ''),
    sortKey: (_value, options) => choicesOrder(_value, options),
  },
  multiselect: {
    type: 'multiselect',
    label: 'Multi-select',
    description: 'Any number of options from a configured list.',
    optionsKind: 'choices',
    isMultiValued: true,
    isNumeric: false,
    isTemporal: false,
    emptyValue: emptyStringArray(),
    format: (value, options) => {
      if (!Array.isArray(value)) {
        return '';
      }
      // Both string[] and ChecklistEntry[] are arrays, so Array.isArray cannot
      // distinguish them. Only string entries have a label to resolve.
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => labelFor(entry, options, entry))
        .join(', ');
    },
    sortKey: () => 0,
  },
  priority: {
    type: 'priority',
    label: 'Priority',
    description: 'A single option from an ordered scale, where lower order means more urgent.',
    optionsKind: 'choices',
    isMultiValued: false,
    isNumeric: false,
    isTemporal: false,
    emptyValue: '',
    format: (value, options) => labelFor(value, options, ''),
    sortKey: (_value, options) => choicesOrder(_value, options),
  },
  boolean: {
    type: 'boolean',
    label: 'Checkbox',
    description: 'A yes or no flag.',
    optionsKind: null,
    isMultiValued: false,
    isNumeric: false,
    isTemporal: false,
    emptyValue: false,
    format: (value) => (value === true ? 'Yes' : 'No'),
    sortKey: (value) => (value === true ? 1 : 0),
  },
  date: {
    type: 'date',
    label: 'Date',
    description: 'A calendar day with no time component, stored as YYYY-MM-DD.',
    optionsKind: null,
    isMultiValued: false,
    isNumeric: false,
    isTemporal: true,
    emptyValue: '',
    format: (value) => (typeof value === 'string' ? value : ''),
    sortKey: (value) => (typeof value === 'string' ? value : ''),
  },
  datetime: {
    type: 'datetime',
    label: 'Date and time',
    description: 'A specific instant, stored as ISO 8601 UTC.',
    optionsKind: null,
    isMultiValued: false,
    isNumeric: false,
    isTemporal: true,
    emptyValue: '',
    format: (value) => (typeof value === 'string' ? value : ''),
    sortKey: (value) => (typeof value === 'string' ? value : ''),
  },
  person: {
    type: 'person',
    label: 'Person',
    description: 'A single reference to a saved person.',
    optionsKind: null,
    isMultiValued: false,
    isNumeric: false,
    isTemporal: false,
    emptyValue: '',
    format: (value, options) => labelFor(value, options, typeof value === 'string' ? value : ''),
    sortKey: (value) => (typeof value === 'string' ? value.toLowerCase() : ''),
  },
  people: {
    type: 'people',
    label: 'People',
    description: 'Any number of references to saved people.',
    optionsKind: null,
    isMultiValued: true,
    isNumeric: false,
    isTemporal: false,
    emptyValue: emptyStringArray(),
    format: (value, options) => {
      if (!Array.isArray(value)) {
        return '';
      }
      // Both string[] and ChecklistEntry[] are arrays, so Array.isArray cannot
      // distinguish them. Only string entries have a label to resolve.
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => labelFor(entry, options, entry))
        .join(', ');
    },
    sortKey: () => 0,
  },
  checklist: {
    type: 'checklist',
    label: 'Checklist',
    description: 'An ordered list of checkbox rows.',
    optionsKind: 'checklist',
    isMultiValued: true,
    isNumeric: false,
    isTemporal: false,
    emptyValue: emptyChecklist(),
    format: (value) => {
      if (!Array.isArray(value)) {
        return '';
      }
      const rows = value as ChecklistEntry[];
      if (rows.length === 0) {
        return '';
      }
      const done = rows.filter((row) => row.done).length;
      return `${done}/${rows.length}`;
    },
    sortKey: () => 0,
  },
  url: {
    type: 'url',
    label: 'URL',
    description: 'An absolute http or https link.',
    optionsKind: null,
    isMultiValued: false,
    isNumeric: false,
    isTemporal: false,
    emptyValue: '',
    format: (value) => (typeof value === 'string' ? value : ''),
    sortKey: (value) => (typeof value === 'string' ? value.toLowerCase() : ''),
  },
};

export const DEFAULT_FIELD_OPTIONS: FieldOptions = NONE;

/** Throws when the type is not part of the registry. */
export function getFieldTypeSpec(type: FieldType): FieldTypeSpec {
  const spec = FIELD_TYPE_REGISTRY[type];
  if (!spec) {
    throw new RangeError(`Unknown field type: ${String(type)}`);
  }
  return spec;
}

/** Narrowing guard for values that should be `IsoDate`. */
export function isIsoDateFieldValue(value: FieldValue): value is IsoDate {
  return typeof value === 'string';
}

/** Narrowing guard for values that should be `IsoDateTime`. */
export function isIsoDateTimeFieldValue(value: FieldValue): value is IsoDateTime {
  return typeof value === 'string';
}
