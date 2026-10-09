/**
 * The widget registry.
 *
 * A dashboard is a set of widgets arranged by the person using it, so what a widget
 * *is* has to be data — a type, a size, a title override — and never a component
 * sitting in the layout. Storing components is how a layout stops being portable and
 * starts being a crash waiting for a rename.
 *
 * Each widget declares which data it needs, and the container fetches the union of
 * those needs in as few requests as possible. Ten widgets each fetching health is nine
 * wasted requests and ten chances to show six different numbers if two of them are in
 * flight at different moments.
 */

import type { MetricPoint, SystemHealth } from '../types';

/** How a widget wants to be drawn. */
export type WidgetRenderer = 'stat' | 'list' | 'chart' | 'text' | 'grid';

export interface WidgetDefinition {
  type: string;
  title: string;
  /** What kind of visual it is, which decides the chrome and the default size. */
  renderer: WidgetRenderer;
  /** Every data source it reads. The container fetches the union across widgets. */
  needs: DataSource[];
  /** Default grid width and height, in cells. */
  defaultSize: { width: number; height: number };
  /** Whether the title can be edited per dashboard. */
  titleEditable: boolean;
  description: string;
}

export type DataSource =
  | 'health'
  | 'throughput'
  | 'breakdown:category'
  | 'breakdown:container'
  | 'breakdown:project'
  | 'recentCompletions'
  | 'recommendations:what_next'
  | 'recommendations:overdue'
  | 'recommendations:daily_review'
  | 'waiting'
  | 'inboxCount'
  | 'openItems';

export const WIDGETS: WidgetDefinition[] = [
  {
    type: 'health.summary',
    title: 'System health',
    renderer: 'stat',
    needs: ['health'],
    defaultSize: { width: 4, height: 2 },
    titleEditable: true,
    description: 'Inbox, overdue, waiting and open counts at a glance.',
  },
  {
    type: 'inbox.backlog',
    title: 'Inbox backlog',
    renderer: 'stat',
    needs: ['health'],
    defaultSize: { width: 2, height: 1 },
    titleEditable: false,
    description: 'How much is unprocessed. The number that rots fastest.',
  },
  {
    type: 'overdue.count',
    title: 'Overdue',
    renderer: 'stat',
    needs: ['health'],
    defaultSize: { width: 2, height: 1 },
    titleEditable: false,
    description: 'Deadlines already past.',
  },
  {
    type: 'waiting.count',
    title: 'Waiting on others',
    renderer: 'stat',
    needs: ['health'],
    defaultSize: { width: 2, height: 1 },
    titleEditable: false,
    description: 'Delegated work, and how much of it is overdue.',
  },
  {
    type: 'throughput.chart',
    title: 'Completed per day',
    renderer: 'chart',
    needs: ['throughput'],
    defaultSize: { width: 6, height: 3 },
    titleEditable: true,
    description: 'What actually got finished, day by day.',
  },
  {
    type: 'breakdown.category',
    title: 'Open work by category',
    renderer: 'chart',
    needs: ['breakdown:category'],
    defaultSize: { width: 4, height: 3 },
    titleEditable: true,
    description: 'Where your open work sits.',
  },
  {
    type: 'breakdown.container',
    title: 'Open work by container',
    renderer: 'chart',
    needs: ['breakdown:container'],
    defaultSize: { width: 4, height: 3 },
    titleEditable: true,
    description: 'How much sits in each GTD container.',
  },
  {
    type: 'breakdown.project',
    title: 'Open work by project',
    renderer: 'chart',
    needs: ['breakdown:project'],
    defaultSize: { width: 4, height: 3 },
    titleEditable: true,
    description: 'Which projects are carrying the most open work.',
  },
  {
    type: 'recommendations.next',
    title: 'What to do next',
    renderer: 'list',
    needs: ['recommendations:what_next'],
    defaultSize: { width: 4, height: 4 },
    titleEditable: true,
    description: 'Suggestions with a reason attached.',
  },
  {
    type: 'recommendations.overdue',
    title: 'Needs attention',
    renderer: 'list',
    needs: ['recommendations:overdue'],
    defaultSize: { width: 4, height: 4 },
    titleEditable: true,
    description: 'Overdue and stalled work, with reasons.',
  },
  {
    type: 'waiting.list',
    title: 'Waiting for',
    renderer: 'list',
    needs: ['waiting'],
    defaultSize: { width: 4, height: 3 },
    titleEditable: true,
    description: 'Delegated items grouped by who owes them.',
  },
  {
    type: 'recent.completions',
    title: 'Recently completed',
    renderer: 'list',
    needs: ['recentCompletions'],
    defaultSize: { width: 4, height: 3 },
    titleEditable: true,
    description: 'Recent wins, for the days nothing seems to move.',
  },
  {
    type: 'quote.method',
    title: 'The method',
    renderer: 'text',
    needs: [],
    defaultSize: { width: 3, height: 2 },
    titleEditable: false,
    description: 'A reminder of what the containers are for.',
  },
  {
    type: 'empty.grid',
    title: 'Empty space',
    renderer: 'grid',
    needs: [],
    defaultSize: { width: 2, height: 1 },
    titleEditable: false,
    description: 'A gap you can resize. Useful for keeping a layout breathable.',
  },
];

/** Every widget type, for the "add a widget" picker. */
export function findWidget(type: string): WidgetDefinition | undefined {
  return WIDGETS.find((widget) => widget.type === type);
}

export function widgetTitle(widget: { type: string; title: string | null }): string {
  // A per-dashboard title wins, and an empty one falls back rather than rendering a
  // blank header.
  const trimmed = widget.title?.trim();
  return trimmed !== undefined && trimmed !== ''
    ? trimmed
    : (findWidget(widget.type)?.title ?? widget.type);
}

export interface WidgetData {
  health: SystemHealth | undefined;
  throughput: MetricPoint[] | undefined;
  breakdown: Record<string, MetricPoint[]>;
  recommendations: Record<
    string,
    Array<{ id: string; title: string; reason: string; itemId?: string }>
  >;
  waiting: Array<{
    personName: string;
    entries: Array<{ id: string; title: string; followUpAt: string | null }>;
  }>;
  recentCompletions: Array<{ id: string; title: string; completedAt: string | null }>;
}

/** The data sources a set of widgets needs, deduplicated. */
export function requiredSources(widgets: Array<{ type: string }>): DataSource[] {
  const sources = new Set<DataSource>();
  for (const widget of widgets) {
    for (const source of findWidget(widget.type)?.needs ?? []) {
      sources.add(source);
    }
  }
  return [...sources];
}
