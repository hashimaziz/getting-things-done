/**
 * The calendar grid.
 *
 * Week and month share one grid rather than being two screens, because the question
 * "what is on today?" is asked constantly and the answer should be the same picture at
 * both zoom levels.
 *
 * The hard rule the layout enforces: **deadlines are drawn in a separate, visibly
 * secondary row** within each day. Soft deadlines are shown — hiding them would lose
 * information — but they never share a cell with hard commitments, because the moment
 * they do, the calendar stops being the hard landscape and becomes a to-do list.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Badge, Label } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  DAY_NAMES,
  buildCalendar,
  formatDayNumber,
  formatMonthYear,
  formatWeekRange,
  sameView,
  shiftAnchor,
  todayIso,
  type CalendarMode,
} from '@/lib/calendar';
import { explainDeadlineOnly, type CalendarModel, type DayEntry } from '@/lib/calendar-model';

export interface CalendarGridProps {
  mode: CalendarMode;
  anchor: string;
  weekStartsOn: number;
  today: string;
  model: CalendarModel;
  onModeChange: (mode: CalendarMode) => void;
  onAnchorChange: (anchor: string) => void;
  onOpen: (itemId: string) => void;
  onCreate: (date: string) => void;
}

export function CalendarGrid({
  mode,
  anchor,
  weekStartsOn,
  today,
  model,
  onModeChange,
  onAnchorChange,
  onOpen,
  onCreate,
}: CalendarGridProps) {
  const range = buildCalendar({ mode, anchor, weekStartsOn, today });
  const byDate = new Map(model.days.map((day) => [day.date, day]));

  // Weekday headers follow the configured first day of the week, which is a setting
  // rather than a constant: the calendar starts on Monday in most of the world and on
  // Sunday in the United States, and hard-coding either is wrong for someone.
  const headers = Array.from({ length: 7 }, (_, index) => DAY_NAMES[(weekStartsOn + index) % 7]);

  const step = (direction: -1 | 1): void => onAnchorChange(shiftAnchor(anchor, mode, direction));

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Next">
            <ChevronRight />
          </Button>

          <h2 className="ml-2 text-sm font-medium">
            {mode === 'week' ? formatWeekRange(range.start) : formatMonthYear(anchor)}
          </h2>

          {/*
            Returned to today rather than to the 1st. Coming back from three months
            ahead and landing in the middle of an empty month is disorienting; the
            natural question on opening is "what is happening now".
          */}
          {!sameView(anchor, today, mode) ? (
            <Button size="sm" variant="ghost" onClick={() => onAnchorChange(today)}>
              Today
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="calendar-mode" className="sr-only">
              Calendar view
            </Label>
            <select
              id="calendar-mode"
              value={mode}
              onChange={(event) => onModeChange(event.target.value as CalendarMode)}
              className="h-8 rounded border border-input bg-background px-2 text-xs"
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>

          <div className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
            <span className="container-chip bg-[var(--container-calendar)]/15 text-foreground">
              hard date
            </span>
            <span className="container-chip border border-dashed">deadline</span>
          </div>
        </div>
      </header>

      {model.undated.length > 0 ? (
        /*
          Items in the calendar container with no hard date. An invariant violation the
          server also reports; showing it here means the person sees it where they
          created it instead of discovering it in a review weeks later.
        */
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-xs">
              {model.undated.length} in the calendar with no hard date
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {model.undated.map((entry) => (
              <button
                key={entry.item.id}
                type="button"
                onClick={() => onOpen(entry.item.id)}
                className="text-left text-xs text-muted-foreground hover:text-foreground"
              >
                {entry.item.title} — {explainDeadlineOnly()}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {model.overdue.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-xs text-destructive">
              {model.overdue.length} overdue {model.overdue.length === 1 ? 'deadline' : 'deadlines'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {model.overdue.map((entry) => (
              <button
                key={entry.item.id}
                type="button"
                onClick={() => onOpen(entry.item.id)}
                className="container-chip bg-destructive/10 text-destructive"
              >
                {entry.item.title}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {headers.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="border-b px-2 py-1 text-left text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: range.days.length / 7 }, (_, week) => (
              <tr key={week}>
                {range.days.slice(week * 7, week * 7 + 7).map((day) => {
                  const content = byDate.get(day.date);

                  return (
                    <td
                      key={day.date}
                      className={cn(
                        'min-h-24 min-w-32 border-r border-b p-1 align-top last:border-r-0',
                        // Padding days are dimmed rather than hidden: hiding them
                        // would make the grid jump as you page through months.
                        !day.isInRange && 'bg-muted/40 text-muted-foreground',
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            day.isToday && 'font-semibold text-primary',
                          )}
                        >
                          {formatDayNumber(day.date)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Add something on ${day.date}`}
                          onClick={() => onCreate(day.date)}
                          className="text-[0.625rem] text-muted-foreground hover:text-foreground"
                        >
                          +
                        </button>
                      </div>

                      <div className="flex flex-col gap-1">
                        {(content?.scheduled ?? []).map((entry) => (
                          <ScheduledChip key={entry.item.id} entry={entry} onOpen={onOpen} />
                        ))}
                        {(content?.deadlines ?? []).map((entry) => (
                          <DeadlineChip key={entry.item.id} entry={entry} onOpen={onOpen} />
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScheduledChip({ entry, onOpen }: { entry: DayEntry; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.item.id)}
      className="flex w-full items-center gap-1 rounded bg-[var(--container-calendar)]/15 px-1 py-0.5 text-left text-[0.6875rem] hover:bg-[var(--container-calendar)]/25"
    >
      {!entry.isAllDay ? (
        <span className="shrink-0 font-mono text-[0.625rem]">{entry.time}</span>
      ) : null}
      <span className="truncate">{entry.item.title}</span>
    </button>
  );
}

/**
 * A deadline, drawn dashed and below the schedule.
 *
 * The visual difference from a hard commitment is the entire point of keeping them
 * apart. A deadline that looks like an appointment is a deadline that has stopped
 * being soft.
 */
function DeadlineChip({ entry, onOpen }: { entry: DayEntry; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      title="Soft deadline — not a commitment"
      onClick={() => onOpen(entry.item.id)}
      className="flex w-full items-center gap-1 rounded border border-dashed px-1 py-0.5 text-left text-[0.6875rem] text-muted-foreground hover:text-foreground"
    >
      <span className="truncate">{entry.item.title}</span>
      {entry.isOverdue ? <Badge variant="destructive">overdue</Badge> : null}
    </button>
  );
}

export { todayIso };
