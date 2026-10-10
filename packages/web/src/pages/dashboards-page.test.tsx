import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type StubbedRoute } from '@/test/fetch-stub';
import type { Dashboard } from '@/lib/types';

/**
 * Setting up a dashboard.
 *
 * The backend for this was finished and tested long before anything could reach it:
 * the settings screen was a placeholder saying so, and the dashboard screen showed
 * the default with no way to see another. These tests cover the path that was missing
 * end to end — create, rename, duplicate, choose which one opens on launch, delete —
 * because "the endpoints exist" was exactly the mistake that hid this.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

const SHELL = [
  {
    path: '/api/metrics/health',
    body: { health: { inboxBacklog: 0, overdue: 0, waiting: 0, someday: 0 } },
  },
  { path: '/api/categories', body: { categories: [] } },
  { path: '/api/fields', body: { fields: [] } },
];

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    id: 'd1',
    key: 'main',
    name: 'Main',
    widgets: [
      { id: 'w1', type: 'health.summary', title: null, x: 0, y: 0, width: 4, height: 2, props: {} },
    ],
    isDefault: true,
    sortOrder: 0,
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    ...overrides,
  };
}

function routes(extra: StubbedRoute[] = [], list: Dashboard[] = [dashboard()]): StubbedRoute[] {
  return [
    STATUS_SET_UP,
    ...SHELL,
    { path: '/api/dashboards', body: { dashboards: list } },
    {
      path: '/api/dashboards',
      method: 'POST',
      body: { dashboard: dashboard({ id: 'd2', name: 'New' }) },
    },
    { path: '/api/dashboards/:id', method: 'PATCH', body: { dashboard: dashboard() } },
    { path: '/api/dashboards/:id', method: 'DELETE', status: 204, body: null },
    ...extra,
  ];
}

describe('creating a dashboard', () => {
  it('says there are none, rather than showing an empty list', async () => {
    stubFetch(routes([], []));
    renderApp('/settings/dashboards');

    expect(await screen.findByText('No dashboards yet')).toBeInTheDocument();
  });

  it('will not create one with no name', async () => {
    const stub = stubFetch(routes());
    renderApp('/settings/dashboards');

    await screen.findByText('Main');
    // Asked for, not sent: an empty name is not a request worth making.
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(stub.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('creates one with a name', async () => {
    const stub = stubFetch(routes());
    const { user } = renderApp('/settings/dashboards');

    await screen.findByText('Main');
    await user.type(screen.getByLabelText('Name'), 'Morning review');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(
        stub.calls.some((call) => call.method === 'POST' && call.path === '/api/dashboards'),
      ).toBe(true);
    });
    expect(stub.lastBody('POST', '/api/dashboards')?.['name']).toBe('Morning review');
  });

  it('starts it with widgets, because an empty grid teaches nothing', async () => {
    const stub = stubFetch(routes());
    const { user } = renderApp('/settings/dashboards');

    await screen.findByText('Main');
    await user.type(screen.getByLabelText('Name'), 'Morning review');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(stub.lastBody('POST', '/api/dashboards')).toBeDefined();
    });
    const widgets = stub.lastBody('POST', '/api/dashboards')?.['widgets'] as Array<{
      type: string;
    }>;
    expect(widgets.length).toBeGreaterThan(0);
  });

  it('does not contain a widget the app cannot render', async () => {
    const stub = stubFetch(routes());
    const { user } = renderApp('/settings/dashboards');

    await screen.findByText('Main');
    await user.type(screen.getByLabelText('Name'), 'Morning review');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(stub.lastBody('POST', '/api/dashboards')).toBeDefined();
    });
    // A type the registry does not know renders as an empty box forever, and the
    // server will happily store it because it does not know the registry either.
    const known = ['health.summary', 'inbox.backlog', 'overdue.count', 'waiting.count'];
    const widgets = stub.lastBody('POST', '/api/dashboards')?.['widgets'] as Array<{
      type: string;
    }>;
    for (const widget of widgets) {
      expect(known).toContain(widget.type);
    }
  });
});

describe('managing dashboards', () => {
  it('renames one in place', async () => {
    const stub = stubFetch(routes());
    const { user } = renderApp('/settings/dashboards');

    const field = await screen.findByLabelText('Rename Main');
    await user.clear(field);
    await user.type(field, 'Everything');
    await user.tab();

    await waitFor(() => {
      expect(
        stub.calls.some((call) => call.method === 'PATCH' && call.path === '/api/dashboards/d1'),
      ).toBe(true);
    });
    expect(stub.lastBody('PATCH', '/api/dashboards/d1')?.['name']).toBe('Everything');
  });

  it('puts the name back rather than saving an empty one', async () => {
    const stub = stubFetch(routes());
    const { user } = renderApp('/settings/dashboards');

    const field = await screen.findByLabelText('Rename Main');
    await user.clear(field);
    await user.tab();

    // An unnamed dashboard is indistinguishable from a broken one in the list.
    expect((field as HTMLInputElement).value).toBe('Main');
    expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('chooses which one opens on launch', async () => {
    const stub = stubFetch(
      routes(
        [],
        [
          dashboard({ id: 'd1', name: 'Main', isDefault: true }),
          dashboard({ id: 'd2', key: 'work', name: 'Work', isDefault: false }),
        ],
      ),
    );
    const { user } = renderApp('/settings/dashboards');

    await screen.findByText('Work');
    await user.click(screen.getAllByRole('button', { name: /Open on launch/ })[0] as HTMLElement);

    await waitFor(() => {
      expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
    expect(stub.lastBody('PATCH', '/api/dashboards/d2')?.['isDefault']).toBe(true);
  });

  it('marks the current default rather than offering to change it to itself', async () => {
    stubFetch(routes());
    renderApp('/settings/dashboards');

    await screen.findByText('Main');
    expect(screen.getByRole('button', { name: /Opening dashboard/ })).toBeDisabled();
    expect(screen.getByText('Opens on launch')).toBeInTheDocument();
  });

  it('duplicates one under a name that says what it is', async () => {
    const stub = stubFetch(routes());
    const { user } = renderApp('/settings/dashboards');

    await screen.findByText('Main');
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));

    await waitFor(() => {
      expect(stub.lastBody('PATCH', '/api/dashboards/d1')).toBeDefined();
    });
    expect(stub.lastBody('PATCH', '/api/dashboards/d1')?.['name']).toBe('Main copy');
  });

  it('deletes one', async () => {
    const stub = stubFetch(routes());
    const { user } = renderApp('/settings/dashboards');

    await screen.findByText('Main');
    await user.click(screen.getByRole('button', { name: 'Delete Main' }));

    await waitFor(() => {
      expect(
        stub.calls.some((call) => call.method === 'DELETE' && call.path === '/api/dashboards/d1'),
      ).toBe(true);
    });
  });

  it('says a dashboard holds no items, so deleting one is not deleting work', async () => {
    stubFetch(routes());
    renderApp('/settings/dashboards');

    // Somebody about to press delete deserves to know what they are not losing.
    await screen.findByText('Main');
    expect(screen.getByText(/removes the arrangement, not any items/i)).toBeInTheDocument();
  });
});

describe('reaching the dashboard', () => {
  it('offers a way to set one up when there is none', async () => {
    stubFetch(routes([], []));
    renderApp('/dashboard');

    // The old empty state pointed at the settings screen, which was a placeholder
    // saying this feature was not built yet.
    expect(await screen.findByText('No dashboard yet')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Set up a dashboard/ }));
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
  });

  it('shows the default when the path names none', async () => {
    stubFetch(routes());
    renderApp('/dashboard');

    expect(await screen.findByText('Main')).toBeInTheDocument();
  });

  it('shows the one the path names', async () => {
    stubFetch(
      routes(
        [],
        [
          dashboard({ id: 'd1', name: 'Main', isDefault: true }),
          dashboard({ id: 'd2', key: 'work', name: 'Work', isDefault: false }),
        ],
      ),
    );
    renderApp('/dashboard/d2');

    // Without this there was one dashboard and no way to reach the others.
    expect(await screen.findByRole('heading', { name: 'Work' })).toBeInTheDocument();
  });

  it('offers a switcher once there is more than one', async () => {
    stubFetch(
      routes(
        [],
        [
          dashboard({ id: 'd1', name: 'Main', isDefault: true }),
          dashboard({ id: 'd2', key: 'work', name: 'Work', isDefault: false }),
        ],
      ),
    );
    renderApp('/dashboard');

    expect(await screen.findByLabelText('Dashboard')).toBeInTheDocument();
  });

  it('offers no switcher for a single dashboard', async () => {
    stubFetch(routes());
    renderApp('/dashboard');

    await screen.findByText('Main');
    // A dropdown with one option is a control that exists only to be looked at.
    expect(screen.queryByLabelText('Dashboard')).toBeNull();
  });
});
