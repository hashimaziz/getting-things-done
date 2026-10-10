/**
 * The dashboard.
 *
 * Three things make this work, and all three are about not having ten widgets disagree
 * with each other:
 *
 * - The layout is data, normalised on the way in. A widget is a type and a rectangle,
 *   never a component, so a layout is portable and a rename cannot break it.
 * - The data is fetched by the container. It reads which sources the widgets need and
 *   fetches their union, so ten widgets asking for health make one request rather than
 *   ten — and cannot show six different numbers if two are in flight at different
 *   moments.
 * - The grid is cells, not pixels. "Half width" is a value rather than a rendering
 *   decision, and a layout means the same thing on a laptop and a large monitor.
 */

import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select } from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { Widget } from '@/components/dashboard/widget';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/document-title';
import { apiFetch } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import {
  WIDGETS,
  findWidget,
  requiredSources,
  widgetTitle,
  type DataSource,
  type WidgetData,
} from '@/lib/dashboard/registry';
import {
  COLUMNS,
  MAX_SIZE,
  MIN_SIZE,
  ROW_HEIGHT,
  addWidget,
  gridHeight,
  moveWidget,
  moveWidgetBy,
  normaliseLayout,
  removeWidget,
  resizeWidget,
  widgetStyle,
  type GridLayout,
  type MoveDirection,
} from '@/lib/dashboard/layout';

/** Glyphs for the four nudges. Text rather than icons so they line up with each other. */
const ARROWS: Record<MoveDirection, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};
import type {
  Dashboard,
  DashboardWidget,
  Item,
  MetricPoint,
  Recommendation,
  SystemHealth,
} from '@/lib/types';

interface WaitingGroup {
  personName: string;
  entries: Array<{ id: string; title: string; followUpAt: string | null }>;
}

export function DashboardPage() {
  useDocumentTitle('Dashboard');

  const navigate = useNavigate();
  const { dashboardId } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  /*
   * The widget being dragged, and the cell its top-left corner is currently over.
   *
   * Held separately from the saved layout so the widget follows the pointer and
   * nothing is written until it is let go. A drag that saves on every pointermove
   * writes a hundred rows and a hundred history entries for one gesture, and puts a
   * widget back on the row below everything each time it passed over it.
   */
  const [drag, setDrag] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  /*
   * The same position, readable from the pointer-up handler.
   *
   * State is not readable from an event handler that closed over it: by the time the
   * pointer is released, the render holding that state may never have happened, so the
   * drop would land wherever the widget started. A ref is written alongside the state
   * and read at the moment it is needed.
   */
  const dragAt = useRef<{ id: string; at: { x: number; y: number } } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const dashboards = useQuery({
    queryKey: keys.dashboards.list,
    queryFn: async () =>
      (await apiFetch.get<{ dashboards: Dashboard[] }>('/dashboards')).dashboards,
  });

  /*
   * Which dashboard is showing.
   *
   * Addressed by id in the path rather than in component state, for two reasons: a
   * second dashboard is otherwise unreachable, and a dashboard somebody has arranged
   * cannot be linked to. The default is used when the path names none or names one
   * that has been deleted, so an old bookmark lands on something rather than on an
   * error.
   */
  const dashboard = pickDashboard(dashboards.data, dashboardId);

  /*
   * Empty until the saved layout is known, rather than the built-in default.
   *
   * Starting from the default would make the first render ask for every source every
   * widget needs — a chart widget, a suggestions query and a waiting query for a
   * dashboard that has none of them. React Query does not cancel an in-flight query
   * when `enabled` later turns false, so the wrong requests are not merely wasted,
   * they still arrive.
   */
  const layout = useMemo<GridLayout>(
    () => (dashboard === undefined ? { widgets: [] } : normaliseLayout(dashboard.widgets)),
    [dashboard],
  );

  const data = useWidgetData(layout);

  const save = useMutation({
    mutationFn: async (next: GridLayout) => {
      if (!dashboard) {
        return;
      }
      // PATCH, not PUT: a layout change is a partial update, and the server's convention
      // is PUT for whole-value writes.
      await apiFetch.patch(`/dashboards/${dashboard.id}`, { widgets: next.widgets });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.dashboards.all });
      toast.success('Dashboard saved');
    },
  });

  /**
   * Nudge or resize, returning the layout either way.
   *
   * The `applied` flag is kept by the caller for disabling the button; what arrives
   * here is always a valid layout, so a refused nudge simply returns the layout it was
   * given and nothing is saved.
   */
  const nudge = (current: GridLayout, id: string, direction: MoveDirection): GridLayout => ({
    widgets: moveWidgetBy(current, id, direction).widgets,
  });

  const canNudge = (current: GridLayout, id: string, direction: MoveDirection): boolean =>
    moveWidgetBy(current, id, direction).applied;

  const resize = (
    current: GridLayout,
    id: string,
    size: { width: number; height: number },
  ): GridLayout => ({ widgets: resizeWidget(current, id, size).widgets });

  /**
   * Begins a drag from a pointer press on a widget's title bar.
   *
   * Pointer events rather than mouse events, so a touch works without a second code
   * path — and `setPointerCapture` rather than a listener on the document, so the
   * gesture survives the pointer leaving the title bar mid-drag, which is what happens
   * the moment anybody drags anything.
   */
  const startDrag = (event: React.PointerEvent, widget: DashboardWidget): void => {
    if (event.button !== 0) {
      // Right-click opens a context menu; it is not a drag.
      return;
    }

    const grid = gridRef.current;
    if (grid === null) {
      return;
    }

    const cellWidth = grid.getBoundingClientRect().width / COLUMNS;
    if (cellWidth <= 0) {
      // jsdom reports a zero-width rect, and so does a display:none grid. Either way
      // there is nothing to measure a cell against.
      return;
    }

    const origin = { x: event.clientX, y: event.clientY };
    const startAt = { x: widget.x, y: widget.y };

    /*
     * Capture keeps the gesture alive when the pointer leaves the title bar, which it
     * does immediately. It is an optimisation rather than a requirement — the window
     * listeners below do the work either way — so an environment without it gets a
     * working drag rather than a thrown error and no drag at all.
     */
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const onMove = (move: PointerEvent): void => {
      const columns = Math.round((move.clientX - origin.x) / cellWidth);
      const rows = Math.round((move.clientY - origin.y) / ROW_HEIGHT);

      const next = {
        id: widget.id,
        at: {
          x: Math.min(Math.max(0, startAt.x + columns), COLUMNS - widget.width),
          y: Math.max(0, startAt.y + rows),
        },
      };
      dragAt.current = next;
      setDrag(next);
    };

    const finish = (): void => {
      const landed = dragAt.current;
      if (landed !== null && landed.id === widget.id) {
        // One save per gesture, at the end of it.
        apply(moveWidget(layout, widget.id, landed.at));
      }
      dragAt.current = null;
      setDrag(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const apply = (next: GridLayout): void => {
    if (!dashboard) {
      return;
    }
    // Applied immediately so the layout feels live, then persisted. Waiting for the save
    // to redraw makes dragging feel broken.
    void save.mutate(next);
  };

  if (dashboards.isPending) {
    return (
      <Page>
        <PageHeader title="Dashboard" />
      </Page>
    );
  }

  if (!dashboard) {
    return (
      <Page>
        <PageHeader title="Dashboard" />
        <Card>
          <CardHeader>
            <CardTitle>No dashboard yet</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              A dashboard is a saved arrangement of widgets. Create one, arrange it once, and it is
              there every time you come back.
            </p>
            {/* A button rather than a sentence about a screen. The old text pointed at
                settings, which was a placeholder saying this very thing. */}
            <div>
              <Button size="sm" onClick={() => navigate('/settings/dashboards')}>
                <Plus />
                Set up a dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={dashboard.name}
        description={
          editing
            ? 'Drag a title bar to move a widget, or use the arrows. Changes save as you make them.'
            : undefined
        }
        actions={
          <>
            {/*
              Only worth a control when there is more than one dashboard. With a single
              one there is nothing to switch between, and a dropdown that always has one
              option is a control that exists to be looked at.
            */}
            {(dashboards.data ?? []).length > 1 ? (
              <Select
                aria-label="Dashboard"
                value={dashboard.id}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                  void navigate(`/dashboard/${event.target.value}`)
                }
                className="h-8 w-40 text-xs"
              >
                {(dashboards.data ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {editing ? (
              <Select
                aria-label="Add a widget"
                value=""
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  if (event.target.value === '') {
                    return;
                  }
                  /*
                   * The id is derived from the layout rather than from a clock.
                   *
                   * Two widgets added in the same millisecond were getting the same
                   * id, and two widgets sharing one id is a layout that renders one of
                   * them twice and moves both when one is dragged.
                   */
                  apply(addWidget(layout, event.target.value, freeWidgetId(layout)));
                }}
                className="h-8 w-44 text-xs"
              >
                <option value="">Add a widget…</option>
                {WIDGETS.filter(
                  (definition) => !layout.widgets.some((w) => w.type === definition.type),
                ).map((definition) => (
                  <option key={definition.type} value={definition.type}>
                    {definition.title}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button
              size="sm"
              variant={editing ? 'default' : 'outline'}
              onClick={() => setEditing(!editing)}
            >
              {editing ? 'Done' : 'Arrange'}
            </Button>
          </>
        }
      />

      <div
        ref={gridRef}
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_HEIGHT}px`,
          gridTemplateRows: `repeat(${gridHeight(layout)}, auto)`,
        }}
      >
        {layout.widgets.map((widget) => (
          <div
            key={widget.id}
            style={widgetStyle(drag?.id === widget.id ? { ...widget, ...drag.at } : widget)}
            className={cn(
              'flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card',
              drag?.id === widget.id ? 'opacity-80 ring-2 ring-primary' : '',
            )}
          >
            <div
              /*
                The title bar is the handle rather than the whole widget: dragging a
                chart means dragging its chart, and a handle that is the title means a
                click on the numbers never moves anything by accident.
              */
              className={cn(
                'flex items-center justify-between gap-2 border-b px-3 py-1.5',
                editing ? 'cursor-grab touch-none select-none active:cursor-grabbing' : '',
              )}
              onPointerDown={editing ? (event) => startDrag(event, widget) : undefined}
            >
              <h2 className="truncate text-xs font-medium">
                {widgetTitle(widget)}
                {findWidget(widget.type)?.renderer === 'text' ? (
                  <Badge variant="secondary" className="ml-2 text-[0.5625rem]">
                    reminder
                  </Badge>
                ) : null}
              </h2>

              {editing ? (
                <div className="flex shrink-0 items-center gap-1">
                  {/*
                    Movement is by button as well as by drag.

                    The buttons swap with the neighbour in that direction rather than
                    shoving it onto the next row, which is what they used to do: five
                    presses of the right arrow moved a widget one cell and rearranged
                    half the dashboard. A press means "put it over there", so that is
                    what it does. Drag still pushes, because a drag is a placement and
                    the person can see where it is going.
                  */}
                  {(['up', 'down', 'left', 'right'] as const).map((direction) => (
                    <Button
                      key={direction}
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${widgetTitle(widget)} ${direction}`}
                      disabled={!canNudge(layout, widget.id, direction)}
                      onClick={() => apply(nudge(layout, widget.id, direction))}
                    >
                      {ARROWS[direction]}
                    </Button>
                  ))}

                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Widen ${widgetTitle(widget)}`}
                    disabled={widget.width >= COLUMNS}
                    onClick={() =>
                      apply(
                        resize(layout, widget.id, {
                          width: widget.width + 1,
                          height: widget.height,
                        }),
                      )
                    }
                  >
                    <Plus />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Narrow ${widgetTitle(widget)}`}
                    disabled={widget.width <= MIN_SIZE.width}
                    onClick={() =>
                      apply(
                        resize(layout, widget.id, {
                          width: widget.width - 1,
                          height: widget.height,
                        }),
                      )
                    }
                  >
                    −
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Make ${widgetTitle(widget)} taller`}
                    disabled={widget.height >= MAX_SIZE.height}
                    onClick={() =>
                      apply(
                        resize(layout, widget.id, {
                          width: widget.width,
                          height: widget.height + 1,
                        }),
                      )
                    }
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Make ${widgetTitle(widget)} shorter`}
                    disabled={widget.height <= MIN_SIZE.height}
                    onClick={() =>
                      apply(
                        resize(layout, widget.id, {
                          width: widget.width,
                          height: widget.height - 1,
                        }),
                      )
                    }
                  >
                    <ChevronUp />
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${widgetTitle(widget)}`}
                    onClick={() => apply(removeWidget(layout, widget.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1">
              <Widget type={widget.type} data={data} onOpen={(id) => navigate(`/item/${id}`)} />
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}

/**
 * Fetches exactly what the current layout needs.
 *
 * Each source is one query, keyed by what it is rather than by which widget asked, so
 * two widgets wanting the same thing share a cache entry and one request.
 */
function useWidgetData(layout: GridLayout): WidgetData {
  const sources = useMemo(() => requiredSources(layout.widgets), [layout.widgets]);
  const wanted = (source: DataSource): boolean => sources.includes(source);

  const health = useQuery({
    queryKey: keys.metrics.health,
    queryFn: async () => (await apiFetch.get<{ health: SystemHealth }>('/metrics/health')).health,
    enabled: wanted('health'),
  });

  const throughput = useQuery({
    queryKey: keys.metrics.throughput(30),
    queryFn: async () =>
      (await apiFetch.get<{ points: MetricPoint[] }>('/metrics/throughput', { days: 30 })).points,
    enabled: wanted('throughput'),
  });

  const breakdown = useQuery({
    queryKey: keys.metrics.breakdown('all'),
    queryFn: async () => {
      // One request per dimension, but only the dimensions on screen. A dashboard with
      // no project breakdown should not pay for one.
      const dimensions = (['category', 'container', 'project'] as const).filter((dimension) =>
        wanted(`breakdown:${dimension}`),
      );
      const responses = await Promise.all(
        dimensions.map((dimension) =>
          apiFetch
            .get<{ points: MetricPoint[] }>('/metrics/breakdown', { dimension })
            .then((response) => [dimension, response.points] as const),
        ),
      );
      return Object.fromEntries(responses) as Record<string, MetricPoint[]>;
    },
    enabled: sources.some((source) => source.startsWith('breakdown:')),
  });

  const recommendations = useQuery({
    queryKey: keys.recommendations.list('dashboard'),
    queryFn: async () => {
      const focuses = (['what_next', 'overdue'] as const).filter((focus) =>
        wanted(`recommendations:${focus}`),
      );
      const responses = await Promise.all(
        focuses.map((focus) =>
          apiFetch
            .get<{ recommendations: Recommendation[] }>('/recommendations', { focus, limit: 8 })
            .then((response) => [focus, response.recommendations] as const),
        ),
      );
      return Object.fromEntries(responses) as Record<
        string,
        Array<Pick<Recommendation, 'id' | 'title' | 'reason' | 'itemId'>>
      >;
    },
    enabled: sources.some((source) => source.startsWith('recommendations:')),
  });

  const waiting = useQuery({
    queryKey: keys.review.waiting('person'),
    queryFn: async () =>
      (await apiFetch.get<{ groups: WaitingGroup[] }>('/waiting', { groupBy: 'person' })).groups,
    enabled: wanted('waiting'),
  });

  const recent = useQuery({
    queryKey: keys.metrics.completions(10),
    queryFn: async () =>
      (await apiFetch.get<{ items: Item[] }>('/metrics/recent', { limit: 10 })).items,
    enabled: wanted('recentCompletions'),
  });

  return {
    health: health.data,
    throughput: throughput.data,
    breakdown: breakdown.data ?? {},
    recommendations: recommendations.data ?? {},
    waiting: waiting.data ?? [],
    recentCompletions: (recent.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      completedAt: item.completedAt,
    })),
  };
}

/** The default dashboard, or the first one. Never nothing if any exist. */
/** An id no widget in this layout is already using. */
function freeWidgetId(layout: GridLayout): string {
  let index = layout.widgets.length;
  while (layout.widgets.some((widget) => widget.id === `w${index}`)) {
    index += 1;
  }
  return `w${index}`;
}

function pickDashboard(
  dashboards: Dashboard[] | undefined,
  wanted: string | undefined,
): Dashboard | undefined {
  if (dashboards === undefined || dashboards.length === 0) {
    return undefined;
  }
  if (wanted !== undefined) {
    const named = dashboards.find((dashboard) => dashboard.id === wanted);
    if (named !== undefined) {
      return named;
    }
  }
  return dashboards.find((dashboard) => dashboard.isDefault) ?? dashboards[0];
}
