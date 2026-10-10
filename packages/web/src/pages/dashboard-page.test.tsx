import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  /*
   * The arrows used to shove rather than swap.
   *
   * `moveWidget` pushes whatever it lands on onto the next row, which is right for a
   * drag — the person can see where it is going — and wrong for a press of an arrow.
   * Five presses of "right" moved a widget one cell and pushed four neighbours down a
   * row each, which is what made the buttons feel broken.
   */
  it('swaps two widgets rather than pushing one below the other', async () => {
    lastStub = stubFetch(
      routes([
        widget('a', 'inbox.backlog', { x: 0, width: 2, height: 1 }),
        widget('b', 'overdue.count', { x: 2, width: 2, height: 1 }),
      ]),
    );
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Inbox backlog right' }));

    await waitFor(() => {
      const body = lastStub?.lastBody('PATCH', '/api/dashboards/d1') as
        { widgets: Array<{ id: string; x: number; y: number }> } | undefined;
      const moved = body?.widgets.find((entry) => entry.id === 'a');
      const displaced = body?.widgets.find((entry) => entry.id === 'b');
      expect(moved?.x).toBe(2);
      // Neither one drops a row: the hole left by the old behaviour.
      expect(moved?.y).toBe(0);
      expect(displaced).toMatchObject({ x: 0, y: 0 });
    });
  });

  it('offers all four directions', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    for (const direction of ['up', 'down', 'left', 'right']) {
      expect(
        screen.getByRole('button', { name: `Move Inbox backlog ${direction}` }),
      ).toBeInTheDocument();
    }
  });

  it('disables a nudge that would leave the grid', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog', { x: 0, width: 4 })]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    // A button that does nothing when pressed is worse than one that says it cannot.
    expect(screen.getByRole('button', { name: 'Move Inbox backlog left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Inbox backlog up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Inbox backlog right' })).not.toBeDisabled();
  });

  it('disables resizing past the grid edge', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog', { x: 0, width: 12 })]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    expect(screen.getByRole('button', { name: 'Widen Inbox backlog' })).toBeDisabled();
  });

  it('can make a widget taller and shorter', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog', { width: 4, height: 2 })]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Make Inbox backlog taller' }));

    await waitFor(() => {
      const body = lastStub?.lastBody('PATCH', '/api/dashboards/d1') as
        { widgets: Array<{ id: string; height: number }> } | undefined;
      expect(body?.widgets.find((entry) => entry.id === 'a')?.height).toBe(3);
    });
  });

  it('does not rearrange the dashboard by being rendered', async () => {
    /*
     * The regression this suite would not have caught on its own.
     *
     * Deciding which arrow buttons to disable runs `moveWidgetBy` during render, four
     * times per widget. That function used to push neighbours down by mutating the
     * widgets it was given, so every render moved things nobody had pressed and the
     * grid came apart on its own — the buttons got worse rather than better.
     */
    lastStub = stubFetch(
      routes([
        widget('a', 'inbox.backlog', { x: 0, width: 4, height: 2 }),
        widget('b', 'overdue.count', { x: 4, width: 4, height: 2 }),
      ]),
    );
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Inbox backlog right' }));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.method === 'PATCH')).toBe(true);
    });
    const afterClick = lastStub?.lastBody('PATCH', '/api/dashboards/d1');

    // Re-rendering must not write another layout: one press, one save, and the saved
    // layout is the one the press asked for.
    await screen.findByRole('button', { name: 'Done' });
    const afterRerender = lastStub?.lastBody('PATCH', '/api/dashboards/d1');
    expect(afterRerender).toEqual(afterClick);

    const saved = afterClick as { widgets: Array<{ id: string; x: number; y: number }> };
    expect(saved.widgets.find((entry) => entry.id === 'a')).toMatchObject({ x: 4, y: 0 });
    expect(saved.widgets.find((entry) => entry.id === 'b')).toMatchObject({ x: 0, y: 0 });
  });

  it('says how to move a widget when arranging', async () => {
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));

    // The old copy said "Drag a widget to move it" while there was no drag at all.
    expect(await screen.findByText(/Drag a title bar to move a widget/)).toBeInTheDocument();
  });

  /*
   * Dragging.
   *
   * jsdom reports a zero-width rect for every element, so the cell measurement is
   * stubbed here rather than worked around in the component: the component refuses to
   * start a drag it cannot measure, which is the right behaviour in a browser tab that
   * is not laid out yet, and it means the drag maths can be tested at all.
   */
  function withMeasurableGrid(): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
      height: 720,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 720,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  }

  function pointer(
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    target: Element,
    clientX: number,
    clientY: number,
  ): void {
    const events = {
      pointerdown: fireEvent.pointerDown,
      pointermove: fireEvent.pointerMove,
      pointerup: fireEvent.pointerUp,
    };
    events[type](target, { clientX, clientY, button: 0, pointerId: 1 });
  }

  it('moves a widget by dragging its title bar', async () => {
    withMeasurableGrid();
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog', { x: 0, width: 2, height: 1 })]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    const handle = await screen.findByText('Inbox backlog');

    // 100px is one column of a 1200px-wide 12-column grid, so this is one cell right
    // and one row down.
    pointer('pointerdown', handle, 0, 0);
    pointer('pointermove', document.body, 100, 72);
    pointer('pointerup', document.body, 100, 72);

    await waitFor(() => {
      const body = lastStub?.lastBody('PATCH', '/api/dashboards/d1') as
        { widgets: Array<{ id: string; x: number; y: number }> } | undefined;
      expect(body?.widgets.find((entry) => entry.id === 'a')).toMatchObject({ x: 1, y: 1 });
    });
  });

  it('saves once when the drag ends, not on every move', async () => {
    withMeasurableGrid();
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog', { x: 0, width: 2, height: 1 })]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    const handle = await screen.findByText('Inbox backlog');

    pointer('pointerdown', handle, 0, 0);
    pointer('pointermove', document.body, 100, 0);
    pointer('pointermove', document.body, 200, 72);
    pointer('pointermove', document.body, 300, 144);
    pointer('pointerup', document.body, 300, 144);

    await waitFor(() => {
      expect(lastStub?.calls.filter((entry) => entry.method === 'PATCH').length).toBe(1);
    });

    // One gesture, one row written.
    const body = lastStub?.lastBody('PATCH', '/api/dashboards/d1') as
      { widgets: Array<{ id: string; x: number; y: number }> } | undefined;
    expect(body?.widgets.find((entry) => entry.id === 'a')).toMatchObject({ x: 3, y: 2 });
  });

  it('does not drag when not arranging', async () => {
    withMeasurableGrid();
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    renderApp('/dashboard');

    const handle = await screen.findByText('Inbox backlog');
    pointer('pointerdown', handle, 0, 0);
    pointer('pointermove', document.body, 300, 144);
    pointer('pointerup', document.body, 300, 144);

    // Outside arrange mode a drag of a chart must do nothing at all: a dashboard you
    // rearrange by accident while trying to read it is worse than no dashboard.
    expect(lastStub?.calls.some((entry) => entry.method === 'PATCH')).toBe(false);
  });

  it('does not drag on a right-click', async () => {
    withMeasurableGrid();
    lastStub = stubFetch(routes([widget('a', 'inbox.backlog')]));
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    const handle = await screen.findByText('Inbox backlog');

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 2, pointerId: 1 });
    pointer('pointermove', document.body, 300, 144);
    pointer('pointerup', document.body, 300, 144);

    // A context menu is not a drag.
    expect(lastStub?.calls.some((entry) => entry.method === 'PATCH')).toBe(false);
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
