/**
 * The calendar screen.
 *
 * Week and month share one grid, and the mode and anchor live in the URL. Same reason
 * as every other list view: a view of a particular week is something people refer back
 * to — "what did I have on Tuesday" — and it should be a link rather than something
 * reconstructed by clicking backwards.
 *
 * Querying is done for the whole visible range at once rather than per day. A calendar
 * that fires seven requests and renders seven spinners is a calendar that flickers, and
 * it cannot show a day as empty until every request has come back, which is exactly when
 * showing "empty" would be wrong.
 */

import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { CalendarGrid } from '@/components/items/calendar-grid';
import { useItems } from '@/lib/hooks';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { useDocumentTitle } from '@/lib/document-title';
import { buildCalendar, todayIso, type CalendarMode } from '@/lib/calendar';
import { buildCalendarModel } from '@/lib/calendar-model';
import type { FilterNode } from '@/lib/types';

export function CalendarPage() {
  useDocumentTitle('Calendar');

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // The first day of the week is a setting, and the calendar must obey it. Read through
  // a query of its own rather than from the whole settings blob, because the calendar
  // needs one number and should not re-render when anything else changes.
  const settings = useQuery({
    queryKey: keys.settings,
    queryFn: async () => {
      const response = await apiFetch.get<{ settings: Array<{ key: string; value: unknown }> }>(
        '/settings',
      );
      return response.settings;
    },
  });

  const today = todayIso();
  const mode = (searchParams.get('mode') === 'month' ? 'month' : 'week') as CalendarMode;
  const anchor = searchParams.get('anchor') ?? today;

  const weekStartsOn = readWeekStart(settings.data) ?? 1;

  const dates = useMemo(() => {
    const range = buildCalendar({ mode, anchor, weekStartsOn, today });
    return range.days.map((day) => day.date);
  }, [mode, anchor, weekStartsOn, today]);

  /*
   * One query for everything in view: the calendar container plus anything with a hard
   * date. The second part matters — a deadline is not on the calendar, but an item with
   * a hard date belongs there whichever container it happens to be filed in.
   */
  const items = useItems({
    filter: OR(
      { kind: 'condition', field: 'container', operator: 'equals', value: 'calendar' },
      { kind: 'condition', field: 'whenAt', operator: 'is_not_null' },
    ) as FilterNode,
    sort: [{ field: 'whenAt', direction: 'asc', nulls: 'last' }],
    limit: 500,
  });

  const model = useMemo(
    () => buildCalendarModel({ dates, items: items.data?.items ?? [], today }),
    [dates, items.data, today],
  );

  const update = (changes: Record<string, string>): void => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      next.set(key, value);
    }
    // Changing the mode keeps the anchor: "show me March as a month" after looking at
    // one week in March is the same question at a different zoom.
    setSearchParams(next);
  };

  return (
    <Page>
      <PageHeader
        title="Calendar"
        description="Hard commitments only. Deadlines are shown dashed, because they are soft."
      />

      <CalendarGrid
        mode={mode}
        anchor={anchor}
        weekStartsOn={weekStartsOn}
        today={today}
        model={model}
        onModeChange={(next) => update({ mode: next })}
        onAnchorChange={(next) => update({ anchor: next })}
        onOpen={(id) => navigate(`/item/${id}`)}
        onCreate={(date) => navigate(`/capture?date=${date}`)}
      />
    </Page>
  );
}

/**
 * The configured first day of the week.
 *
 * Clamped, because the value comes from the settings table and a hand-edited or
 * out-of-range value would otherwise produce a grid whose headers do not match its
 * columns — which looks like a rendering bug rather than bad data.
 */
function readWeekStart(
  settings: Array<{ key: string; value: unknown }> | undefined,
): number | undefined {
  const entry = settings?.find((setting) => setting.key === 'app.weekStartsOn');
  const value = entry?.value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
    ? value
    : undefined;
}

/** A disjunction of conditions, built here to keep the query readable. */
function OR(...children: FilterNode[]): FilterNode {
  return children.length === 1
    ? (children[0] as FilterNode)
    : { kind: 'group', conjunction: 'or', children };
}
