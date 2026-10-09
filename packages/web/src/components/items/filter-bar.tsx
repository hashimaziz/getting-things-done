/**
 * The filter bar.
 *
 * Filters are chips rather than a form. A form means composing a query by filling in
 * every field whether or not you care about it; chips mean naming the things you
 * actually care about, in words, and being able to remove one by clicking it.
 *
 * A chip that reads "Deadline is before 1 Mar" can be checked at a glance. A chip
 * that reads "deadlineOn lt 2026-03-01" describes the query instead of the intent,
 * which is the same mistake as showing SQL for a filter.
 */

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge, Button, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  FILTER_FIELDS,
  describeCondition,
  type Condition,
  type FilterFieldSpec,
} from '@/lib/item-list/state';

export interface FilterBarProps {
  conditions: Condition[];
  /** Field labels resolved from definitions, so a custom field reads by its own name. */
  fieldLabels?: Record<string, string>;
  onAdd: (condition: Condition) => void;
  onRemove: (field: string) => void;
  onClear: () => void;
}

export function FilterBar({ conditions, fieldLabels, onAdd, onRemove, onClear }: FilterBarProps) {
  const [adding, setAdding] = useState(false);

  const used = new Set(conditions.map((condition) => condition.field));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {conditions.map((condition) => (
        <span
          key={condition.field}
          className="container-chip border bg-muted/60 pl-2 text-foreground"
        >
          {describeCondition(condition, fieldLabels)}
          <button
            type="button"
            aria-label={`Remove filter: ${describeCondition(condition, fieldLabels)}`}
            onClick={() => onRemove(condition.field)}
            className="rounded-full p-0.5 hover:bg-background"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <AddFilter
          available={FILTER_FIELDS.filter((field) => !used.has(field.key))}
          onCancel={() => setAdding(false)}
          onAdd={(condition) => {
            onAdd(condition);
            setAdding(false);
          }}
        />
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus />
          Filter
        </Button>
      )}

      {conditions.length > 0 ? (
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function AddFilter({
  available,
  onCancel,
  onAdd,
}: {
  available: FilterFieldSpec[];
  onCancel: () => void;
  onAdd: (condition: Condition) => void;
}) {
  const [fieldKey, setFieldKey] = useState(available[0]?.key ?? '');
  const field = FILTER_FIELDS.find((entry) => entry.key === fieldKey);

  // Changing the field resets the operator: the operators that make sense for a
  // title are not the ones that make sense for a date, and carrying a stale
  // operator over produces a request the server rejects with no explanation.
  const [operator, setOperator] = useState(field?.operators[0] ?? '');
  const [value, setValue] = useState('');

  const needsValue =
    operator !== 'is_empty' &&
    operator !== 'not_empty' &&
    operator !== 'is_null' &&
    operator !== 'is_not_null';

  const chooseField = (key: string): void => {
    const next = FILTER_FIELDS.find((entry) => entry.key === key);
    setFieldKey(key);
    setOperator(next?.operators[0] ?? '');
    setValue('');
  };

  const submit = (): void => {
    if (!needsValue) {
      onAdd({ field: fieldKey, operator });
      return;
    }

    if (field?.valueKind === 'number') {
      const parsed = Number(value);
      // Refused rather than sent as NaN: `between` takes two numbers, and a list
      // built from one is rejected by the server as a validation error with a much
      // worse message than "both ends are required".
      if (!Number.isFinite(parsed)) {
        return;
      }
      onAdd({ field: fieldKey, operator, value: parsed });
      return;
    }

    if (value.trim() === '') {
      return;
    }

    onAdd({
      field: fieldKey,
      operator,
      value: field?.valueKind === 'list' ? [value.trim()] : value.trim(),
    });
  };

  if (!field) {
    return (
      <Badge variant="secondary">
        Every filterable field is in use
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel adding a filter"
          className="ml-1"
        >
          <X className="size-3" />
        </button>
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-1.5">
      <select
        aria-label="Field"
        value={fieldKey}
        onChange={(event) => chooseField(event.target.value)}
        className="h-8 rounded border border-input bg-background px-2 text-xs"
      >
        {available.map((entry) => (
          <option key={entry.key} value={entry.key}>
            {entry.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Operator"
        value={operator}
        onChange={(event) => setOperator(event.target.value)}
        className="h-8 rounded border border-input bg-background px-2 text-xs"
      >
        {field.operators.map((entry) => (
          <option key={entry} value={entry}>
            {entry.replace(/_/g, ' ')}
          </option>
        ))}
      </select>

      {needsValue ? (
        <Input
          aria-label={`Value for ${field.label}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit();
            }
            if (event.key === 'Escape') {
              onCancel();
            }
          }}
          placeholder={field.valueKind === 'date' ? '2026-03-01' : 'Value'}
          type={field.valueKind === 'number' ? 'number' : 'text'}
          className={cn('h-8 w-36 text-xs')}
        />
      ) : null}

      <Button size="sm" onClick={submit} disabled={needsValue && value.trim() === ''}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
