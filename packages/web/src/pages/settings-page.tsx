/**
 * Settings.
 *
 * Four sections: categories, fields, reference data, and the application itself.
 * Everything a person configures once and then lives with.
 *
 * Two things this screen gets right that a thinner version did not:
 *
 * - Creating a choice field asks for its options. Without that the server fills in
 *   "Option 1" and "Option 2", and the field is useless in a way nothing on the screen
 *   explains.
 * - Every mutation reports failure. A create button that fails silently is worse than
 *   no button, because the person believes it worked and then finds out later, with
 *   data attached.
 *
 * Everything here is also reversible: categories and fields can be renamed or deleted,
 * because a configuration screen where the only verb is "add" fills up with mistakes.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
  Select,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { DangerZone } from '@/components/settings/danger-zone';
import { apiFetch, ApiError } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { useCategories } from '@/lib/hooks';
import { useDocumentTitle } from '@/lib/document-title';
import {
  FIELD_TYPES,
  buildFieldBody,
  describeField,
  needsChoices,
  validateField,
} from '@/lib/settings';
import type { FieldDefinition } from '@/lib/types';

const tabs = [
  ['/settings/categories', 'Categories'],
  ['/settings/fields', 'Fields'],
  ['/settings/reference', 'Reference Data'],
  ['/settings', 'Application'],
] as const;

const heading = (value: string): string =>
  value.length === 0 ? value : (value[0] as string).toUpperCase() + value.slice(1);

/** Every failure here is worth a sentence, and none of them is worth a stack trace. */
function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'That did not work.';
}

export function SettingsPage() {
  const path = useLocation().pathname;
  const navigate = useNavigate();
  const section = path.split('/')[2] ?? 'application';
  useDocumentTitle(section === 'application' ? 'Settings' : heading(section));

  return (
    <Page>
      <PageHeader
        title={section === 'application' ? 'Settings' : heading(section)}
        description="Configuration that belongs to this GTD system."
      />

      <nav className="flex flex-wrap gap-1" aria-label="Settings sections">
        {tabs.map(([to, label]) => (
          <Button
            key={to}
            size="sm"
            variant={path === to ? 'secondary' : 'ghost'}
            onClick={() => navigate(to)}
          >
            {label}
          </Button>
        ))}
      </nav>

      {section === 'categories' ? (
        <Categories />
      ) : section === 'fields' ? (
        <Fields />
      ) : section === 'reference' ? (
        <ReferenceData />
      ) : (
        <>
          <ApplicationSettings />
          {/*
            Last on the page, under everything else. Not hidden: a destructive action
            nobody can find is as useless as one everybody trips over, and this is the
            reason somebody might come looking in the first place.
          */}
          <DangerZone />
        </>
      )}
    </Page>
  );
}

/* ---------------------------------------------------------------- categories */

function Categories() {
  const client = useQueryClient();
  const categories = useCategories();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiFetch.post('/categories', { name, ...(description === '' ? {} : { description }) }),
    onSuccess: () => {
      setName('');
      setDescription('');
      void client.invalidateQueries({ queryKey: keys.categories });
      toast.success('Category created');
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const patch = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Record<string, unknown> }) =>
      apiFetch.patch(`/categories/${id}`, changes),
    onSuccess: () => {
      setRenaming(null);
      void client.invalidateQueries({ queryKey: keys.categories });
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch.delete(`/categories/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.categories });
      toast.success('Category deleted');
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <p className="text-xs text-muted-foreground">
          Categories define the kinds of work this system holds. Everything you capture needs one.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Input
            aria-label="New category name"
            placeholder="Work, Personal…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label="New category description"
            placeholder="What belongs in it?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <FieldError>{problem}</FieldError>
          {/*
            Enabled rather than disabled when the name is empty. A greyed-out button
            with no explanation leaves someone wondering whether the field is wrong or
            they are; pressing it and being told is faster than either.
          */}
          <Button
            className="self-start"
            disabled={create.isPending}
            onClick={() => {
              if (name.trim() === '') {
                setProblem('A category needs a name.');
                return;
              }
              setProblem(null);
              create.mutate();
            }}
          >
            Add category
          </Button>
        </div>

        <ul className="divide-y">
          {(categories.data ?? []).map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              {renaming === category.id ? (
                <RenameRow
                  initial={category.name}
                  onCancel={() => setRenaming(null)}
                  onSave={(value) => patch.mutate({ id: category.id, changes: { name: value } })}
                />
              ) : (
                <>
                  <span className="min-w-0">
                    {category.name}
                    {category.isArchived ? (
                      <Badge className="ml-2" variant="secondary">
                        archived
                      </Badge>
                    ) : null}
                    <span className="ml-2 text-xs text-muted-foreground">{category.key}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(category.id)}>
                      Rename
                    </Button>
                    {category.isArchived ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          patch.mutate({ id: category.id, changes: { isArchived: false } })
                        }
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          patch.mutate({ id: category.id, changes: { isArchived: true } })
                        }
                      >
                        Archive
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${category.name}`}
                      onClick={() => remove.mutate(category.id)}
                    >
                      Delete
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RenameRow({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <span className="flex w-full items-center gap-2">
      <Input
        aria-label={`Rename ${initial}`}
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave(value);
          if (event.key === 'Escape') onCancel();
        }}
      />
      <Button size="sm" onClick={() => onSave(value)} disabled={value.trim() === ''}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}

/* -------------------------------------------------------------------- fields */

function Fields() {
  const client = useQueryClient();
  const categories = useCategories();

  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [choices, setChoices] = useState('High, Medium, Low');
  const [categoryId, setCategoryId] = useState('');
  const [global, setGlobal] = useState(false);
  const [showInTable, setShowInTable] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  const fields = useQuery({
    queryKey: keys.fields.list(),
    queryFn: async () => (await apiFetch.get<{ fields: FieldDefinition[] }>('/fields')).fields,
  });

  const create = useMutation({
    mutationFn: () => {
      const body = buildFieldBody({
        label,
        type,
        choices,
        categoryId,
        showInTable,
        filterable: true,
      });
      // A global field has no category to post under, so it is created somewhere and
      // then moved. Posting to a category and scoping to null in one step would be a
      // server change for something that happens once during setup.
      return global
        ? apiFetch
            .post<{ field: FieldDefinition }>(`/categories/${categoryId}/fields`, body)
            .then((created) => apiFetch.patch(`/fields/${created.field.id}`, { categoryId: null }))
        : apiFetch.post(`/categories/${categoryId}/fields`, body);
    },
    onSuccess: () => {
      setLabel('');
      setProblem(null);
      void client.invalidateQueries({ queryKey: keys.fields.all });
      toast.success('Field created');
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const update = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Record<string, unknown> }) =>
      apiFetch.patch(`/fields/${id}`, changes),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.fields.all }),
    onError: (error) => toast.error(failureMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch.delete(`/fields/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.fields.all });
      toast.success('Field deleted');
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const submit = (): void => {
    const found = validateField({
      label,
      type,
      choices,
      categoryId,
      allowGlobal: global,
    });
    setProblem(found);
    if (found === null) {
      create.mutate();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Field definitions</CardTitle>
        <p className="text-xs text-muted-foreground">
          Add fields once; item editors, list columns and filters discover them automatically.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="Field label"
            placeholder="Energy"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Select
            aria-label="Field type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {FIELD_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>

        {needsChoices(type) ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="field-choices">Options, highest first</Label>
            <Input
              id="field-choices"
              value={choices}
              onChange={(event) => setChoices(event.target.value)}
              placeholder="High, Medium, Low"
            />
            <p className="text-xs text-muted-foreground">
              Comma separated, and the order is the order. For a priority field the first option is
              the highest — sorting them alphabetically would quietly invert the scale.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Select
            aria-label="Field category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Choose category</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>

          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={global}
              onChange={(event) => setGlobal(event.target.checked)}
            />
            Applies to every category
          </label>

          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={showInTable}
              onChange={(event) => setShowInTable(event.target.checked)}
            />
            Show in list columns
          </label>
        </div>

        <FieldError>{problem}</FieldError>

        <Button className="self-start" disabled={create.isPending} onClick={submit}>
          Add field
        </Button>

        <ul className="divide-y">
          {(fields.data ?? []).map((field) => (
            <li key={field.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="truncate">{field.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{describeField(field)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="text-xs text-muted-foreground">
                  {field.categoryId === null
                    ? 'All categories'
                    : (categories.data ?? []).find((category) => category.id === field.categoryId)
                        ?.name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update.mutate({ id: field.id, changes: { showInTable: !field.showInTable } })
                  }
                >
                  {field.showInTable ? 'Hide from lists' : 'Show in lists'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${field.label}`}
                  onClick={() => remove.mutate(field.id)}
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------ reference data */

const REFERENCE_KINDS = [
  { kind: 'projects', label: 'Projects', path: '/projects' },
  { kind: 'people', label: 'People', path: '/people' },
  { kind: 'contexts', label: 'Contexts', path: '/contexts' },
] as const;

function ReferenceData() {
  const client = useQueryClient();
  const [kind, setKind] = useState<string>(REFERENCE_KINDS[0].kind);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const list = useQuery({
    queryKey: [...keys.reference.all, kind],
    queryFn: async () =>
      (await apiFetch.get<{ [key: string]: Array<{ id: string; name: string }> }>(`/${kind}`))[
        kind
      ] ?? [],
  });

  const create = useMutation({
    mutationFn: () => apiFetch.post(`/${kind}`, { name }),
    onSuccess: () => {
      setName('');
      void client.invalidateQueries({ queryKey: [...keys.reference.all, kind] });
      toast.success('Added');
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const update = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      apiFetch.patch(`/${kind}/${id}`, { name: value }),
    onSuccess: () => {
      setRenaming(null);
      void client.invalidateQueries({ queryKey: [...keys.reference.all, kind] });
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch.delete(`/${kind}/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...keys.reference.all, kind] });
      toast.success('Deleted');
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reference data</CardTitle>
        <p className="text-xs text-muted-foreground">
          The things things refer to: outcomes, people, and where you can do something.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Reference kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {REFERENCE_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </Select>

          <Input
            aria-label="New name"
            placeholder="A name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            size="sm"
            disabled={name.trim() === '' || create.isPending}
            onClick={() => create.mutate()}
          >
            Add
          </Button>
        </div>

        <ul className="divide-y">
          {(list.data ?? []).map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              {renaming === entry.id ? (
                <RenameRow
                  initial={entry.name}
                  onCancel={() => setRenaming(null)}
                  onSave={(value) => update.mutate({ id: entry.id, value })}
                />
              ) : (
                <>
                  <span className="truncate">{entry.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(entry.id)}>
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${entry.name}`}
                      onClick={() => remove.mutate(entry.id)}
                    >
                      Delete
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- application */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ApplicationSettings() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: keys.settings,
    queryFn: async () =>
      (await apiFetch.get<{ settings: Array<{ key: string; value: unknown }> }>('/settings'))
        .settings,
  });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string | number }) =>
      apiFetch.put(`/settings/${key}`, { value }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.settings });
      toast.success('Saved');
    },
    // A setting that appears to save and does not is the worst outcome here: the next
    // recurring series is anchored in the old zone and nobody is told.
    onError: (error) => toast.error(failureMessage(error)),
  });

  const current = (key: string, fallback: string): string => {
    const value = settings.data?.find((entry) => entry.key === key)?.value;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
  };

  const timezone = current('app.timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  const weekStartsOn = current('app.weekStartsOn', '1');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application settings</CardTitle>
        <p className="text-xs text-muted-foreground">
          The timezone matters most: recurring series expand in it, so a weekly item keeps its local
          time across a daylight saving change.
        </p>
      </CardHeader>
      <CardContent className="flex max-w-md flex-col gap-3">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          defaultValue={timezone}
          key={timezone}
          onBlur={(event) => save.mutate({ key: 'app.timezone', value: event.target.value })}
        />

        <Label htmlFor="week-start">Week starts on</Label>
        <Select
          id="week-start"
          defaultValue={weekStartsOn}
          onChange={(event) =>
            save.mutate({ key: 'app.weekStartsOn', value: Number(event.target.value) })
          }
        >
          {WEEKDAYS.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </Select>
      </CardContent>
    </Card>
  );
}
