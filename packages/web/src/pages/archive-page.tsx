import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { RotateCcw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Skeleton,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { ItemTable } from '@/components/items/item-table';
import { useCategories, useFieldDefinitions, useProjects } from '@/lib/hooks';
import { apiFetch } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { formatDate } from '@/lib/item-list/format';
import { useDocumentTitle } from '@/lib/document-title';
import type { FieldDefinition, Item } from '@/lib/types';
import { defaultColumns, type ColumnSpec } from '@/lib/item-list/columns';

interface Facet {
  field: string;
  label: string;
  type: string;
  isOpen: boolean;
  values: Array<{ value: string; label: string; count: number }>;
}
interface ArchiveResponse {
  items: Item[];
  total: number;
}
interface DailyResponse {
  from: string;
  to: string;
  days: Array<{ date: string; count: number }>;
}

export function ArchivePage() {
  useDocumentTitle('Archive');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [facet, setFacet] = useState<{ field: string; value: string } | null>(null);
  const categories = useCategories();
  const definitions = useFieldDefinitions();
  const projects = useProjects();

  const filter = useMemo(() => {
    const conditions = [] as Array<{
      kind: 'condition';
      field: string;
      operator: 'contains' | 'equals';
      value: string;
    }>;
    if (search.trim() !== '')
      conditions.push({
        kind: 'condition',
        field: 'title',
        operator: 'contains',
        value: search.trim(),
      });
    if (facet)
      conditions.push({
        kind: 'condition',
        field: facet.field,
        operator: 'equals',
        value: facet.value,
      });
    return conditions.length === 0
      ? undefined
      : JSON.stringify(
          conditions.length === 1
            ? conditions[0]
            : { kind: 'group', conjunction: 'and', children: conditions },
        );
  }, [search, facet]);

  const archive = useQuery({
    queryKey: keys.archive.search({
      search,
      categoryId,
      filter: filter ? JSON.parse(filter) : null,
    }),
    queryFn: () =>
      apiFetch.get<ArchiveResponse>('/archive', {
        categoryId: categoryId || undefined,
        filter,
        limit: 100,
      }),
  });
  const facets = useQuery({
    queryKey: [...keys.archive.facets, categoryId],
    queryFn: async () =>
      (
        await apiFetch.get<{ facets: Facet[] }>('/archive/facets', {
          categoryId: categoryId || undefined,
        })
      ).facets,
  });
  const daily = useQuery({
    queryKey: keys.archive.daily(30),
    queryFn: () => apiFetch.get<DailyResponse>('/archive/daily', { days: 30 }),
  });

  const fieldLabels = useMemo(
    () => Object.fromEntries((definitions.data ?? []).map((field) => [field.key, field.label])),
    [definitions.data],
  );
  const labels = useMemo(
    () => ({
      projects: Object.fromEntries(
        (projects.data ?? []).map((project) => [project.id, project.name]),
      ),
    }),
    [projects.data],
  );
  const columns = archiveColumns(definitions.data ?? []);
  const maxDaily = Math.max(1, ...(daily.data?.days ?? []).map((day) => day.count));

  return (
    <Page>
      <PageHeader
        title="Archive"
        description={`${archive.data?.total ?? 0} completed items`}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearch('');
              setFacet(null);
              setCategoryId('');
            }}
          >
            Clear filters
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search completed items"
          className="max-w-sm"
          placeholder="Search completed items"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Category"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {facet ? (
          <Badge variant="secondary">
            {fieldLabels[facet.field] ?? facet.field}: {facet.value}
          </Badge>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardContent className="p-0">
            {archive.isPending ? (
              <div className="flex flex-col gap-2 p-4">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-7 w-full" />
                ))}
              </div>
            ) : archive.data?.items.length ? (
              <div className="overflow-x-auto">
                <ItemTable
                  items={archive.data.items}
                  columns={columns}
                  definitions={definitions.data ?? []}
                  today={new Date().toISOString().slice(0, 10)}
                  sort={[{ field: 'completedAt', direction: 'desc' }]}
                  labels={labels}
                  onSort={() => undefined}
                  onOpen={(item) => navigate(`/item/${item.id}`)}
                />
              </div>
            ) : (
              <EmptyState
                title="Nothing filed yet"
                description="Completed work stays here so you can review what got done."
                action={
                  <Button size="sm" onClick={() => navigate('/capture')}>
                    Capture something
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Last 30 days</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {(daily.data?.days ?? []).slice(-14).map((day) => (
                <div key={day.date} className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-muted-foreground">{formatDate(day.date)}</span>
                  <span
                    className="h-3 rounded-sm bg-primary"
                    style={{ width: `${Math.max(4, (day.count / maxDaily) * 100)}%` }}
                  />
                  <span className="tabular-nums">{day.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Filter by field</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {(facets.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No configured choice fields have completed values.
                </p>
              ) : (
                (facets.data ?? []).map((entry) => (
                  <div key={entry.field}>
                    <p className="mb-1 text-xs font-medium">{entry.label}</p>
                    <div className="flex flex-wrap gap-1">
                      {entry.values.map((value) => (
                        <Button
                          key={value.value}
                          size="sm"
                          variant="outline"
                          onClick={() => setFacet({ field: entry.field, value: value.value })}
                        >
                          {value.label} ({value.count})
                        </Button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Link className="text-xs text-muted-foreground hover:underline" to="/review">
            <RotateCcw className="mr-1 inline size-3" />
            Return to weekly review
          </Link>
        </aside>
      </div>
    </Page>
  );
}

function archiveColumns(definitions: FieldDefinition[]): ColumnSpec[] {
  return defaultColumns('archive', definitions);
}
