/**
 * The dynamic field editor.
 *
 * Renders one input per field definition, with no per-type branching in the page and
 * no new component per field type. A field added through the settings screen appears
 * here with no code change, which is the entire promise of configurable fields: the
 * alternative is that "add a field" means "edit the app".
 *
 * Required fields are marked and checked before saving, and problems are shown on the
 * field rather than at the top of the form. A form that scrolls you to a summary of
 * errors is a form that makes you hunt.
 */

import { Trash2 } from 'lucide-react';
import { Badge, Button, FieldError, Input, Label, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  DURATION_PRESETS,
  choicesOf,
  coerceValue,
  emptyValueFor,
  groupDefinitions,
  widgetFor,
  type ValidationProblem,
} from '@/lib/item-editor';
import type { FieldDefinition, FieldValue, Person } from '@/lib/types';

export interface FieldEditorProps {
  definitions: FieldDefinition[];
  values: Record<string, FieldValue>;
  problems: ValidationProblem[];
  people: Person[];
  disabled?: boolean;
  onChange: (key: string, value: FieldValue) => void;
}

export function FieldEditor({
  definitions,
  values,
  problems,
  people,
  disabled = false,
  onChange,
}: FieldEditorProps) {
  const problemFor = (key: string): string | undefined =>
    problems.find((problem) => problem.field === key)?.message;

  const groups = groupDefinitions(definitions);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.label ?? 'ungrouped'} className="flex flex-col gap-3">
          {group.label ? (
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h3>
          ) : null}

          {group.fields.map((definition) => (
            <FieldRow
              key={definition.key}
              definition={definition}
              value={values[definition.key]}
              problem={problemFor(definition.key)}
              people={people}
              disabled={disabled}
              onChange={(value) => onChange(definition.key, value)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function FieldRow({
  definition,
  value,
  problem,
  people,
  disabled,
  onChange,
}: {
  definition: FieldDefinition;
  value: FieldValue | undefined;
  problem: string | undefined;
  people: Person[];
  disabled: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const id = `field-${definition.key}`;
  const widget = widgetFor(definition.type);
  const required = definition.required;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{definition.label}</Label>
        {required ? (
          <Badge variant="secondary" className="text-[0.625rem]">
            required
          </Badge>
        ) : null}
        {definition.filterable ? null : (
          <span
            className="text-[0.625rem] text-muted-foreground"
            title="This field cannot be filtered on"
          >
            not filterable
          </span>
        )}
      </div>

      {definition.description ? (
        <p className="text-xs text-muted-foreground">{definition.description}</p>
      ) : null}

      <Control
        id={id}
        widget={widget}
        definition={definition}
        value={value}
        people={people}
        disabled={disabled}
        onChange={onChange}
      />

      <FieldError>{problem}</FieldError>
    </div>
  );
}

function Control({
  id,
  widget,
  definition,
  value,
  people,
  disabled,
  onChange,
}: {
  id: string;
  widget: ReturnType<typeof widgetFor>;
  definition: FieldDefinition;
  value: FieldValue | undefined;
  people: Person[];
  disabled: boolean;
  onChange: (value: FieldValue) => void;
}) {
  switch (widget) {
    case 'longtext':
      return (
        <Textarea
          id={id}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'number':
      return (
        <Input
          id={id}
          type="number"
          disabled={disabled}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(event) => onChange(coerceValue('number', event.target.value))}
        />
      );

    case 'duration':
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            id={id}
            type="number"
            min={0}
            className="w-24"
            disabled={disabled}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(event) => onChange(coerceValue('duration', event.target.value))}
          />
          <span className="text-xs text-muted-foreground">minutes</span>
          <div className="flex flex-wrap gap-1">
            {DURATION_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onChange(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
        </div>
      );

    case 'choice': {
      const choices = choicesOf(definition);
      return (
        <select
          id={id}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">—</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      );
    }

    case 'multi-choice': {
      const choices = choicesOf(definition);
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => {
            const checked = selected.includes(choice.value);
            return (
              <label key={choice.value} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((entry) => entry !== choice.value)
                        : [...selected, choice.value],
                    )
                  }
                />
                {choice.label}
              </label>
            );
          })}
        </div>
      );
    }

    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={value === true}
            onChange={(event) => onChange(coerceValue('boolean', String(event.target.checked)))}
          />
          {value === true ? 'Yes' : value === null || value === undefined ? 'Not set' : 'No'}
        </label>
      );

    case 'date':
      return (
        <Input
          id={id}
          type="date"
          disabled={disabled}
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'datetime':
      return (
        <Input
          id={id}
          type="datetime-local"
          disabled={disabled}
          value={toLocalInputValue(value)}
          onChange={(event) => onChange(fromLocalInputValue(event.target.value))}
        />
      );

    case 'people': {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex flex-col gap-1">
          <select
            id={id}
            multiple
            disabled={disabled}
            value={selected}
            onChange={(event) =>
              onChange([...event.target.selectedOptions].map((option) => option.value))
            }
            className="h-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {selected.map((id_) => {
                const person = people.find((entry) => entry.id === id_);
                return (
                  <span key={id_} className="container-chip border bg-muted">
                    {person?.name ?? id_}
                    <button
                      type="button"
                      aria-label={`Remove ${person?.name ?? id_}`}
                      disabled={disabled}
                      onClick={() => onChange(selected.filter((entry) => entry !== id_))}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    }

    case 'checklist': {
      const entries = Array.isArray(value)
        ? (value as Array<{ id: string; label: string; done: boolean }>)
        : [];
      return (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <label key={entry.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={entry.done}
                onChange={() =>
                  onChange(
                    entries.map((existing) =>
                      existing.id === entry.id ? { ...existing, done: !existing.done } : existing,
                    ),
                  )
                }
              />
              <span className={cn(entry.done && 'text-muted-foreground line-through')}>
                {entry.label}
              </span>
            </label>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={disabled}
            onClick={() => {
              // Ids generated from the length plus the label, so adding two items with
              // the same text still produces distinct rows within one draft.
              onChange([...entries, { id: `c${entries.length}`, label: '', done: false }]);
            }}
          >
            Add a step
          </Button>
        </div>
      );
    }

    case 'url':
      return (
        <Input
          id={id}
          type="url"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    default:
      return (
        <Input
          id={id}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/** `2026-03-01T14:30` in the viewer's own timezone, for a `datetime-local` input. */
export function toLocalInputValue(value: FieldValue | undefined): string {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * And back.
 *
 * Built from local components rather than `toISOString`, because a datetime-local
 * input holds a wall-clock time in the viewer's zone. Round-tripping through UTC is
 * how an event typed as 09:00 becomes 08:00 for anyone not on summer time.
 */
export function fromLocalInputValue(raw: string): FieldValue {
  if (raw === '') {
    return '';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);
  if (!match) {
    return raw;
  }
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

/** Values for a fresh item, seeded from the definitions' own defaults. */
export function initialValues(definitions: FieldDefinition[]): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const definition of definitions) {
    values[definition.key] =
      definition.defaultValue === null || definition.defaultValue === undefined
        ? emptyValueFor(definition.type)
        : definition.defaultValue;
  }
  return values;
}
