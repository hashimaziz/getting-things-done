/**
 * The widget renderer.
 *
 * One switch on widget type, and that is deliberate: a registry of components would be
 * more extensible and would also make it possible for a widget to hold state, which is
 * how ten widgets end up making ten requests for the same number and showing six
 * different values for it.
 *
 * Everything a widget draws comes from a single `data` object the container filled in,
 * so a widget cannot fetch anything of its own. A widget that fetches is a widget whose
 * number can disagree with the tile beside it.
 *
 * Charts are drawn as plain bars rather than with a charting library. The library is
 * already a dependency for the dedicated chart widgets, but a dashboard tile wants four
 * bars and a label, and the chart component's overhead — responsive container, axes,
 * animation — is a poor trade for that. Anything more elaborate belongs in a widget
 * sized for it.
 */

import type { MetricPoint, Recommendation, SystemHealth } from '@/lib/types';
import { formatDate, formatDuration } from '@/lib/item-list/format';
import type { WidgetData } from '@/lib/dashboard/registry';

export interface WidgetProps {
  type: string;
  data: WidgetData;
  onOpen: (itemId: string) => void;
}

export function Widget({ type, data, onOpen }: WidgetProps) {
  switch (type) {
    case 'health.summary':
      return <HealthSummary health={data.health} />;
    case 'inbox.backlog':
      return (
        <Stat
          label="Inbox"
          value={data.health?.inboxBacklog}
          tone={tone(data.health?.inboxBacklog ?? 0, [7, 14])}
        />
      );
    case 'overdue.count':
      return (
        <Stat
          label="Overdue"
          value={data.health?.overdue}
          tone={tone(data.health?.overdue ?? 0, [1, 5])}
        />
      );
    case 'waiting.count':
      return (
        <Stat
          label="Waiting"
          value={data.health?.waiting}
          tone={tone(data.health?.waitingOverdue ?? 0, [1, 3])}
          {...(data.health !== undefined && data.health.waiting > 0
            ? { detail: `${data.health.waitingOverdue} past follow-up` }
            : {})}
        />
      );
    case 'throughput.chart':
      return <Throughput points={data.throughput} />;
    case 'breakdown.category':
      return <Breakdown title="By category" points={data.breakdown['category']} />;
    case 'breakdown.container':
      return <Breakdown title="By container" points={data.breakdown['container']} />;
    case 'breakdown.project':
      return <Breakdown title="By project" points={data.breakdown['project']} />;
    case 'recommendations.next':
      return (
        <Recommendations
          focus="what_next"
          recommendations={data.recommendations['what_next']}
          onOpen={onOpen}
        />
      );
    case 'recommendations.overdue':
      return (
        <Recommendations
          focus="overdue"
          recommendations={data.recommendations['overdue']}
          onOpen={onOpen}
        />
      );
    case 'waiting.list':
      return <WaitingList groups={data.waiting} onOpen={onOpen} />;
    case 'recent.completions':
      return <RecentCompletions items={data.recentCompletions} onOpen={onOpen} />;
    case 'quote.method':
      return <MethodReminder />;
    case 'empty.grid':
      return null;
    default:
      return (
        <p className="text-xs text-muted-foreground">
          This widget type is not one this build knows about.
        </p>
      );
  }
}

/** How a number should be coloured. */
function tone(value: number, thresholds: [number, number]): 'ok' | 'warn' | 'bad' {
  if (value >= thresholds[1]) {
    return 'bad';
  }
  if (value >= thresholds[0]) {
    return 'warn';
  }
  return 'ok';
}

const TONE_CLASS = {
  ok: 'text-foreground',
  warn: 'text-[var(--warning)]',
  bad: 'text-destructive',
} as const;

function Stat({
  label,
  value,
  tone: colour = 'ok',
  detail,
}: {
  label: string;
  value: number | undefined;
  tone?: 'ok' | 'warn' | 'bad' | undefined;
  detail?: string | undefined;
}) {
  return (
    <div className="flex h-full flex-col justify-center gap-0.5 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${TONE_CLASS[colour]}`}>
        {value === undefined ? '—' : value}
      </span>
      {detail ? <span className="text-[0.6875rem] text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

/**
 * The health summary.
 *
 * Nine numbers, because this is the widget people open the app to see. Each is a link
 * to the list behind it: a number that cannot be acted on is a number that just makes
 * someone anxious.
 */
function HealthSummary({ health }: { health: SystemHealth | undefined }) {
  if (!health) {
    return <Stat label="System health" value={undefined} />;
  }

  const cells: Array<{ label: string; value: number | string; tone: 'ok' | 'warn' | 'bad' }> = [
    { label: 'Inbox', value: health.inboxBacklog, tone: tone(health.inboxBacklog, [7, 14]) },
    { label: 'Overdue', value: health.overdue, tone: tone(health.overdue, [1, 5]) },
    { label: 'Due soon', value: health.dueSoon, tone: tone(health.dueSoon, [3, 7]) },
    { label: 'Scheduled', value: health.scheduledCount, tone: 'ok' },
    { label: 'Waiting', value: health.waiting, tone: 'ok' },
    {
      label: 'Past follow-up',
      value: health.waitingOverdue,
      tone: tone(health.waitingOverdue, [1, 3]),
    },
    { label: 'Someday', value: health.someday, tone: 'ok' },
    { label: 'No estimate', value: health.openWithoutEstimate, tone: 'ok' },
    { label: 'Open minutes', value: formatDuration(health.openMinutes), tone: 'ok' },
  ];

  return (
    <dl className="grid h-full grid-cols-3 gap-1 p-2">
      {cells.map((cell) => (
        <div key={cell.label} className="flex min-w-0 flex-col justify-center">
          <dt className="truncate text-[0.6875rem] text-muted-foreground">{cell.label}</dt>
          <dd className={`truncate text-sm font-medium tabular-nums ${TONE_CLASS[cell.tone]}`}>
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Completed items per day.
 *
 * Bars are scaled to the busiest day rather than to a fixed height, so a quiet week
 * still shows shape. A chart flattened against an axis of 100 completions renders every
 * ordinary week as an empty row.
 */
function Throughput({ points }: { points: MetricPoint[] | undefined }) {
  if (points === undefined) {
    return <SkeletonRows />;
  }
  if (points.length === 0) {
    return <NothingYet>Nothing completed in this range yet.</NothingYet>;
  }

  const busiest = Math.max(1, ...points.map((point) => point.count));
  const completed = points.reduce((sum, point) => sum + point.count, 0);

  return (
    <div className="flex h-full flex-col justify-end gap-1 p-2">
      <div
        className="flex items-end gap-0.5"
        role="img"
        aria-label={`${completed} completed across ${points.length} days`}
      >
        {points.map((point) => (
          <div
            key={point.key}
            title={`${point.label}: ${point.count}`}
            className="min-h-0.5 flex-1 rounded-t bg-primary/70"
            style={{ height: `${Math.max(2, (point.count / busiest) * 100)}%` }}
          />
        ))}
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">
        {completed} completed · busiest {busiest} in a day
      </p>
    </div>
  );
}

function Breakdown({ title, points }: { title: string; points: MetricPoint[] | undefined }) {
  if (points === undefined) {
    return <SkeletonRows />;
  }
  if (points.length === 0) {
    return <NothingYet>Nothing open to break down.</NothingYet>;
  }

  const total = points.reduce((sum, point) => sum + point.count, 0);
  const busiest = Math.max(1, ...points.map((point) => point.count));

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      <p className="text-[0.6875rem] text-muted-foreground">
        {title} · {total} open
      </p>
      {points.map((point) => (
        <div key={point.key} className="flex flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate">{point.label}</span>
            <span className="tabular-nums text-muted-foreground">{point.count}</span>
          </div>
          <div className="h-1 w-full rounded bg-muted">
            <div
              className="h-1 rounded bg-primary/70"
              style={{ width: `${(point.count / busiest) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Suggestions.
 *
 * The reason is shown with every entry. A suggestion without one is indistinguishable
 * from noise, and noise is what makes people ignore a system that is trying to help.
 */
function Recommendations({
  focus,
  recommendations,
  onOpen,
}: {
  focus: string;
  recommendations: Array<Pick<Recommendation, 'id' | 'title' | 'reason' | 'itemId'>> | undefined;
  onOpen: (id: string) => void;
}) {
  if (recommendations === undefined) {
    return <SkeletonRows />;
  }
  if (recommendations.length === 0) {
    return <NothingYet>Nothing to suggest. That is good news.</NothingYet>;
  }

  return (
    <ul className="flex h-full flex-col gap-1 overflow-y-auto p-2" data-focus={focus}>
      {recommendations.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            disabled={entry.itemId === undefined}
            onClick={() => entry.itemId !== undefined && onOpen(entry.itemId)}
            className="flex w-full flex-col gap-0.5 rounded px-1 py-0.5 text-left hover:bg-accent/50 disabled:hover:bg-transparent"
          >
            <span className="truncate text-xs font-medium">{entry.title}</span>
            <span className="text-[0.6875rem] text-muted-foreground">{entry.reason}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function WaitingList({
  groups,
  onOpen,
}: {
  groups: Array<{
    personName: string;
    entries: Array<{ id: string; title: string; followUpAt: string | null }>;
  }>;
  onOpen: (id: string) => void;
}) {
  if (groups.length === 0) {
    return <NothingYet>Nothing is waiting on anyone.</NothingYet>;
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      {groups.map((group) => (
        <section key={group.personName}>
          <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {group.personName}
          </h3>
          <ul className="flex flex-col">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onOpen(entry.id)}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50"
                >
                  <span className="truncate">{entry.title}</span>
                  {entry.followUpAt ? (
                    <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                      {formatDate(entry.followUpAt)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RecentCompletions({
  items,
  onOpen,
}: {
  items: Array<{ id: string; title: string; completedAt: string | null }>;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return <NothingYet>Nothing completed recently.</NothingYet>;
  }

  return (
    <ul className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpen(item.id)}
            className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50"
          >
            <span className="truncate">{item.title}</span>
            {item.completedAt ? (
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                {formatDate(item.completedAt)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The method, restated.
 *
 * Included because a system nobody can remember the rules of gets used incorrectly. The
 * containers are the part people forget, and forgetting is how the calendar fills up.
 */
function MethodReminder() {
  return (
    <div className="flex h-full flex-col justify-center gap-1 p-3 text-xs">
      <p className="font-medium">Capture. Clarify. Organise. Reflect. Engage.</p>
      <ul className="flex flex-col gap-0.5 text-muted-foreground">
        <li>Inbox is unprocessed, not a to-do list.</li>
        <li>The calendar holds only hard landscape.</li>
        <li>A deadline is soft and never appears there.</li>
        <li>Waiting needs a person and a date.</li>
      </ul>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="flex h-full flex-col gap-1 p-2">
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}

/**
 * The empty state for a widget.
 *
 * Says which thing is empty rather than rendering nothing, because a blank rectangle on
 * a dashboard reads as a broken widget rather than as "there is none of that today".
 */
function NothingYet({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}
