import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { apiFetch } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { useCategories } from '@/lib/hooks';
import { useDocumentTitle } from '@/lib/document-title';

const tabs = [
  ['/settings/categories', 'Categories'],
  ['/settings/fields', 'Fields'],
  ['/settings/reference', 'Reference Data'],
  ['/settings', 'Application'],
] as const;
const referenceKeys = {
  projects: keys.reference.projects,
  people: keys.reference.people,
  contexts: keys.reference.contexts,
} as const;
const heading = (value: string): string =>
  value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);

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
        <ApplicationSettings />
      )}
    </Page>
  );
}

function Categories() {
  const client = useQueryClient();
  const categories = useCategories();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => apiFetch.post('/categories', { name }),
    onSuccess: () => {
      setName('');
      void client.invalidateQueries({ queryKey: keys.categories });
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => apiFetch.patch(`/categories/${id}`, { isArchived: true }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.categories }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <p className="text-xs text-muted-foreground">
          Categories define the kinds of work this system holds.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            aria-label="New category"
            placeholder="Work, Personal…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Add category
          </Button>
        </div>
        <ul className="divide-y">
          {(categories.data ?? []).map((category) => (
            <li key={category.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {category.name}
                <span className="ml-2 text-xs text-muted-foreground">{category.key}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => archive.mutate(category.id)}>
                Archive
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Fields() {
  const client = useQueryClient();
  const categories = useCategories();
  const fields = useQuery({
    queryKey: keys.fields.list(),
    queryFn: async () =>
      (
        await apiFetch.get<{
          fields: Array<{
            id: string;
            label: string;
            key: string;
            type: string;
            categoryId: string | null;
          }>;
        }>('/fields')
      ).fields,
  });
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [categoryId, setCategoryId] = useState('');
  const create = useMutation({
    mutationFn: () => apiFetch.post(`/categories/${categoryId}/fields`, { label, type }),
    onSuccess: () => {
      setLabel('');
      void client.invalidateQueries({ queryKey: keys.fields.all });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Field definitions</CardTitle>
        <p className="text-xs text-muted-foreground">
          Add fields once; item editors and lists discover them automatically.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          {' '}
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
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Yes / no</option>
            <option value="date">Date</option>
            <option value="select">Choice</option>
            <option value="checklist">Checklist</option>
          </Select>
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
        </div>
        <Button
          className="self-start"
          disabled={!label.trim() || !categoryId || create.isPending}
          onClick={() => create.mutate()}
        >
          Add field
        </Button>
        <ul className="divide-y">
          {(fields.data ?? []).map((field) => (
            <li key={field.id} className="flex justify-between py-2 text-sm">
              <span>
                {field.label}
                <span className="ml-2 text-xs text-muted-foreground">{field.type}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {field.categoryId
                  ? categories.data?.find((category) => category.id === field.categoryId)?.name
                  : 'All categories'}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ReferenceData() {
  const [tab, setTab] = useState<'projects' | 'people' | 'contexts'>('projects');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reference data</CardTitle>
        <div className="flex gap-1">
          {(['projects', 'people', 'contexts'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={tab === value ? 'secondary' : 'ghost'}
              onClick={() => setTab(value)}
            >
              {heading(value)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {tab === 'projects' ? <Projects /> : tab === 'people' ? <People /> : <Contexts />}
      </CardContent>
    </Card>
  );
}

function Projects() {
  return <ReferenceForm kind="projects" label="Project" fields={['name', 'outcome']} />;
}
function People() {
  return <ReferenceForm kind="people" label="Person" fields={['name', 'email']} />;
}
function Contexts() {
  return <ReferenceForm kind="contexts" label="Context" fields={['name']} />;
}

function ReferenceForm({
  kind,
  label,
  fields,
}: {
  kind: 'projects' | 'people' | 'contexts';
  label: string;
  fields: string[];
}) {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: referenceKeys[kind],
    queryFn: async () => {
      const response = await apiFetch.get<{ [key: string]: Array<{ id: string; name: string }> }>(
        `/${kind}`,
      );
      return response[kind] ?? [];
    },
  });
  const create = useMutation({
    mutationFn: () => apiFetch.post(`/${kind}`, values),
    onSuccess: () => {
      setValues({});
      void client.invalidateQueries({ queryKey: referenceKeys[kind] });
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field} className="flex flex-col gap-1">
            <Label htmlFor={`${kind}-${field}`}>{heading(field)}</Label>
            {field === 'outcome' ? (
              <Textarea
                id={`${kind}-${field}`}
                value={values[field] ?? ''}
                onChange={(event) => setValues({ ...values, [field]: event.target.value })}
              />
            ) : (
              <Input
                id={`${kind}-${field}`}
                value={values[field] ?? ''}
                onChange={(event) => setValues({ ...values, [field]: event.target.value })}
              />
            )}
          </div>
        ))}
      </div>
      <Button
        className="self-start"
        disabled={!values.name?.trim() || create.isPending}
        onClick={() => create.mutate()}
      >
        Add {label.toLowerCase()}
      </Button>
      <ul className="divide-y">
        {(list.data ?? []).map((entry) => (
          <li key={entry.id} className="py-2 text-sm">
            {entry.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApplicationSettings() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: keys.settings,
    queryFn: async () =>
      (await apiFetch.get<{ settings: Array<{ key: string; value: unknown }> }>('/settings'))
        .settings,
  });
  const current = (key: string, fallback: string) => {
    const value = settings.data?.find((entry) => entry.key === key)?.value;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
  };
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string | number }) =>
      apiFetch.put(`/settings/${key}`, { value }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
  const timezone = current('app.timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  const weekStartsOn = current('app.weekStartsOn', '0');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Application settings</CardTitle>
      </CardHeader>
      <CardContent className="flex max-w-md flex-col gap-3">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          defaultValue={timezone}
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
          <option value="0">Sunday</option>
          <option value="1">Monday</option>
          <option value="6">Saturday</option>
        </Select>
        <p className="text-xs text-muted-foreground">
          These settings affect calendar arithmetic and recurrence expansion.
        </p>
      </CardContent>
    </Card>
  );
}
