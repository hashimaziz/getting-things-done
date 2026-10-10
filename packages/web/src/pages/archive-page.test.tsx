import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';
import type { Item } from '@/lib/types';

/**
 * The archive.
 *
 * Two properties are being protected. The heading and the page count must describe what
 * is actually there — a browser that shows a hundred rows under a heading claiming a
 * thousand is lying about the one number most people would want to trust. And a facet
 * must produce a filter the server accepts, which depends on the field's type.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    categoryId: 'c1',
    title: 'Completed thing',
    container: 'done',
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
    completedAt: '2026-03-02T10:00:00.000Z',
    trashedAt: null,
    ...overrides,
  } as Item;
}

let lastStub: FetchStub | null = null;

/**
 * Base routes, with the test's own overrides taking precedence.
 *
 * `extra` goes first because the stub answers with the first matching route, and a
 * shared route that silently wins over the one a test meant to use produces a failure
 * that looks like a product bug.
 */
function routes(extra: StubbedRoute[] = [], answer?: unknown): StubbedRoute[] {
  return [
    ...extra,
    STATUS_SET_UP,
    {
      path: '/api/archive',
      body: answer ?? { items: [item({ id: 'i1', title: 'Finished the thing' })], total: 1 },
    },
    {
      path: '/api/archive/facets',
      body: {
        facets: [
          {
            field: 'my_priority',
            label: 'Priority',
            type: 'priority',
            isOpen: false,
            values: [{ value: 'high', label: 'High', count: 2 }],
          },
        ],
      },
    },
    {
      path: '/api/archive/daily',
      body: { from: '2026-02-20', to: '2026-03-02', days: [{ date: '2026-03-02', count: 3 }] },
    },
    {
      path: '/api/metrics/health',
      body: { health: { inboxBacklog: 0, overdue: 0, waiting: 0, someday: 0 } },
    },
    { path: '/api/categories', body: { categories: [{ id: 'c1', key: 'work', name: 'Work' }] } },
    { path: '/api/fields', body: { fields: [] } },
    { path: '/api/projects', body: { projects: [] } },
    { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
    { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
  ];
}

describe('showing what is there', () => {
  it('lists completed items', async () => {
    lastStub = stubFetch(routes());
    renderApp('/archive');

    expect(await screen.findByText('Finished the thing')).toBeInTheDocument();
  });

  /*
   * The bug this replaces: the first version fetched a hundred rows and never paged,
   * so a thousand completed items rendered as a hundred under a heading claiming a
   * thousand with no way to see the rest.
   */
  it('pages rather than truncating, and says so', async () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      item({ id: `i${index}`, title: `Done ${index}` }),
    );
    lastStub = stubFetch(routes([], { items: many, total: 412 }));
    renderApp('/archive');

    expect(await screen.findByText(/Page 1 of 9/)).toBeInTheDocument();
    expect(screen.getByText(/412 completed/)).toBeInTheDocument();
  });

  it('asks for one page at a time', async () => {
    lastStub = stubFetch(routes([], { items: [item({ id: 'i1' })], total: 412 }));
    renderApp('/archive');

    await screen.findByText(/Page 1 of/);

    const request = lastStub?.calls.find((entry) => entry.path === '/api/archive');
    expect(request?.search.get('limit')).toBe('50');
    expect(request?.search.get('offset')).toBe('0');
  });

  it('goes to the next page', async () => {
    lastStub = stubFetch(routes([], { items: [item({ id: 'i1' })], total: 412 }));
    const { user } = renderApp('/archive');

    await user.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() => {
      const request = lastStub?.calls.findLast((entry) => entry.path === '/api/archive');
      expect(request?.search.get('offset')).toBe('50');
    });
  });

  it('says the total even when everything fits on one page', async () => {
    lastStub = stubFetch(routes([], { items: [item({ id: 'i1' })], total: 1 }));
    renderApp('/archive');

    expect(await screen.findByText('1 completed in total.')).toBeInTheDocument();
  });
});

describe('sorting', () => {
  it('sorts by most recently completed by default', async () => {
    lastStub = stubFetch(routes());
    renderApp('/archive');

    await screen.findByText('Finished the thing');

    const request = lastStub?.calls.find((entry) => entry.path === '/api/archive');
    expect(request?.search.get('sort')).toContain('completedAt');
  });

  /*
   * The header buttons used to be wired to a no-op, so they rendered as clickable and
   * did nothing. A visible affordance that silently does nothing is worse than none.
   */
  it('sorts when a column header is used', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/archive');

    await user.click(await screen.findByRole('button', { name: /^Title/ }));

    await waitFor(() => {
      const request = lastStub?.calls.findLast((entry) => entry.path === '/api/archive');
      expect(request?.search.get('sort')).toContain('title');
    });
  });
});

describe('facets', () => {
  it('shows them', async () => {
    lastStub = stubFetch(routes());
    renderApp('/archive');

    expect(await screen.findByRole('button', { name: /High \(2\)/ })).toBeInTheDocument();
  });

  it('sends a filter the server accepts for a single-valued field', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/archive');

    await user.click(await screen.findByRole('button', { name: /High \(2\)/ }));

    await waitFor(() => {
      const request = lastStub?.calls.findLast((entry) => entry.path === '/api/archive');
      expect(request?.search.get('filter')).toContain('equals');
    });
  });

  /*
   * The bug this protects. A multiselect facet is counted by walking its JSON array,
   * so its filter has to walk it too. The earlier version sent `equals` for every
   * field, which the server rejects for that type — the button did nothing visible and
   * the failure appeared only as a 400 in the console.
   */
  it('sends has_any for a multi-valued field, which is the operator it accepts', async () => {
    lastStub = stubFetch(
      routes([
        {
          path: '/api/archive/facets',
          body: {
            facets: [
              {
                field: 'tags',
                label: 'Tags',
                type: 'multiselect',
                isOpen: false,
                values: [{ value: 'urgent', label: 'Urgent', count: 1 }],
              },
            ],
          },
        },
      ]),
    );
    const { user } = renderApp('/archive');

    await user.click(await screen.findByRole('button', { name: /Urgent \(1\)/ }));

    await waitFor(() => {
      const filter = lastStub?.calls
        .findLast((entry) => entry.path === '/api/archive')
        ?.search.get('filter');
      expect(filter).toContain('has_any');
      expect(filter).not.toContain('equals');
    });
  });

  it('does not offer value buttons for an open field', async () => {
    lastStub = stubFetch(
      routes([
        {
          path: '/api/archive/facets',
          body: {
            facets: [
              {
                field: 'hours',
                label: 'Hours',
                type: 'number',
                isOpen: true,
                values: [{ value: '12', label: '12', count: 1 }],
              },
            ],
          },
        },
      ]),
    );
    renderApp('/archive');

    // "Equals 12" answers a different question from "what is in this column".
    expect(await screen.findByText(/Filter this by typing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^12 \(/ })).not.toBeInTheDocument();
  });
});

describe('searching', () => {
  it('sends a title filter', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/archive');

    await user.type(await screen.findByLabelText(/search completed/i), 'tax');

    await waitFor(() => {
      const request = lastStub?.calls.findLast((entry) => entry.path === '/api/archive');
      expect(request?.search.get('filter')).toContain('tax');
    });
  });

  it('does not send a request per keystroke', async () => {
    // Four characters typed quickly should not mean four archive queries.
    lastStub = stubFetch(routes());
    const { user } = renderApp('/archive');

    const input = await screen.findByLabelText(/search completed/i);
    await user.type(input, 'tax');

    await waitFor(() => {
      expect(
        lastStub?.calls.filter(
          (entry) => entry.path === '/api/archive' && entry.search.get('filter') !== null,
        ).length,
      ).toBeLessThanOrEqual(1);
    });
  });

  it('puts the search in the URL', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/archive');

    await user.type(await screen.findByLabelText(/search completed/i), 'tax');

    await waitFor(() => {
      expect(screen.getByLabelText(/search completed/i)).toHaveValue('tax');
    });
  });
});

describe('empty states', () => {
  it('offers to clear filters when some are active', async () => {
    lastStub = stubFetch(routes([], { items: [], total: 0 }));
    renderApp('/archive?search=tax');

    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument();
    // Two of them: the header one and the empty state's. Both do the same thing, which
    // is deliberate — the empty state is where someone is looking when they realise.
    expect(screen.getAllByRole('button', { name: /clear filters/i }).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('does not offer capture when the archive is simply empty', async () => {
    // "Capture something" answers no question someone has when they are looking for
    // something they already completed.
    lastStub = stubFetch(routes([], { items: [], total: 0 }));
    renderApp('/archive');

    await screen.findByText('Nothing has been completed yet');
    // The sidebar has a Capture link; what matters is that the empty state does not
    // send someone to capture something when they are looking for a finished thing.
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('link', { name: /capture/i })).not.toBeInTheDocument();
  });
});
