/**
 * Checklist templates.
 *
 * A checklist is a repeated process rather than a repeated task: travelling, a
 * procedure, a routine. The distinction matters because a checklist used once is never
 * used again, which Allen's method says explicitly, and a screen that treats a template
 * as just another list makes that advice hard to follow.
 *
 * So templates are edited here as a named list of steps, and using one copies its steps
 * onto an item. The copy is deliberate: two items sharing one template would mean editing
 * a past trip's packing list to fix next year's.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
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
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { useDocumentTitle } from '@/lib/document-title';
import { apiFetch } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { todayIso } from '@/lib/calendar';
import type { Item } from '@/lib/types';

interface ChecklistTemplate {
  id: string;
  name: string;
  entries: Array<{ id: string; label: string }>;
  appliesTo: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function ChecklistTemplatesPage() {
  useDocumentTitle('Checklist Templates');

  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<string[]>(['']);
  const [editing, setEditing] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: keys.reference.templates,
    queryFn: async () =>
      (await apiFetch.get<{ templates: ChecklistTemplate[] }>('/checklist-templates')).templates,
  });

  const create = useMutation({
    mutationFn: async () =>
      apiFetch.post<{ template: ChecklistTemplate }>('/checklist-templates', {
        name: name.trim(),
        // Ids are generated here because the server only stores what it is given, and a
        // draft has no id yet.
        entries: entries
          .map((label) => label.trim())
          .filter((label) => label !== '')
          .map((label, index) => ({ id: `step_${index}`, label })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.reference.templates });
      setName('');
      setEntries(['']);
      toast.success('Template saved');
    },
    onError: () => toast.error('That template could not be saved'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiFetch.delete(`/checklist-templates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.reference.templates });
      toast.success('Template deleted');
    },
  });

  const steps = entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
  const problem =
    name.trim() === ''
      ? 'Give the template a name.'
      : steps.length === 0
        ? 'A checklist needs at least one step.'
        : null;

  return (
    <Page>
      <PageHeader
        title="Checklist Templates"
        description="Repeated processes rather than repeated tasks. A template used once is never used again."
      />

      <Card>
        <CardHeader>
          <CardTitle>New template</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            aria-label="Template name"
            placeholder="Pack for a week away"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <div className="flex flex-col gap-1">
            {entries.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Step ${index + 1}`}
                  placeholder="A step"
                  value={entry}
                  onChange={(event) =>
                    setEntries(
                      entries.map((value, i) => (i === index ? event.target.value : value)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => setEntries(entries.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setEntries([...entries, ''])}
            >
              <Plus />
              Add a step
            </Button>
          </div>

          <FieldError>{problem}</FieldError>

          <Button
            size="sm"
            className="self-start"
            disabled={problem !== null}
            onClick={() => create.mutate()}
          >
            Save template
          </Button>
        </CardContent>
      </Card>

      {(templates.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {(templates.data ?? []).map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{template.name}</CardTitle>
                  <Badge variant="secondary">{template.entries.length} steps</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {editing === template.id ? (
                  <UseTemplate template={template} onDone={() => setEditing(null)} />
                ) : (
                  <>
                    <ol className="flex list-inside list-decimal flex-col gap-0.5 text-sm text-muted-foreground">
                      {template.entries.map((entry) => (
                        <li key={entry.id}>{entry.label}</li>
                      ))}
                    </ol>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(template.id)}>
                        Use this checklist
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(template.id)}
                        aria-label={`Delete ${template.name}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

/**
 * Turns a template into a real item.
 *
 * The steps are *copied* onto the item, not referenced. Two items sharing one template
 * would mean editing last year's packing list to fix next year's, which is how a
 * template turns into a liability.
 */
function UseTemplate({ template, onDone }: { template: ChecklistTemplate; onDone: () => void }) {
  const [categoryId, setCategoryId] = useState('');

  const categories = useQuery({
    queryKey: keys.categories,
    queryFn: async () =>
      (await apiFetch.get<{ categories: Array<{ id: string; name: string }> }>('/categories'))
        .categories,
  });

  const create = useMutation({
    mutationFn: async () => {
      const first = categoryId !== '' ? categoryId : (categories.data ?? [])[0]?.id;
      if (first === undefined) {
        throw new Error('Create a category first');
      }

      const response = await apiFetch.post<{ item: Item }>('/items', {
        categoryId: first,
        title: template.name,
        container: 'next_action',
        data: {
          checklist: template.entries.map((entry) => ({
            id: entry.id,
            label: entry.label,
            done: false,
          })),
        },
      });

      return response.item;
    },
    onSuccess: () => {
      toast.success(`"${template.name}" created with its steps copied in`);
      onDone();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'It could not be created'),
  });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        The steps are copied onto a new item, so editing this template later never changes an item
        that already exists.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(categories.data ?? []).length > 1 ? (
          <select
            aria-label="Category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="h-8 rounded border border-input bg-background px-2 text-xs"
          >
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        ) : null}

        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
          Create the item
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <span className="text-[0.6875rem] text-muted-foreground">Today is {todayIso()}.</span>
      </div>
    </div>
  );
}
