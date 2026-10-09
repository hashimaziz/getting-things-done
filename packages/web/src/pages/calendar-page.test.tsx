import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { healthPayload, stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';
import type { Item } from '@/lib/types';

/**
 * The calendar screen.
 *
 * The tests are mostly about what is *not* there. A deadline on the calendar is the one
 * thing this screen must never do, and it is the one thing a regression would look
 * perfectly reasonable in a code review.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

function at(day: string, hour: number, minute = 0): string {
  const date = new Date(`${day}T00:00:00`);
  return new Date(date.setHours(hour, minute, 0, 0)).toISOString();
}

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    categoryId: 'c1',
    title: 'Untitled',
    container: 'calendar',
    notes: null,
    whenAt: null,
    deadlineOn: null,
    estimateMinutes: null,
    projectId: null,
    waitingOnPersonId: null,
    followUpAt: null,
    contextIds: [],
    recurrenceId: null,
    parentItemId: null,
    occurrenceDate: null,
    isTemplate: false,
    data: {},
    sortOrder: 0,
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    completedAt: null,
    trashedAt: null,
    ...overrides,
  } as Item;
}

let lastStub: FetchStub | null = null;

function routes(items: Item[], weekStartsOn = 1): StubbedRoute[] {
  return [
    STATUS_SET_UP,
    { path: '/api/metrics/health', body: healthPayload() },
    { path: '/api/categories', body: { categories: [] } },
    { path: '/api/fields', body: { fields: [] } },
    { path: '/api/projects', body: { projects: [] } },
    { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
    { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
    {
      path: '/api/settings',
      body: { settings: [{ key: 'app.weekStartsOn', value: weekStartsOn, updatedAt: '' }] },
    },
    { path: '/api/items', body: { items, total: items.length } },
    { path: '/api/items/:id', body: { item: items[0] ?? item({ id: 'none' }) } },
    { path: '/api/items/:id/history', body: { entries: [] } },
  ];
}

describe('the grid', () => {
  it('shows seven weekday headers', async () => {
    lastStub = stubFetch(routes([]));
    renderApp('/calendar?anchor=2026-03-04');

    await waitFor(() => {
      expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    });
  });

  it('starts the week on Monday by default', async () => {
    lastStub = stubFetch(routes([]));
    renderApp('/calendar?anchor=2026-03-04');

    const headers = await screen.findAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('Mon');
  });

  /*
   * The first day of the week is a setting, and the calendar must obey it. Hard-coding
   * Monday is wrong for the United States, and Sunday is wrong for most of Europe.
   */
  it('starts the week on Sunday when configured to', async () => {
    lastStub = stubFetch(routes([], 0));
    renderApp('/calendar?anchor=2026-03-04');

    // Waited for rather than read on first paint: the grid renders once with the
    // default before the setting arrives, and asserting immediately would be asserting
    // the default.
    await waitFor(() => {
      expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Sun');
    });
  });

  it('switches to a month view', async () => {
    lastStub = stubFetch(routes([]));
    const { user } = renderApp('/calendar?anchor=2026-03-04');

    await user.selectOptions(await screen.findByLabelText('Calendar view'), 'month');

    await waitFor(() => {
      expect(screen.getByText('March 2026')).toBeInTheDocument();
    });
  });

  it('keeps the anchor when the mode changes', async () => {
    // "Show me March as a month" after looking at one week in March is the same
    // question at a different zoom.
    lastStub = stubFetch(routes([]));
    const { user } = renderApp('/calendar?anchor=2026-03-04');

    await user.selectOptions(await screen.findByLabelText('Calendar view'), 'month');

    await waitFor(() => {
      expect(screen.getByText('March 2026')).toBeInTheDocument();
    });
  });

  it('steps forward a week', async () => {
    lastStub = stubFetch(routes([]));
    const { user } = renderApp('/calendar?anchor=2026-03-04');

    await user.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('9–15 Mar 2026')).toBeInTheDocument();
    });
  });

  it('offers to return to today from somewhere else', async () => {
    lastStub = stubFetch(routes([]));
    renderApp('/calendar?anchor=2026-06-01');

    expect(await screen.findByRole('button', { name: 'Today' })).toBeInTheDocument();
  });
});

describe('hard dates on the grid', () => {
  it('shows a scheduled item', async () => {
    lastStub = stubFetch(
      routes([item({ id: 'i1', title: 'Standup', whenAt: at('2026-03-04', 9, 30) })]),
    );
    renderApp('/calendar?anchor=2026-03-04');

    expect(await screen.findByText('Standup')).toBeInTheDocument();
  });

  it('shows the time of a timed item', async () => {
    lastStub = stubFetch(
      routes([item({ id: 'i1', title: 'Standup', whenAt: at('2026-03-04', 9, 30) })]),
    );
    renderApp('/calendar?anchor=2026-03-04');

    expect(await screen.findByText('09:30')).toBeInTheDocument();
  });

  it('asks for everything in view in one request', async () => {
    lastStub = stubFetch(routes([]));
    renderApp('/calendar?anchor=2026-03-04');

    await waitFor(() => {
      expect(lastStub?.calls.filter((entry) => entry.path === '/api/items')).toHaveLength(1);
    });
  });
});

describe('deadlines never sit on the calendar', () => {
  /*
   * The property this screen exists to hold. A deadline that looks like an appointment
   * is a deadline that has stopped being soft, and once someone starts treating the
   * calendar as a to-do list it stops being trusted at all.
   */
  it('does not file a deadline as a scheduled entry', async () => {
    lastStub = stubFetch(
      routes([item({ id: 'i1', title: 'Pay the invoice', deadlineOn: '2026-03-04' })]),
    );
    renderApp('/calendar?anchor=2026-03-04');

    await screen.findByText('Pay the invoice');

    const cell = screen.getByText('Pay the invoice').closest('td');
    const scheduled = cell?.querySelectorAll('.bg-\\[var\\(--container-calendar\\)\\]\\/15');
    expect(scheduled).toHaveLength(0);
  });

  it('marks a deadline as soft where it is shown', async () => {
    lastStub = stubFetch(
      routes([item({ id: 'i1', title: 'Pay the invoice', deadlineOn: '2026-03-04' })]),
    );
    renderApp('/calendar?anchor=2026-03-04');

    const chip = await screen.findByTitle('Soft deadline — not a commitment');
    expect(chip).toHaveTextContent('Pay the invoice');
  });

  it('collects overdue deadlines outside the range', async () => {
    lastStub = stubFetch(
      routes([item({ id: 'i1', title: 'Late thing', deadlineOn: '2026-02-01' })]),
    );
    renderApp('/calendar?anchor=2026-03-04');

    expect(await screen.findByText(/overdue deadline/i)).toBeInTheDocument();
    expect(screen.getByText('Late thing')).toBeInTheDocument();
  });

  it('shows no overdue column when nothing is late', async () => {
    lastStub = stubFetch(routes([]));
    renderApp('/calendar?anchor=2026-03-04');

    await screen.findAllByRole('columnheader');
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });
});

describe('items that belong on neither', () => {
  it('surfaces a calendar item with no hard date instead of hiding it', async () => {
    lastStub = stubFetch(routes([item({ id: 'i1', title: 'Vague commitment' })]));
    renderApp('/calendar?anchor=2026-03-04');

    expect(await screen.findByText(/no hard date/i)).toBeInTheDocument();
    expect(screen.getByText(/Vague commitment/)).toBeInTheDocument();
  });
});

describe('interacting with the grid', () => {
  it('opens an item', async () => {
    lastStub = stubFetch([
      ...routes([item({ id: 'i1', title: 'Standup', whenAt: at('2026-03-04', 9) })]),
    ]);
    const { user } = renderApp('/calendar?anchor=2026-03-04');

    await user.click(await screen.findByText('Standup'));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.path === '/api/items/i1')).toBe(true);
    });
  });

  it('offers to add something on a day, with the date in the label', async () => {
    lastStub = stubFetch(routes([]));
    renderApp('/calendar?anchor=2026-03-04');

    // The date in the accessible name, so the button is distinguishable by voice and
    // by screen reader rather than being seven identical "+" buttons.
    expect(
      await screen.findByRole('button', { name: 'Add something on 2026-03-04' }),
    ).toBeInTheDocument();
  });
});
