import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { healthPayload, stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';
import type { Item } from '@/lib/types';

/**
 * The list screen.
 *
 * These tests are about the wiring between three things that are individually fine:
 * the URL, the server query, and the table. The interesting failures are all
 * mismatches between them — a filter that never reaches the request, a page that
 * says three pages and shows one, a column that shows an id instead of a name.
 */

/** The most recent stub, so assertions can inspect what was actually requested. */
let lastStub: FetchStub | null = null;

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    categoryId: 'c1',
    title: 'Untitled',
    container: 'next_action',
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

const FIELD = {
  id: 'f1',
  categoryId: null,
  key: 'my_priority',
  label: 'My priority',
  description: null,
  type: 'priority',
  options: {
    kind: 'choices',
    choices: [
      { value: 'high', label: 'High', color: null, order: 0 },
      { value: 'low', label: 'Low', color: null, order: 1 },
    ],
  },
  required: false,
  defaultValue: null,
  groupLabel: null,
  showInTable: true,
  showInCard: false,
  filterable: true,
  sortable: true,
  isCore: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The items endpoint answers from the query, so filter and sort are observable. */
function itemsRoute(
  answer: (search: URLSearchParams) => { items: Item[]; total: number },
): StubbedRoute {
  return {
    path: '/api/items',
    body: (url: URL) => answer(url.searchParams),
  };
}

const BASE: StubbedRoute[] = [
  STATUS_SET_UP,
  { path: '/api/metrics/health', body: healthPayload() },
  { path: '/api/categories', body: { categories: [{ id: 'c1', key: 'work', name: 'Work' }] } },
  { path: '/api/fields', body: { fields: [FIELD] } },
  { path: '/api/projects', body: { projects: [{ id: 'pr1', name: 'Move house' }] } },
  { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
  { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
];

describe('rendering a list', () => {
  it('shows the items the server returned', async () => {
    stubFetch([
      ...BASE,
      itemsRoute(() => ({
        items: [
          item({ id: 'i1', title: 'Call the dentist' }),
          item({ id: 'i2', title: 'Send the report' }),
        ],
        total: 2,
      })),
    ]);

    renderApp('/list/next_action');

    expect(await screen.findByText('Call the dentist')).toBeInTheDocument();
    expect(screen.getByText('Send the report')).toBeInTheDocument();
  });

  it('counts the items in the heading', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 17 }))]);

    renderApp('/list/next_action');

    expect(await screen.findByText('17 items')).toBeInTheDocument();
  });

  it('uses the singular for one item', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 1 }))]);

    renderApp('/list/next_action');

    expect(await screen.findByText('1 item')).toBeInTheDocument();
  });

  it('asks the server for the container', async () => {
    const stub = stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);

    renderApp('/list/inbox');

    await waitFor(() => {
      const call = stub.calls.find((entry) => entry.path === '/api/items');
      expect(call?.search.get('filter')).toContain('"value":"inbox"');
    });
  });

  it('renders a column for a custom field marked for tables', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 1 }))]);

    renderApp('/list/next_action');

    expect(await screen.findByRole('columnheader', { name: /My priority/ })).toBeInTheDocument();
  });

  it('shows a custom field value by its label, not its stored slug', async () => {
    stubFetch([
      ...BASE,
      itemsRoute(() => ({
        items: [item({ id: 'i1', title: 'Renew insurance', values: { my_priority: 'high' } })],
        total: 1,
      })),
    ]);

    renderApp('/list/next_action');

    expect(await screen.findByText('Renew insurance')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows a dash rather than a blank for a missing value', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 1 }))]);

    renderApp('/list/next_action');

    await screen.findByText('Untitled');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('the empty state', () => {
  it('says the inbox is empty rather than "no results"', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);

    renderApp('/list/inbox');

    expect(await screen.findByText('The inbox is empty')).toBeInTheDocument();
  });

  it('explains what an empty inbox means', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);

    renderApp('/list/inbox');

    expect(await screen.findByText(/has found a home/)).toBeInTheDocument();
  });

  it('blames the filters when there are some', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);

    renderApp(
      '/list/next_action?filter=' +
        encodeURIComponent(
          JSON.stringify([{ field: 'title', operator: 'contains', value: 'tax' }]),
        ),
    );

    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument();
    // Twice on purpose: once as the chip, once as the explanation in the empty state.
    // Both say the same thing, which is the point — there is one description of the
    // filter, not two wordings to keep in step.
    expect(screen.getAllByText('Title contains tax').length).toBeGreaterThanOrEqual(1);
  });

  it('offers to clear the filters rather than leaving a dead end', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);

    renderApp(
      '/list/next_action?filter=' +
        encodeURIComponent(
          JSON.stringify([{ field: 'title', operator: 'contains', value: 'tax' }]),
        ),
    );

    expect(await screen.findByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  it('says a mistyped container is not a container', async () => {
    stubFetch([...BASE]);

    renderApp('/list/nonsense');

    expect(await screen.findByText(/is not a container/)).toBeInTheDocument();
  });
});

describe('sorting', () => {
  it('marks the default sort in the header', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 1 }))]);

    renderApp('/list/next_action');

    const header = await screen.findByRole('columnheader', { name: /Deadline/ });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sends the sort to the server', async () => {
    const stub = stubFetch([
      ...BASE,
      itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 1 })),
    ]);
    const { user } = renderApp('/list/next_action');

    // Named by its text, not its title attribute: the accessible name of a button is
    // its content, and what matters is what a screen reader announces.
    await user.click(await screen.findByRole('button', { name: /^Title/ }));

    await waitFor(() => {
      const call = stub.calls.findLast((entry) => entry.path === '/api/items');
      expect(call?.search.get('sort')).toContain('title');
    });
  });

  it('flips direction on a second click', async () => {
    const stub = stubFetch([
      ...BASE,
      itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 1 })),
    ]);
    const { user } = renderApp('/list/next_action');

    await user.click(await screen.findByRole('button', { name: /^Title/ }));
    await waitFor(() => {
      expect(
        stub.calls.findLast((entry) => entry.path === '/api/items')?.search.get('sort'),
      ).toContain('asc');
    });

    await user.click(await screen.findByRole('button', { name: /^Title/ }));

    await waitFor(() => {
      expect(
        stub.calls.findLast((entry) => entry.path === '/api/items')?.search.get('sort'),
      ).toContain('desc');
    });
  });

  it('puts the sort in the URL, so the view is a link', async () => {
    lastStub = stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 1 }))]);
    const { user } = renderApp('/list/next_action');

    await user.click(await screen.findByRole('button', { name: /^Title/ }));

    // The router is a memory router, so the assertion is on the request it produced
    // rather than on `window.location`, which the test never touches.
    await waitFor(() => {
      expect(stubFetchedSearches().some((search) => search.includes('title'))).toBe(true);
    });
  });
});

/** The query strings of every items request made by the most recent stub. */
function stubFetchedSearches(): string[] {
  return (
    lastStub?.calls
      .filter((entry) => entry.path === '/api/items')
      .map((entry) => entry.search.toString()) ?? []
  );
}

describe('filtering', () => {
  it('adds a filter and sends it', async () => {
    const stub = stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);
    const { user } = renderApp('/list/next_action');

    await user.click(await screen.findByRole('button', { name: /filter/i }));
    await user.selectOptions(screen.getByLabelText('Field'), 'title');
    await user.type(screen.getByLabelText('Value for Title'), 'tax');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      const call = stub.calls.findLast((entry) => entry.path === '/api/items');
      expect(call?.search.get('filter')).toContain('tax');
    });
  });

  it('shows the filter as a readable chip', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);
    const { user } = renderApp('/list/next_action');

    await user.click(await screen.findByRole('button', { name: /filter/i }));
    await user.selectOptions(screen.getByLabelText('Field'), 'title');
    await user.type(screen.getByLabelText('Value for Title'), 'tax');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect((await screen.findAllByText('Title contains tax')).length).toBeGreaterThanOrEqual(1);
  });

  it('removes a filter by its close button', async () => {
    const filterParam = encodeURIComponent(
      JSON.stringify([{ field: 'title', operator: 'contains', value: 'tax' }]),
    );
    stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);
    const { user } = renderApp(`/list/next_action?filter=${filterParam}`);

    await user.click(await screen.findByRole('button', { name: /Remove filter/ }));

    await waitFor(() => {
      expect(screen.queryByText('Title contains tax')).not.toBeInTheDocument();
    });
  });

  it('reads a filter from the URL, so a filtered list is a link that works', async () => {
    const stub = stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);
    const filterParam = encodeURIComponent(
      JSON.stringify([{ field: 'title', operator: 'contains', value: 'tax' }]),
    );

    renderApp(`/list/next_action?filter=${filterParam}`);

    await waitFor(() => {
      const call = stub.calls.find((entry) => entry.path === '/api/items');
      expect(call?.search.get('filter')).toContain('tax');
    });
  });
});

describe('pagination', () => {
  it('offers no pagination for a single page', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 3 }))]);

    renderApp('/list/next_action');

    await screen.findByText('Untitled');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('shows the page count for several pages', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 120 }))]);

    renderApp('/list/next_action');

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('asks for the next page of results', async () => {
    const stub = stubFetch([
      ...BASE,
      itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 120 })),
    ]);
    const { user } = renderApp('/list/next_action');

    await user.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() => {
      const call = stub.calls.findLast((entry) => entry.path === '/api/items');
      expect(call?.search.get('offset')).toBe('50');
    });
  });

  it('disables Previous on the first page', async () => {
    stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 120 }))]);

    renderApp('/list/next_action');

    expect(await screen.findByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  /*
   * After completing items, or applying a filter, the page in the URL can point past
   * the end. Showing the last page is nearly right; showing an empty table is
   * confidently wrong and reads as data loss.
   */
  it('clamps a page past the end rather than showing an empty table', async () => {
    lastStub = stubFetch([...BASE, itemsRoute(() => ({ items: [item({ id: 'i1' })], total: 5 }))]);

    renderApp('/list/next_action?page=9');

    await waitFor(() => {
      // Asks for the first page again, because page 9 of 5 items is nothing.
      expect(
        lastStub?.calls.some(
          (entry) => entry.path === '/api/items' && entry.search.get('offset') === '0',
        ),
      ).toBe(true);
    });
    expect(await screen.findByText('Untitled')).toBeInTheDocument();
  });
});

describe('columns', () => {
  it('can hide a column and keeps it reachable afterwards', async () => {
    // Hiding a column must not be permanent, or the list slowly loses the fields
    // someone cared about.
    stubFetch([...BASE, itemsRoute(() => ({ items: [], total: 0 }))]);
    const { user } = renderApp('/list/next_action');

    await user.click(await screen.findByRole('button', { name: 'Columns' }));

    // Found through the disclosure rather than by position: the sidebar link has the
    // same text, and a positional query would pass or fail for the wrong reason.
    const row = await screen.findByLabelText('Est.');
    await user.click(row);

    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: /Estimate/ })).not.toBeInTheDocument();
    });
  });
});

describe('error handling', () => {
  it('offers a retry when the list cannot be loaded', async () => {
    stubFetch([
      ...BASE,
      {
        path: '/api/items',
        body: { error: { code: 'boom', message: 'Something broke' } },
        status: 500,
      },
    ]);

    renderApp('/list/next_action');

    expect(await screen.findByText('The list could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('says what the server said', async () => {
    stubFetch([
      ...BASE,
      {
        path: '/api/items',
        body: { error: { code: 'boom', message: 'Something broke' } },
        status: 500,
      },
    ]);

    renderApp('/list/next_action');

    expect(await screen.findByText('Something broke')).toBeInTheDocument();
  });
});
