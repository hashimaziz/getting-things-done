import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';

/**
 * The dashboard.
 *
 * The property worth protecting is that one set of numbers fills every widget. Ten
 * widgets each fetching health would be ten requests and ten chances to show six
 * different values for the same thing, if two of them were in flight at different
 * moments.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

const HEALTH = {
  inboxBacklog: 4,
  inboxOldest: '2026-02-20',
  overdue: 2,
  dueSoon: 1,
  scheduledOn: '2026-03-02',
  scheduledCount: 3,
  waiting: 5,
  waitingOverdue: 1,
  waitingOldestDays: 9,
  someday: 12,
  openWithoutEstimate: 7,
  openMinutes: 900,
  openWithoutProject: 3,
};

function widget(id: string, type: string, overrides: Record<string, unknown> = {}) {
  return { id, type, title: null, x: 0, y: 0, width: 4, height: 2, props: {}, ...overrides };
}

function dashboard(widgets: unknown[]) {
  return {
    dashboards: [
      {
        id: 'd1',
        key: 'home',
        name: 'Home',
        widgets,
        isDefault: true,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

let lastStub: FetchStub | null = null;

function routes(widgets: unknown[], extra: StubbedRoute[] = []): StubbedRoute[] {
  return [
    STATUS_SET_UP,
    { path: '/api/metrics/health', body: { health: HEALTH } },
    { path: '/api/metrics/throughput', body: { points: [] } },
    { path: '/api/metrics/recent', body: { items: [] } },
    { path: '/api/recommendations', body: { recommendations: [] } },
    { path: '/api/waiting', body: { groups: [] } },
    { path: '/api/categories', body: { categories: [] } },
    { path: '/api/fields', body: { fields: [] } },
    { path: '/api/projects', body: { projects: [] } },
    { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
    { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
    { path: '/api/dashboards', body: dashboard(widgets) },
    { path: '/api/dashboards/:id', method: 'PATCH', body: dashboard(widgets) },
    { path: '/api/items/:id', body: { item: { id: 'i1', title: 'A thing' } } },
    { path: '/api/items/:id/history', body: { entries: [] } },
    ...extra,
  ];
}

describe('rendering', () => {
  it('shows the dashboard name', async () => {
    lastStub = stubFetch(routes([widget('a', 'health.summary')]));
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('renders a widget by its type', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    renderApp('/dashboard');

    expect(await screen.findByText('Inbox')).toBeInTheDocument();
  });

  it('shows the numbers from one health response', async () => {
    lastStub = stubFetch(
      routes([widget('a', 'inbox.backlog'), widget('b', 'overdue.count', { x: 4 })]),
    );
    const { user } = renderApp('/dashboard');

    // Waiting on the arrange button rather than the word "Inbox": the sidebar says
    // Inbox too, so a text query would pass before the dashboard had loaded at all.
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    // Two tiles, one request, two tiles that agree.
    expect(screen.getByText('Inbox backlog')).toBeInTheDocument();
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(lastStub?.calls.filter((entry) => entry.path === '/api/metrics/health')).toHaveLength(1);
  });

  it('asks for health once even when four widgets want it', async () => {
    lastStub = stubFetch(
      routes([
        widget('a', 'health.summary'),
        widget('b', 'inbox.backlog', { x: 4 }),
        widget('c', 'overdue.count', { x: 6 }),
        widget('d', 'waiting.count', { x: 8 }),
      ]),
    );
    renderApp('/dashboard');

    await screen.findByText('Inbox');
    expect(lastStub?.calls.filter((entry) => entry.path === '/api/metrics/health')).toHaveLength(1);
  });

  it('does not fetch what no widget needs', async () => {
    // A dashboard with no throughput chart should not pay for throughput.
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    expect(lastStub?.calls.some((entry) => entry.path === '/api/metrics/throughput')).toBe(false);
  });

  it('fetches throughput when a chart is present', async () => {
    lastStub = stubFetch(routes([widget('a', 'throughput.chart')]));
    const { user } = renderApp('/dashboard');
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    await screen.findByText('Completed per day');
    expect(lastStub?.calls.some((entry) => entry.path === '/api/metrics/throughput')).toBe(true);
  });

  it('shows a widget with nothing to show rather than a blank rectangle', async () => {
    // A blank rectangle reads as a broken widget rather than as "there is none today".
    lastStub = stubFetch(routes([widget('a', 'throughput.chart')]));
    const { user } = renderApp('/dashboard');
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    expect(await screen.findByText(/nothing completed in this range yet/i)).toBeInTheDocument();
  });

  it('renders a widget with no data needs without fetching anything for it', async () => {
    lastStub = stubFetch(routes([widget('a', 'quote.method')]));
    const { user } = renderApp('/dashboard');
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    expect(screen.getByText(/The calendar holds only hard landscape/)).toBeInTheDocument();
  });

  it('drops a widget type this build does not know', async () => {
    // A layout saved by a newer version must not wedge the dashboard on an empty hole
    // that cannot be removed, because the remove button is the widget.
    lastStub = stubFetch(
      routes([widget('a', 'quote.method'), widget('b', 'from.the.future', { x: 4 })]),
    );
    renderApp('/dashboard');

    await screen.findByText(/The calendar holds only hard landscape/);
    expect(screen.queryByText(/not one this build knows about/)).not.toBeInTheDocument();
  });

  it('says so when there is no dashboard at all', async () => {
    // The empty list comes first: the stub answers with the first matching route, so
    // appending it after the shared routes would never be reached.
    lastStub = stubFetch([{ path: '/api/dashboards', body: { dashboards: [] } }, ...routes([])]);
    renderApp('/dashboard');

    expect(await screen.findByText('No dashboard yet')).toBeInTheDocument();
  });
});

describe('arranging', () => {
  it('offers an arrange mode', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('lets a widget be moved without a pointer', async () => {
    // Drag is a pointing device's affordance, and a layout only rearrangeable with a
    // mouse is a layout some people cannot arrange at all.
    lastStub = stubFetch([
      ...routes([widget('a', 'inbox.backlog'), widget('b', 'overdue.count', { x: 4 })]),
    ]);
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Inbox backlog right' }));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.method === 'PATCH')).toBe(true);
    });
  });

  it('saves the layout as it is changed', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Widen Inbox backlog' }));

    await waitFor(() => {
      const body = lastStub?.lastBody('PATCH', '/api/dashboards/d1');
      expect(body?.['widgets']).toBeDefined();
    });
  });

  it('offers to remove a widget', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Remove Inbox backlog' }));

    await waitFor(() => {
      const body = lastStub?.lastBody('PATCH', '/api/dashboards/d1') as
        { widgets: Array<{ id: string }> } | undefined;
      expect(body?.widgets ?? []).toHaveLength(0);
    });
  });

  it('offers to add a widget', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.selectOptions(screen.getByLabelText('Add a widget'), 'throughput.chart');

    await waitFor(() => {
      const body = lastStub?.lastBody('PATCH', '/api/dashboards/d1') as
        { widgets: Array<{ type: string }> } | undefined;
      expect(body?.widgets.map((entry) => entry.type)).toContain('throughput.chart');
    });
  });
});

/** A recommendations response with one suggestion, which has an item behind it. */
function recommendationRoutes(): StubbedRoute[] {
  return [
    {
      path: '/api/recommendations',
      body: {
        recommendations: [
          {
            id: 'r1',
            kind: 'suggest_action',
            title: 'Call the dentist',
            detail: '',
            reason: 'It is due today.',
            confidence: 0.8,
            itemId: 'i1',
            tags: [],
            rank: 1,
          },
        ],
      },
    },
  ];
}

describe('acting from a widget', () => {
  it('opens an item from a suggestion', async () => {
    // The suggestion route comes first: the stub answers with the first match, and the
    // shared routes already include an empty recommendations response.
    lastStub = stubFetch([
      ...recommendationRoutes(),
      ...routes([widget('a', 'recommendations.next')]),
    ]);
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByText('Call the dentist'));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.path === '/api/items/i1')).toBe(true);
    });
  });

  it('shows why a suggestion was made', async () => {
    // A suggestion without a reason is indistinguishable from noise, and noise is what
    // makes people ignore a system that is trying to help.
    // The suggestion route comes first: the stub answers with the first match, and the
    // shared routes already include an empty recommendations response.
    lastStub = stubFetch([
      ...recommendationRoutes(),
      ...routes([widget('a', 'recommendations.next')]),
    ]);
    renderApp('/dashboard');

    expect(await screen.findByText('It is due today.')).toBeInTheDocument();
  });
});
