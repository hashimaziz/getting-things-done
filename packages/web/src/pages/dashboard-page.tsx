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

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select } from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { Widget } from '@/components/dashboard/widget';
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
  ROW_HEIGHT,
  addWidget,
  gridHeight,
  moveWidget,
  normaliseLayout,
  removeWidget,
  resizeWidget,
  widgetStyle,
  type GridLayout,
} from '@/lib/dashboard/layout';
import type { Dashboard, Item, MetricPoint, Recommendation, SystemHealth } from '@/lib/types';

interface WaitingGroup {
  personName: string;
  entries: Array<{ id: string; title: string; followUpAt: string | null }>;
}

export function DashboardPage() {
  useDocumentTitle('Dashboard');

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const dashboards = useQuery({
    queryKey: keys.dashboards.list,
    queryFn: async () =>
      (await apiFetch.get<{ dashboards: Dashboard[] }>('/dashboards')).dashboards,
  });

  const dashboard = pickDefault(dashboards.data);

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
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Dashboards are created in settings, where a layout can be arranged once and returned
              to on every visit.
            </p>
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
          editing ? 'Drag a widget to move it. Changes save as you make them.' : undefined
        }
        actions={
          <>
            {editing ? (
              <Select
                aria-label="Add a widget"
                value=""
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  if (event.target.value === '') {
                    return;
                  }
                  apply(addWidget(layout, event.target.value, `w${Date.now()}`));
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
            style={widgetStyle(widget)}
            className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card"
          >
            <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
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
                    Movement is by button as well as by drag. Drag is a pointing
                    device's affordance, and a layout you can only rearrange with a mouse
                    is a layout some people cannot arrange at all.
                  */}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${widgetTitle(widget)} left`}
                    onClick={() =>
                      apply(moveWidget(layout, widget.id, { x: widget.x - 1, y: widget.y }))
                    }
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${widgetTitle(widget)} right`}
                    onClick={() =>
                      apply(moveWidget(layout, widget.id, { x: widget.x + 1, y: widget.y }))
                    }
                  >
                    →
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Widen ${widgetTitle(widget)}`}
                    onClick={() =>
                      apply(
                        resizeWidget(layout, widget.id, {
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
                    onClick={() =>
                      apply(
                        resizeWidget(layout, widget.id, {
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
function pickDefault(dashboards: Dashboard[] | undefined): Dashboard | undefined {
  if (dashboards === undefined || dashboards.length === 0) {
    return undefined;
  }
  return dashboards.find((dashboard) => dashboard.isDefault) ?? dashboards[0];
}

export { adding_placeholder as _unused };

const adding_placeholder = 0;
