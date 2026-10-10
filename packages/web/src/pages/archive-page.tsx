/**
 * The completed archive.
 *
 * A place to look at what got done, and — more usefully — a way to bring something
 * back. Two mistakes this screen could easily make, and does not:
 *
 * - It shows the *total*, and pages through the results. Fetching a hundred rows and
 *   reporting a thousand in the heading is how a browser ends up lying about how much
 *   you finished, which is the one number most people would want to trust.
 * - Facets are filtered with the operator the field's type actually accepts. `multiselect`
 *   and `people` are stored as JSON arrays and counted by walking them, so their filter
 *   has to walk them too; sending `equals` is an operator those types do not accept and
 *   the request simply fails.
 *
 * Sorting is real here rather than decorative. The archive is mostly browsed by when,
 * so the default is most-recently-completed, and every column sorts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, CardContent, EmptyState, Input, Select, Skeleton } from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { ItemTable } from '@/components/items/item-table';
import { useCategories, useFieldDefinitions, useProjects } from '@/lib/hooks';
import { apiFetch } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { formatDate } from '@/lib/item-list/format';
import { todayIso } from '@/lib/calendar';
import { useDocumentTitle } from '@/lib/document-title';
import {
  DEFAULT_ARCHIVE_SORT,
  applyArchiveSort,
  buildArchiveFilter,
  isSelectableFacet,
  type ArchiveFacet,
} from '@/lib/archive';
import { defaultColumns, type ColumnSpec } from '@/lib/item-list/columns';
import type { FilterNode, Item, SortRule } from '@/lib/types';

const PAGE_SIZE = 50;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const categories = useCategories();
  const definitions = useFieldDefinitions();
  const projects = useProjects();

  // Everything in the URL, for the same reason the container lists keep their state
  // there: an archive view someone found is an archive view they want again.
  const search = searchParams.get('search') ?? '';
  const categoryId = searchParams.get('categoryId') ?? '';
  const facetField = searchParams.get('facet');
  const facetValue = searchParams.get('facetValue');
  const page = Number(searchParams.get('page') ?? '1');

  const [searchInput, setSearchInput] = useState(search);
  const [lastUrlSearch, setLastUrlSearch] = useState(search);

  /** A blank or null value removes the parameter, so URLs stay free of empty keys. */
  const update = useCallback(
    (changes: Record<string, string | number | null>): void => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(changes)) {
        const text = value === null ? '' : String(value);
        if (text === '') {
          next.delete(key);
        } else {
          next.set(key, text);
        }
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  /*
   * The search box follows the URL when the URL changes from somewhere else — the back
   * button, or a link that arrives with a search already in it.
   *
   * Adjusted during render rather than in an effect: an effect would leave a frame
   * where the box disagrees with the results underneath it, and would also mean the
   * results query has already fired for a search the user has changed away from.
   * Comparing against the last URL value seen means the update this page itself made
   * is not mistaken for an external change and undone mid-typing.
   */
  if (search !== lastUrlSearch) {
    setLastUrlSearch(search);
    setSearchInput(search);
  }

  /*
   * Debounced, because every keystroke would otherwise be a request. The URL is updated
   * once typing pauses, so the address bar ends up describing what is shown rather than
   * what was last typed.
   */
  useEffect(() => {
    if (searchInput === search) {
      return;
    }
    const timer = setTimeout(() => {
      update({ search: searchInput, page: 1 });
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput, search, update]);

  const facets = useQuery({
    queryKey: ['archive', 'facets', categoryId],
    queryFn: async () =>
      (
        await apiFetch.get<{ facets: ArchiveFacet[] }>('/archive/facets', {
          ...(categoryId === '' ? {} : { categoryId }),
        })
      ).facets,
  });

  const facet = useMemo(
    () => (facetField === null ? null : { field: facetField, value: facetValue ?? '' }),
    [facetField, facetValue],
  );

  const filter = useMemo(
    () => buildArchiveFilter({ search, categoryId, facet, facets: facets.data ?? [] }),
    [search, categoryId, facet, facets.data],
  );

  const sort = useMemo<SortRule[]>(() => {
    const fromUrl = searchParams.get('sort');
    if (fromUrl === null) {
      return DEFAULT_ARCHIVE_SORT;
    }
    try {
      const parsed: unknown = JSON.parse(fromUrl);
      return Array.isArray(parsed) && parsed.length > 0
        ? (parsed as SortRule[])
        : DEFAULT_ARCHIVE_SORT;
    } catch {
      // A hand-edited URL. Fall back rather than refuse to render the page.
      return DEFAULT_ARCHIVE_SORT;
    }
  }, [searchParams]);

  const safePage = Number.isInteger(page) && page > 0 ? page : 1;

  const archive = useQuery({
    queryKey: ['archive', 'items', { search, categoryId, facet, sort, page: safePage }],
    queryFn: async () =>
      apiFetch.get<ArchiveResponse>('/archive', {
        ...(filter === null ? {} : { filter: JSON.stringify(filter) }),
        sort: JSON.stringify(sort),
        limit: PAGE_SIZE,
        offset: (safePage - 1) * PAGE_SIZE,
        ...(categoryId === '' ? {} : { categoryId }),
      }),
  });

  const daily = useQuery({
    queryKey: keys.archive.daily(30),
    queryFn: async () => (await apiFetch.get<DailyResponse>('/archive/daily', { days: 30 })).days,
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

  const columns = useMemo(
    () => defaultColumns('archive', definitions.data ?? []) as ColumnSpec[],
    [definitions.data],
  );

  const resultTotal = archive.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(resultTotal / PAGE_SIZE));
  const maxDaily = Math.max(1, ...(daily.data ?? []).map((day) => day.count));

  return (
    <Page>
      <PageHeader
        title="Archive"
        description="Completed work, newest first. Anything here can be reopened."
        actions={
          hasNarrowing(search, categoryId, facet) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSearchParams(new URLSearchParams())}
            >
              Clear filters
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search completed items"
          className="max-w-sm"
          placeholder="Search completed items"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />

        <Select
          aria-label="Category"
          className="w-44"
          value={categoryId}
          onChange={(event) => update({ categoryId: event.target.value, page: null })}
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>

        {facet !== null && facetField !== null ? (
          <span className="container-chip border bg-muted/60 pl-2">
            {fieldLabels[facetField] ?? facetField}: {facetValue}
          </span>
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
            ) : archive.isError ? (
              <div className="p-4">
                <EmptyState
                  title="The archive could not be loaded"
                  action={<Button onClick={() => void archive.refetch()}>Try again</Button>}
                />
              </div>
            ) : (archive.data?.items.length ?? 0) > 0 ? (
              <div className="overflow-x-auto">
                <ItemTable
                  items={archive.data?.items ?? []}
                  columns={columns}
                  definitions={definitions.data ?? []}
                  // The viewer's own calendar day, never the UTC one: a completion shown
                  // a day early is a lie about when something finished.
                  today={todayIso()}
                  sort={sort}
                  labels={labels}
                  onSort={(field) => {
                    update({
                      sort: JSON.stringify(applyArchiveSort(sort, field, DEFAULT_ARCHIVE_SORT)),
                    });
                  }}
                  onOpen={(item) => navigate(`/item/${item.id}`)}
                />
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  title={
                    hasNarrowing(search, categoryId, facet)
                      ? 'Nothing matches these filters'
                      : 'Nothing has been completed yet'
                  }
                  description={
                    hasNarrowing(search, categoryId, facet)
                      ? 'Completed work is here; nothing matches what you have asked for.'
                      : 'Anything you complete is kept here, and can be brought back.'
                  }
                  action={
                    hasNarrowing(search, categoryId, facet) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSearchParams(new URLSearchParams())}
                      >
                        Clear filters
                      </Button>
                    ) : (
                      /*
                       * Not "capture something". Someone opening the archive has just
                       * finished work and is looking for what they finished; sending
                       * them to capture more is answering a question they are not asking.
                       */
                      <Button asChild size="sm" variant="outline">
                        <Link to="/list/next_action">See what is next</Link>
                      </Button>
                    )
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-1 p-3">
              <p className="text-xs font-medium">Last 30 days</p>
              {(daily.data ?? []).slice(-14).map((day) => (
                <div key={day.date} className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-muted-foreground">{formatDate(day.date)}</span>
                  <span
                    aria-hidden
                    className="h-3 rounded-sm bg-primary"
                    style={{ width: `${Math.max(4, (day.count / maxDaily) * 100)}%` }}
                  />
                  <span className="tabular-nums">{day.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2 p-3">
              <p className="text-xs font-medium">Filter by field</p>
              {(facets.data ?? []).filter((entry) => entry.values.length > 0).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No configured fields have completed values yet.
                </p>
              ) : (
                (facets.data ?? [])
                  .filter((entry) => entry.values.length > 0)
                  .map((entry) => (
                    <div key={entry.field}>
                      <p className="mb-1 text-xs font-medium">{entry.label}</p>
                      {isSelectableFacet(entry) ? (
                        <div className="flex flex-wrap gap-1">
                          {entry.values.map((value) => (
                            <Button
                              key={value.value}
                              size="sm"
                              variant={
                                facet?.field === entry.field && facet.value === value.value
                                  ? 'default'
                                  : 'outline'
                              }
                              aria-pressed={
                                facet?.field === entry.field && facet.value === value.value
                              }
                              onClick={() =>
                                update({
                                  facet:
                                    facet?.field === entry.field && facet.value === value.value
                                      ? null
                                      : entry.field,
                                  facetValue:
                                    facet?.field === entry.field && facet.value === value.value
                                      ? null
                                      : value.value,
                                  page: null,
                                })
                              }
                            >
                              {value.label} ({value.count})
                            </Button>
                          ))}
                        </div>
                      ) : (
                        /*
                         * A number, a duration, a date. Their facet values are not a
                         * closed list, so presenting them as buttons would offer "equals
                         * 12" when the question is really "what is in this column".
                         */
                        <p className="text-[0.6875rem] text-muted-foreground">
                          Filter this by typing in the search box instead.
                        </p>
                      )}
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={safePage <= 1}
            onClick={() => update({ page: String(safePage - 1) })}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {safePage} of {pageCount} · {resultTotal} completed
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={safePage >= pageCount}
            onClick={() => update({ page: String(safePage + 1) })}
          >
            Next
          </Button>
        </nav>
      ) : (
        <p className="text-xs text-muted-foreground">{resultTotal} completed in total.</p>
      )}
    </Page>
  );
}

function hasNarrowing(
  search: string,
  categoryId: string,
  facet: { field: string; value: string } | null,
): boolean {
  return search.trim() !== '' || categoryId !== '' || facet !== null;
}

export type { FilterNode };
