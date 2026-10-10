/**
 * A container list.
 *
 * The workhorse screen, and deliberately thin: the URL holds the view state, the
 * server does the querying, and this file connects them and renders the result.
 *
 * Two decisions worth stating. Filtering and sorting happen on the server rather than
 * in the browser, because a list that filters a page of 50 rows client-side is showing
 * a wrong total and a wrong page count — the list would claim there are three pages
 * when there are none. And the view state is in the URL, so a filtered list is a link
 * that can be bookmarked and returned to.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { FilterBar } from '@/components/items/filter-bar';
import { ItemTable } from '@/components/items/item-table';
import { useFieldDefinitions, useItems, useProjects } from '@/lib/hooks';
import { useDocumentTitle } from '@/lib/document-title';
import { containerLabel } from '@/lib/navigation';
import { todayIso } from '@/lib/calendar';
import { columnStore, useColumns, viewKey } from '@/lib/item-list/column-store';
import {
  applySort,
  buildFilterNode,
  clampPage,
  clearConditions,
  describeCondition,
  pageCount,
  parseViewState,
  removeCondition,
  addCondition as addConditionToState,
  serialiseViewState,
  type Condition,
  type ListViewState,
} from '@/lib/item-list/state';

/** Containers a list can be pointed at. Anything else is a typo and gets the 404. */
const CONTAINERS = [
  'inbox',
  'next_action',
  'calendar',
  'waiting',
  'someday',
  'reference',
  'trash',
] as const;

export function ListPage() {
  const { container = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const valid = (CONTAINERS as readonly string[]).includes(container);
  const label = containerLabel(container);
  useDocumentTitle(label);

  const { config, loaded: columnsLoaded, columnsFor } = useColumns();
  const fields = useFieldDefinitions();
  const projects = useProjects();

  useEffect(() => {
    if (!columnsLoaded) {
      void columnStore.getState().load();
    }
  }, [columnsLoaded]);

  const state = useMemo<ListViewState>(
    () => parseViewState(searchParams, valid ? container : null),
    [searchParams, container, valid],
  );

  // Memoised so the column list is not rebuilt on every render while the definitions
  // are still loading and this expression keeps returning a new empty array.
  const definitions = useMemo(() => fields.data ?? [], [fields.data]);
  const view = viewKey(container);
  const columns = useMemo(
    () => columnsFor(view, container, definitions),
    [columnsFor, view, container, definitions],
  );

  const filter = useMemo(() => buildFilterNode(state), [state]);
  const offset = (state.page - 1) * state.pageSize;

  const query = useItems({
    container,
    ...(filter === null ? {} : { filter }),
    sort: state.sort,
    limit: state.pageSize,
    offset,
  });

  const applyState = useCallback(
    (next: ListViewState) => {
      setSearchParams(serialiseViewState(next, container), { replace: false });
    },
    [setSearchParams, container],
  );

  /*
   * A page beyond the end, after a filter change or after items were completed on
   * another page. Clamped rather than left: an empty table with no explanation reads as
   * data loss, which is the one interpretation of this screen that is always wrong.
   */
  const requestedPage = state.page;
  const resultTotal = query.data?.total;
  useEffect(() => {
    if (resultTotal === undefined) {
      return;
    }
    const clamped = clampPage(requestedPage, resultTotal, state.pageSize);
    if (clamped !== requestedPage) {
      applyState({ ...state, page: clamped });
    }
  }, [resultTotal, requestedPage, state, state.pageSize, applyState]);

  const labels = useMemo(
    () => ({
      projects: Object.fromEntries(
        (projects.data ?? []).map((project) => [project.id, project.name]),
      ),
    }),
    [projects.data],
  );

  const fieldLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const definition of definitions) {
      map[definition.key] = definition.label;
    }
    return map;
  }, [definitions]);

  const total = query.data?.total ?? 0;
  const lastPage = pageCount(total, state.pageSize);

  if (!valid) {
    return (
      <Page>
        <PageHeader title={label} />
        <EmptyState
          title={`"${container}" is not a container`}
          description="Nothing is routed here, so this is almost certainly a mistyped link."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={label}
        description={`${total} ${total === 1 ? 'item' : 'items'}`}
        actions={
          <Button size="sm" variant="outline" onClick={() => navigate('/capture')}>
            Capture
          </Button>
        }
      />

      <FilterBar
        conditions={state.conditions}
        fieldLabels={fieldLabels}
        onAdd={(condition: Condition) => applyState(addConditionToState(state, condition))}
        onRemove={(field) => applyState(removeCondition(state, field))}
        onClear={() => applyState(clearConditions(state))}
      />

      <ColumnChooser
        columns={columns}
        hidden={config[view]?.hidden ?? []}
        available={definitions}
        container={container}
        onToggle={(key) => void columnStore.getState().toggle(view, key)}
      />

      {query.isError ? (
        <EmptyState
          title="The list could not be loaded"
          description={
            query.error instanceof Error ? query.error.message : 'The server did not answer.'
          }
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : query.isPending ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <ItemTable
            items={query.data?.items ?? []}
            columns={columns}
            definitions={definitions}
            today={todayIso()}
            sort={state.sort}
            labels={labels}
            onSort={(field, additive) => applyState(applySort(state, field, { additive }))}
            onOpen={(item) => navigate(`/item/${item.id}`)}
            emptyState={
              <EmptyState
                title={
                  state.conditions.length === 0
                    ? emptyHeadline(container)
                    : 'Nothing matches these filters'
                }
                description={
                  state.conditions.length === 0
                    ? emptyBody(container)
                    : state.conditions
                        .map((condition) => describeCondition(condition, fieldLabels))
                        .join(' and ')
                }
                action={
                  state.conditions.length === 0 ? (
                    <Button size="sm" onClick={() => navigate('/capture')}>
                      Capture something
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyState(clearConditions(state))}
                    >
                      Clear filters
                    </Button>
                  )
                }
              />
            }
          />
        </div>
      )}

      {lastPage > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={state.page <= 1}
            onClick={() => applyState({ ...state, page: state.page - 1 })}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {state.page} of {lastPage}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={state.page >= lastPage}
            onClick={() => applyState({ ...state, page: state.page + 1 })}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </Page>
  );
}

/**
 * Column visibility.
 *
 * A popover-free disclosure rather than a dialog: changing which columns you can see
 * is a two-second decision, and a dialog would make it a form to fill in.
 */
function ColumnChooser({
  columns,
  hidden,
  available,
  container,
  onToggle,
}: {
  columns: Array<{ key: string; label: string }>;
  hidden: string[];
  available: Array<{ key: string; label: string; showInTable: boolean }>;
  container: string;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Every column this view could show: the default set plus any field definition
  // that is currently hidden. A field that was turned off for this view has to
  // remain reachable here, or turning it off would be permanent.
  const all = useMemo(() => {
    const known = new Set(columns.map((column) => column.key));
    const extra = available
      .filter((definition) => definition.showInTable && !known.has(definition.key))
      .map((definition) => ({ key: definition.key, label: definition.label }));
    return [...columns, ...extra];
  }, [columns, available]);

  return (
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        Columns
      </Button>
      {open ? (
        <div className="rounded-md border bg-popover p-2 shadow-sm">
          <p className="px-1 pb-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            {containerLabel(container)}
          </p>
          <ul className="flex flex-col">
            {all.map((column) => (
              <li key={column.key}>
                <label className="flex items-center gap-2 rounded px-1 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(column.key)}
                    onChange={() => {
                      onToggle(column.key);
                      toast.success(
                        hidden.includes(column.key)
                          ? `Shown: ${column.label}`
                          : `Hidden: ${column.label}`,
                      );
                    }}
                  />
                  {column.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function emptyHeadline(container: string): string {
  switch (container) {
    case 'inbox':
      return 'The inbox is empty';
    case 'next_action':
      return 'No next actions';
    case 'calendar':
      return 'Nothing is scheduled';
    case 'waiting':
      return 'Nothing is waiting on anyone';
    case 'someday':
      return 'Nothing on someday / maybe';
    case 'reference':
      return 'No reference material';
    case 'trash':
      return 'The trash is empty';
    default:
      return 'Nothing here';
  }
}

function emptyBody(container: string): string {
  switch (container) {
    case 'inbox':
      return 'Captured thoughts land here before they are clarified. An empty inbox means everything you captured has found a home.';
    case 'trash':
      return 'Deleted items are kept here rather than destroyed, so a mistake can be undone.';
    case 'next_action':
      return 'Clarify something from the inbox to give yourself something concrete to do.';
    default:
      return 'Nothing is in this container yet.';
  }
}
