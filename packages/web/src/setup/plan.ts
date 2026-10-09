/**
 * The setup wizard's plan.
 *
 * The wizard collects answers, this module turns them into the exact sequence of
 * requests that apply them, and a hook executes that sequence. The split is
 * deliberate: what gets created, in what order, with what defaults, is the part
 * worth testing hard, and it is fully testable without a browser or a server.
 *
 * Nothing here talks to the network. The wizard's correctness does not depend on
 * being able to render React.
 */

import type { FieldChoice, FieldType } from '@/lib/types';

/** A field the user is about to create, before the server assigns it an id. */
export interface WizardField {
  label: string;
  type: FieldType;
  /** Only meaningful for the choice-based types. */
  choices?: string[];
  required: boolean;
  showInTable: boolean;
  filterable: boolean;
  sortable: boolean;
  description?: string | null;
}

export interface WizardCategory {
  /** Client-side identity, so two categories both named "Work" stay distinct. */
  localId: string;
  name: string;
  description: string | null;
  color: string | null;
  fields: WizardField[];
}

export interface SetupState {
  timezone: string;
  weekStartsOn: number;
  categories: WizardCategory[];
}

/** One request to make. Executed in order. */
export interface SetupRequest {
  method: 'PUT' | 'POST';
  path: string;
  body: Record<string, unknown>;
  /** Which category this belongs to, for error reporting. */
  categoryName: string | null;
  /** What the user was answering when this request was made. */
  purpose: string;
}

/**
 * Setup keys.
 *
 * Mirrors core's `SETTING_KEYS`. A test asserts they agree, for the same reason
 * the web package mirrors core's other constants: core is Node-targeted, and the
 * browser must not import it for two strings.
 */
export const SETUP_KEYS = {
  setupCompleted: 'setup.completed',
  timezone: 'app.timezone',
  weekStartsOn: 'app.weekStartsOn',
} as const;

/**
 * Whether a setting may be written freely.
 *
 * Enforced here rather than only by convention: the wizard writes by path, and a
 * path built from a value typed into a form is exactly the kind of thing that can
 * be pointed somewhere unintended.
 */
export function isSetupKey(key: string): boolean {
  return Object.values(SETUP_KEYS).includes(key as (typeof SETUP_KEYS)[keyof typeof SETUP_KEYS]);
}

/** Turns "High, Medium, Low" into ordered choices, highest first. */
export function choicesFromLabels(labels: string[]): FieldChoice[] {
  return labels
    .map((label) => label.trim())
    .filter((label) => label !== '')
    .map((label, index) => ({
      // Slugified for the stored value, so filtering by value does not depend on
      // the label's capitalisation or spacing.
      value: label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, ''),
      label,
      color: null,
      order: index,
    }));
}

function fieldBody(field: WizardField): Record<string, unknown> {
  const body: Record<string, unknown> = {
    label: field.label.trim(),
    type: field.type,
    required: field.required,
    showInTable: field.showInTable,
    // Filtering and sorting a custom field is not free: the server builds a
    // `json_extract` expression index for it. Offered as a default because a field
    // you cannot filter or sort is a field you have to remember, but it is a
    // choice the user can turn off.
    filterable: field.filterable,
    sortable: field.sortable,
  };

  if (field.description !== undefined && field.description !== null) {
    body.description = field.description;
  }

  const choices = field.choices ?? [];
  if (field.type === 'select' || field.type === 'multiselect' || field.type === 'priority') {
    body.options = { kind: 'choices', choices: choicesFromLabels(choices) };
  }

  return body;
}

/**
 * The full sequence of requests that applies the wizard's answers.
 *
 * Order matters in one place only: settings are written before categories, so that
 * if the wizard is interrupted after the first category, the app is already
 * configured enough to open and add the rest by hand. Categories come before their
 * fields because a field cannot exist without a category to scope it to.
 */
export function buildSetupPlan(state: SetupState): SetupRequest[] {
  const requests: SetupRequest[] = [
    {
      method: 'PUT',
      path: `/settings/${SETUP_KEYS.timezone}`,
      body: { value: state.timezone },
      categoryName: null,
      purpose: 'timezone',
    },
    {
      method: 'PUT',
      path: `/settings/${SETUP_KEYS.weekStartsOn}`,
      body: { value: state.weekStartsOn },
      categoryName: null,
      purpose: 'first day of the week',
    },
  ];

  for (const [index, category] of state.categories.entries()) {
    requests.push({
      method: 'POST',
      path: '/categories',
      body: {
        name: category.name.trim(),
        sortOrder: index,
        ...(category.description ? { description: category.description } : {}),
        ...(category.color ? { color: category.color } : {}),
      },
      categoryName: category.name,
      purpose: `category "${category.name}"`,
    });
  }

  // Field creation needs the category id the POST above will return, so the plan is
  // two phases: `categoryRequests` resolve ids, then field requests are built
  // against those ids. The executor threads the id through; see `buildFieldPlan`.
  return requests;
}

/**
 * The fields for a category, addressed at the id it was actually created with.
 *
 * Separate from {@link buildSetupPlan} because the id is not known until the
 * category exists. Building this after the POST is what keeps the plan a pure
 * function of the wizard state rather than of network order.
 */
export function buildFieldPlan(categoryId: string, fields: WizardField[]): SetupRequest[] {
  return fields
    .filter((field) => field.label.trim() !== '')
    .map((field, index) => ({
      method: 'POST' as const,
      path: `/categories/${categoryId}/fields`,
      body: { ...fieldBody(field), sortOrder: index },
      categoryName: null,
      purpose: `field "${field.label.trim()}"`,
    }));
}

export interface SetupProblems {
  timezone?: string;
  weekStartsOn?: string;
  categories?: string;
}

/**
 * What is still missing before setup can be applied.
 *
 * A category is required, not optional. Capture puts items somewhere, and an app
 * whose inbox has no category to file into cannot accept a single thing. Better to
 * insist on one at setup than to be unable to capture later.
 */
export function validateSetup(state: SetupState): SetupProblems {
  const problems: SetupProblems = {};

  if (state.timezone.trim() === '') {
    problems.timezone = 'Choose the timezone your days start in.';
  }

  if (!Number.isInteger(state.weekStartsOn) || state.weekStartsOn < 0 || state.weekStartsOn > 6) {
    problems.weekStartsOn = 'Pick a day of the week.';
  }

  // An unnamed category is a draft the user started and abandoned. It is not an
  // error: the fields step may be open behind it. It only counts once named.
  const named = state.categories.filter((category) => category.name.trim() !== '');
  if (named.length === 0) {
    problems.categories =
      'Add at least one category. Everything you capture needs somewhere to go.';
    return problems;
  }

  const seen = new Set<string>();
  for (const category of named) {
    const key = category.name.trim().toLowerCase();
    if (seen.has(key)) {
      // Two categories differing only in case are the same category to a person,
      // and the duplicate key constraint would reject the second one anyway.
      problems.categories = `"${category.name}" is listed twice.`;
      break;
    }
    seen.add(key);
  }

  return problems;
}

export function isComplete(state: SetupState): boolean {
  return Object.keys(validateSetup(state)).length === 0;
}

/**
 * A suggested starting point.
 *
 * Offered, not applied. Setup that silently creates five categories and nine fields
 * on the first run is setup that has to be undone before it can be understood.
 */
export function suggestedCategories(): WizardCategory[] {
  // The `localId` here identifies a suggestion template, not a draft in the
  // wizard. Whoever accepts one assigns a fresh draft id, since accepting the same
  // suggestion twice must produce two editable rows rather than one shared row.
  return [
    {
      localId: 'suggested-personal',
      name: 'Personal',
      description: 'Home, family, health, and everything that is not work.',
      color: '#4f7cff',
      fields: [
        {
          label: 'Priority',
          type: 'priority',
          choices: ['High', 'Medium', 'Low'],
          required: false,
          showInTable: true,
          filterable: true,
          sortable: true,
        },
      ],
    },
    {
      localId: 'suggested-work',
      name: 'Work',
      description: 'Anything owed to an employer or a client.',
      color: '#00a37a',
      fields: [
        {
          label: 'Priority',
          type: 'priority',
          choices: ['High', 'Medium', 'Low'],
          required: false,
          showInTable: true,
          filterable: true,
          sortable: true,
        },
        {
          label: 'Assigner',
          type: 'person',
          required: false,
          showInTable: false,
          filterable: true,
          sortable: false,
        },
      ],
    },
  ];
}

/** An empty draft, used by "add another" and by tests. */
export function emptyCategory(localId: string): WizardCategory {
  return { localId, name: '', description: null, color: null, fields: [] };
}

export function emptyField(): WizardField {
  return {
    label: '',
    type: 'text',
    required: false,
    showInTable: false,
    filterable: true,
    sortable: false,
  };
}
