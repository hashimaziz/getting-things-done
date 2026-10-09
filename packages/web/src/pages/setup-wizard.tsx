/**
 * The first-run setup wizard.
 *
 * Setup exists because the app refuses to guess. Categories, fields, the timezone
 * and the first day of the week are all things that change how everything else is
 * read, and getting one of them quietly wrong poisons the data rather than
 * producing an error.
 *
 * Four steps, in dependency order: the questions that affect every later screen,
 * then categories, then fields, then a summary you can check. There is no skip. A
 * GTD system set up wrong is worse than one set up late, because the wrong setup
 * is trusted.
 *
 * State is lifted to the top and passed down as plain updater functions. Three
 * nested steps with four setters apiece is more plumbing than it looks, and it is
 * still less bad than the alternative: module-level mutable setters that every step
 * reaches for. Those work until two wizards are mounted at once, and then they fail
 * by writing to the wrong one.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
  Separator,
} from '@/components/ui';
import { useStatus } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/document-title';
import {
  emptyCategory,
  emptyField,
  isComplete,
  suggestedCategories,
  validateSetup,
  type SetupState as WizardState,
  type WizardCategory,
  type WizardField,
} from '@/setup/plan';
import { useSetupWizard } from '@/setup/use-setup-wizard';
import type { FieldType } from '@/lib/types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The field types worth offering in a quick setup, in the order they earn their place. */
const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'duration', label: 'Duration' },
  { value: 'priority', label: 'Priority' },
  { value: 'select', label: 'Choice' },
  { value: 'multiselect', label: 'Multiple choice' },
  { value: 'boolean', label: 'Yes or no' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date and time' },
  { value: 'person', label: 'Person' },
  { value: 'people', label: 'People' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'url', label: 'Link' },
];

const STEPS = [
  { id: 'basics', title: 'Basics', blurb: 'When your day starts.' },
  { id: 'categories', title: 'Categories', blurb: 'Where your things live.' },
  { id: 'fields', title: 'Fields', blurb: 'What each category tracks.' },
  { id: 'review', title: 'Review', blurb: 'Check it before it is written.' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

let draftCounter = 0;
const nextDraftId = (prefix: string): string => `${prefix}-${++draftCounter}`;

function needsChoices(type: FieldType): boolean {
  return type === 'select' || type === 'multiselect' || type === 'priority';
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Everything a step needs to change the wizard state, in one object. */
interface StateApi {
  state: WizardState;
  patch: (changes: Partial<WizardState>) => void;
  addCategory: () => void;
  addSuggestedCategories: () => void;
  updateCategory: (localId: string, changes: Partial<WizardCategory>) => void;
  removeCategory: (localId: string) => void;
  addField: (categoryId: string) => void;
  updateField: (categoryId: string, index: number, changes: Partial<WizardField>) => void;
  removeField: (categoryId: string, index: number) => void;
}

export function SetupWizard() {
  useDocumentTitle('Setup');

  const navigate = useNavigate();
  const { data: status } = useStatus();
  const wizard = useSetupWizard();

  const [step, setStep] = useState<StepId>('basics');
  const [state, setState] = useState<WizardState>(() => ({
    timezone: detectTimezone(),
    weekStartsOn: 1,
    categories: [],
  }));
  /** Problems are only shown after an attempt, not while typing. */
  const [showProblems, setShowProblems] = useState(false);

  const patch = useCallback(
    (changes: Partial<WizardState>) => setState((previous) => ({ ...previous, ...changes })),
    [],
  );

  const api = useMemo<StateApi>(
    () => ({
      state,
      patch,
      addCategory: () =>
        setState((previous) => ({
          ...previous,
          categories: [...previous.categories, emptyCategory(nextDraftId('category'))],
        })),
      addSuggestedCategories: () =>
        setState((previous) => ({
          ...previous,
          categories: [
            ...previous.categories,
            ...suggestedCategories().map((suggestion, index) => ({
              ...suggestion,
              localId: nextDraftId(`suggested-${index}`),
            })),
          ],
        })),
      updateCategory: (localId, changes) =>
        setState((previous) => ({
          ...previous,
          categories: previous.categories.map((category) =>
            category.localId === localId ? { ...category, ...changes } : category,
          ),
        })),
      removeCategory: (localId) =>
        setState((previous) => ({
          ...previous,
          categories: previous.categories.filter((category) => category.localId !== localId),
        })),
      addField: (categoryId) =>
        setState((previous) => ({
          ...previous,
          categories: previous.categories.map((category) =>
            category.localId === categoryId
              ? { ...category, fields: [...category.fields, emptyField()] }
              : category,
          ),
        })),
      updateField: (categoryId, index, changes) =>
        setState((previous) => ({
          ...previous,
          categories: previous.categories.map((category) =>
            category.localId === categoryId
              ? {
                  ...category,
                  fields: category.fields.map((field, i) =>
                    i === index ? { ...field, ...changes } : field,
                  ),
                }
              : category,
          ),
        })),
      removeField: (categoryId, index) =>
        setState((previous) => ({
          ...previous,
          categories: previous.categories.map((category) =>
            category.localId === categoryId
              ? { ...category, fields: category.fields.filter((_, i) => i !== index) }
              : category,
          ),
        })),
    }),
    [state, patch],
  );

  const problems = useMemo(() => validateSetup(state), [state]);
  const stepIndex = STEPS.findIndex((entry) => entry.id === step);

  const finish = async (): Promise<void> => {
    setShowProblems(true);
    if (!isComplete(state)) {
      // Send the user to the step that is wrong, rather than leaving them on the
      // summary wondering which of the three things failed.
      const target: StepId = problems.timezone
        ? 'basics'
        : problems.weekStartsOn
          ? 'basics'
          : 'categories';
      setStep(target);
      return;
    }

    const ok = await wizard.run(state);
    if (ok) {
      toast.success('Setup complete');
      navigate('/dashboard', { replace: true });
      return;
    }
    toast.error('Setup stopped partway. See the details below.');
  };

  // Someone who has already set the app up has no business here: it would only
  // offer to create a second set of categories alongside the first.
  if (status?.setupCompleted === true) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-lg font-semibold">Setup is already done</h1>
        <p className="text-sm text-muted-foreground">
          Categories and fields are managed in settings now.
        </p>
        <Button onClick={() => navigate('/dashboard', { replace: true })}>
          Go to the dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Set up GTD</h1>
        <p className="text-sm text-muted-foreground">
          Four short steps. Nothing is written until the last one.
        </p>
      </header>

      <ol className="flex flex-wrap gap-2" aria-label="Setup steps">
        {STEPS.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => setStep(entry.id)}
              aria-current={entry.id === step ? 'step' : undefined}
              className={cn(
                'rounded-md px-2 py-1 text-xs',
                entry.id === step
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {index + 1}. {entry.title}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[stepIndex]?.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{STEPS[stepIndex]?.blurb}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {step === 'basics' ? <BasicsStep api={api} showProblems={showProblems} /> : null}
          {step === 'categories' ? <CategoriesStep api={api} showProblems={showProblems} /> : null}
          {step === 'fields' ? <FieldsStep api={api} /> : null}
          {step === 'review' ? <ReviewStep state={state} /> : null}
        </CardContent>
      </Card>

      {wizard.failure ? <FailureCard failure={wizard.failure} onDismiss={wizard.reset} /> : null}

      <footer className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          disabled={stepIndex === 0 || wizard.running}
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)]?.id ?? 'basics')}
        >
          Back
        </Button>

        {stepIndex === STEPS.length - 1 ? (
          <Button onClick={finish} disabled={wizard.running}>
            {wizard.running
              ? `Setting up… ${wizard.progress?.current ?? 0} of ${wizard.progress?.total ?? 0}`
              : 'Finish setup'}
          </Button>
        ) : (
          <Button onClick={() => setStep(STEPS[stepIndex + 1]?.id ?? 'review')}>Next</Button>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------- steps */

function BasicsStep({ api, showProblems }: { api: StateApi; showProblems: boolean }) {
  const problems = validateSetup(api.state);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="setup-timezone">Timezone</Label>
        <Input
          id="setup-timezone"
          value={api.state.timezone}
          onChange={(event) => api.patch({ timezone: event.target.value })}
          placeholder="Europe/London"
        />
        <p className="text-xs text-muted-foreground">
          Recurring items expand in this zone, so a weekly item keeps its local time across a
          daylight saving change instead of drifting by an hour twice a year.
        </p>
        <FieldError>{showProblems ? problems.timezone : undefined}</FieldError>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="setup-week-start">First day of the week</Label>
        <select
          id="setup-week-start"
          value={api.state.weekStartsOn}
          onChange={(event) => api.patch({ weekStartsOn: Number(event.target.value) })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {WEEKDAYS.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </select>
        <FieldError>{showProblems ? problems.weekStartsOn : undefined}</FieldError>
      </div>
    </div>
  );
}

function CategoriesStep({ api, showProblems }: { api: StateApi; showProblems: boolean }) {
  const problems = validateSetup(api.state);
  const { state } = api;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        A category is a kind of thing, not a place to put it. Everyone ends up with their own set;
        these are the common ones.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={api.addCategory}>
          <Plus />
          Add a category
        </Button>
        {state.categories.length === 0 ? (
          <Button size="sm" variant="ghost" onClick={api.addSuggestedCategories}>
            Start from a suggestion
          </Button>
        ) : null}
      </div>

      {state.categories.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          No categories yet.
        </p>
      ) : null}

      {state.categories.map((category) => (
        <div key={category.localId} className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Category name"
              value={category.name}
              placeholder="Work"
              onChange={(event) =>
                api.updateCategory(category.localId, { name: event.target.value })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${category.name || 'category'}`}
              onClick={() => api.removeCategory(category.localId)}
            >
              <Trash2 />
            </Button>
          </div>
          <Input
            aria-label="Description"
            value={category.description ?? ''}
            placeholder="What belongs here?"
            onChange={(event) =>
              api.updateCategory(category.localId, { description: event.target.value || null })
            }
          />
        </div>
      ))}

      <FieldError>{showProblems ? problems.categories : undefined}</FieldError>
    </div>
  );
}

function FieldsStep({ api }: { api: StateApi }) {
  const { state } = api;

  if (state.categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a category first. Fields belong to a category.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Everything already tracks title, notes, project, context, estimate, hard date and deadline.
        Add only what you will actually use.
      </p>

      {state.categories.map((category) => (
        <section key={category.localId} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{category.name || 'Untitled category'}</h2>

          {category.fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">No custom fields.</p>
          ) : null}

          {category.fields.map((field, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Field label"
                  value={field.label}
                  placeholder="Priority"
                  onChange={(event) =>
                    api.updateField(category.localId, index, { label: event.target.value })
                  }
                />
                <select
                  aria-label="Field type"
                  value={field.type}
                  onChange={(event) =>
                    api.updateField(category.localId, index, {
                      type: event.target.value as FieldType,
                    })
                  }
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${field.label || 'field'}`}
                  onClick={() => api.removeField(category.localId, index)}
                >
                  <Trash2 />
                </Button>
              </div>

              {needsChoices(field.type) ? (
                <Input
                  aria-label="Choices, highest first"
                  value={(field.choices ?? []).join(', ')}
                  placeholder="High, Medium, Low"
                  onChange={(event) =>
                    api.updateField(category.localId, index, {
                      choices: event.target.value.split(',').map((part) => part.trim()),
                    })
                  }
                />
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={field.showInTable}
                    onChange={(event) =>
                      api.updateField(category.localId, index, {
                        showInTable: event.target.checked,
                      })
                    }
                  />
                  In list columns
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={field.filterable}
                    onChange={(event) =>
                      api.updateField(category.localId, index, { filterable: event.target.checked })
                    }
                  />
                  Filterable
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={field.sortable}
                    onChange={(event) =>
                      api.updateField(category.localId, index, { sortable: event.target.checked })
                    }
                  />
                  Sortable
                </label>
              </div>

              {/*
                Sorting a custom field is not free: the server maintains a
                `json_extract` expression index for it. Said plainly here so the
                choice is informed rather than discovered later as slow queries.
              */}
              {field.sortable ? (
                <p className="text-[0.6875rem] text-muted-foreground">
                  Sorting on this field needs an index the server maintains as items change.
                </p>
              ) : null}
            </div>
          ))}

          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => api.addField(category.localId)}
          >
            <Plus />
            Add a field to {category.name || 'this category'}
          </Button>
        </section>
      ))}
    </div>
  );
}

function ReviewStep({ state }: { state: WizardState }) {
  const named = state.categories.filter((category) => category.name.trim() !== '');
  const fieldCount = named.reduce(
    (sum, category) => sum + category.fields.filter((field) => field.label.trim() !== '').length,
    0,
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Timezone</dt>
        <dd>{state.timezone}</dd>
        <dt className="text-muted-foreground">Week starts</dt>
        <dd>{WEEKDAYS[state.weekStartsOn]}</dd>
        <dt className="text-muted-foreground">Categories</dt>
        <dd>{named.length}</dd>
        <dt className="text-muted-foreground">Custom fields</dt>
        <dd>{fieldCount}</dd>
      </dl>

      <Separator />

      <ul className="flex flex-col gap-1 text-xs">
        {named.map((category) => {
          const fields = category.fields.filter((field) => field.label.trim() !== '');
          return (
            <li key={category.localId}>
              <span className="font-medium">{category.name}</span>
              {fields.length === 0
                ? ' — no custom fields'
                : ` — ${fields.map((f) => f.label).join(', ')}`}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Everything here can be changed later in settings. Changing a field later is much easier than
        fixing data captured under the wrong shape.
      </p>
    </div>
  );
}

function FailureCard({
  failure,
  onDismiss,
}: {
  failure: { purpose: string; message: string; completed: string[] };
  onDismiss: () => void;
}) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Setup stopped while {failure.purpose}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>{failure.message}</p>
        {failure.completed.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">Already created:</p>
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {failure.completed.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="text-xs text-muted-foreground">
          What was created stays. Adjust the setup and run it again, then remove any duplicates it
          leaves behind in settings.
        </p>
        <div>
          <Button variant="outline" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
