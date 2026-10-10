import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { healthPayload, stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';
import type { FieldDefinition, Item } from '@/lib/types';

/**
 * The item screen.
 *
 * Two things are being protected here. The dynamic editor has to render whatever
 * fields the category actually declares, since "add a field" is supposed to mean
 * "add a field" and not "add a field and edit the app". And the lifecycle actions
 * have to go through the server, because completing an item also stamps a time,
 * writes history and schedules the next occurrence of a recurring series.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

const PRIORITY: FieldDefinition = {
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

const REQUIRED_TEXT: FieldDefinition = {
  ...PRIORITY,
  id: 'f2',
  key: 'reference_number',
  label: 'Reference number',
  type: 'text',
  required: true,
  options: { kind: 'none' },
};

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    categoryId: 'c1',
    title: 'Call the dentist',
    container: 'next_action',
    notes: null,
    whenAt: null,
    deadlineOn: null,
    estimateMinutes: 15,
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

const BASE: StubbedRoute[] = [
  STATUS_SET_UP,
  { path: '/api/metrics/health', body: healthPayload() },
  { path: '/api/categories', body: { categories: [{ id: 'c1', key: 'work', name: 'Work' }] } },
  { path: '/api/fields', body: { fields: [PRIORITY, REQUIRED_TEXT] } },
  { path: '/api/projects', body: { projects: [] } },
  { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
  { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
];

let lastStub: FetchStub | null = null;

function routes(extra: StubbedRoute[] = [], answer: Item = item()): StubbedRoute[] {
  return [
    ...BASE,
    { path: '/api/items/i1', body: { item: answer } },
    { path: '/api/items/i1/history', body: { entries: [] } },
    ...extra,
  ];
}

describe('rendering an item', () => {
  it('shows the title', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    expect(await screen.findByDisplayValue('Call the dentist')).toBeInTheDocument();
  });

  it('names the category in the subtitle', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    expect(await screen.findByText(/Work · next_action/)).toBeInTheDocument();
  });

  it('shows a custom field with its own label and options', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    // The field exists because a definition exists. No code mentions it by name.
    expect(await screen.findByLabelText('My priority')).toBeInTheDocument();
  });

  it('marks a required field as required', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    const field = await screen.findByLabelText('Reference number');
    expect(field.closest('div')?.textContent).toContain('required');
  });

  it('shows the current value of a custom field', async () => {
    lastStub = stubFetch(routes([], item({ values: { my_priority: 'high' } })));
    renderApp('/item/i1');

    // Asserted on the control's value: the stored value is the slug, and the option
    // the person sees is the label.
    expect(await screen.findByLabelText('My priority')).toHaveValue('high');
    expect(screen.getByRole('option', { name: 'High' })).toBeInTheDocument();
  });

  it('says so when an item is not found', async () => {
    lastStub = stubFetch([
      ...BASE,
      {
        path: '/api/items/i1',
        body: { error: { code: 'not_found', message: 'gone' } },
        status: 404,
      },
    ]);
    renderApp('/item/i1');

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });
});

describe('editing', () => {
  it('sends the title when saved', async () => {
    // The required field is filled in, otherwise the save is refused before it is
    // ever sent and this test would pass without the request happening.
    lastStub = stubFetch([
      ...routes([], item({ values: { reference_number: 'ABC' } })),
      { path: '/api/items/i1', method: 'PATCH', body: { item: item() } },
    ]);
    const { user } = renderApp('/item/i1');

    const title = await screen.findByDisplayValue('Call the dentist');
    await user.clear(title);
    await user.type(title, 'Call the dentist twice');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = lastStub?.calls.find(
        (entry) => entry.method === 'PATCH' && entry.path === '/api/items/i1',
      );
      expect(call).toBeTruthy();
    });
  });

  it('refuses to save while a required field is empty, and says which', async () => {
    lastStub = stubFetch([...routes()]);
    const { user } = renderApp('/item/i1');

    await screen.findByDisplayValue('Call the dentist');
    // Saving anyway would be rejected by the server, losing everything typed.
    await user.click(screen.getByRole('button', { name: 'Saved' }));
    await user.click(screen.getByRole('button', { name: 'Saved' }));

    expect(await screen.findByText('Reference number is required.')).toBeInTheDocument();
    expect(lastStub?.calls.some((entry) => entry.method === 'PATCH')).toBe(false);
  });

  it('offers to save only once something has changed', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  it('shows the estimate in minutes', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    expect(await screen.findByLabelText('Estimate (minutes)')).toHaveValue(15);
  });

  it('labels the deadline as soft, because it is', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    // A person under pressure will otherwise assume the date on screen is a promise,
    // and put something on the calendar to make sure.
    expect(await screen.findByText('Deadline (soft)')).toBeInTheDocument();
  });
});

describe('lifecycle actions', () => {
  it('completes through the move endpoint, not a patch', async () => {
    lastStub = stubFetch([
      ...routes(),
      { path: '/api/items/i1/move', method: 'POST', body: { item: item() } },
    ]);
    const { user } = renderApp('/item/i1');

    await user.click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      const call = lastStub?.calls.find((entry) => entry.path === '/api/items/i1/move');
      expect(call?.method).toBe('POST');
    });
  });

  it('trashes', async () => {
    lastStub = stubFetch([
      ...routes(),
      { path: '/api/items/i1/move', method: 'POST', body: { item: item() } },
    ]);
    const { user } = renderApp('/item/i1');

    await user.click(await screen.findByRole('button', { name: 'Trash' }));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.path === '/api/items/i1/move')).toBe(true);
    });
  });

  it('offers to reopen a completed item instead of completing it again', async () => {
    lastStub = stubFetch(
      routes([], item({ container: 'done', completedAt: '2026-03-02T10:00:00.000Z' })),
    );
    renderApp('/item/i1');

    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
  });

  it('offers to restore a trashed item', async () => {
    const trashed = item({ id: 'i1', container: 'trash' });
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items/i1', body: { item: trashed } },
      { path: '/api/items/i1/history', body: { entries: [] } },
    ]);
    renderApp('/item/i1');

    // Named for where the item goes, because "Restore" implies it returns to where it
    // was — and it does not. It comes back to the inbox to be clarified again.
    expect(await screen.findByRole('button', { name: 'Restore to inbox' })).toBeInTheDocument();
  });

  it('restores with the verb the server will accept, not as a move', async () => {
    /*
     * This is the bug. Restore was sent as `move` to next actions, and the server
     * refuses that as an illegal transition — correctly, since trash leads only to the
     * inbox. So the button always failed, and the person was left with an error and no
     * way to get the item back.
     */
    const trashed = item({ container: 'trash', trashedAt: '2026-03-02T10:00:00.000Z' });
    lastStub = stubFetch([
      ...routes([], trashed),
      {
        path: '/api/items/i1/restore',
        method: 'POST',
        body: { item: { ...trashed, container: 'inbox', trashedAt: null } },
      },
      {
        path: '/api/items/i1/move',
        method: 'POST',
        status: 409,
        body: {
          error: {
            code: 'illegal_transition',
            message: 'Cannot move an item from trash to next_action',
          },
        },
      },
    ]);
    const { user } = renderApp('/item/i1');

    await user.click(await screen.findByRole('button', { name: 'Restore to inbox' }));

    await waitFor(() => {
      expect(
        lastStub?.calls.some(
          (call) => call.method === 'POST' && call.path === '/api/items/i1/restore',
        ),
      ).toBe(true);
    });
    expect(lastStub?.calls.some((call) => call.path.endsWith('/move'))).toBe(false);
  });

  it('explains a refused move instead of silently failing', async () => {
    lastStub = stubFetch([
      ...routes(),
      {
        path: '/api/items/i1/move',
        method: 'POST',
        body: { error: { code: 'invalid_transition', message: 'Cannot move from trash to done' } },
        status: 409,
      },
    ]);
    const { user } = renderApp('/item/i1');

    await user.click(await screen.findByRole('button', { name: 'Trash' }));

    // Toasts render outside the container the screen renders into, so the message is
    // looked up on the document rather than inside the page.
    await waitFor(() => {
      expect(document.body.textContent).toContain('Cannot move from trash to done');
    });
  });
});

describe('history', () => {
  it('shows the item history when there is one', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items/i1', body: { item: item() } },
      {
        path: '/api/items/i1/history',
        body: {
          entries: [
            {
              id: 'a1',
              itemId: 'i1',
              verb: 'created',
              at: '2026-03-01T09:00:00.000Z',
              from: null,
              to: null,
            },
            {
              id: 'a2',
              itemId: 'i1',
              verb: 'moved',
              at: '2026-03-02T09:00:00.000Z',
              from: null,
              to: null,
            },
          ],
        },
      },
    ]);
    renderApp('/item/i1');

    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
  });

  it('shows nothing at all when there is no history', async () => {
    lastStub = stubFetch(routes());
    renderApp('/item/i1');

    await screen.findByDisplayValue('Call the dentist');
    expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();
  });

  it('does not break the item when the history cannot be fetched', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items/i1', body: { item: item() } },
      {
        path: '/api/items/i1/history',
        body: { error: { code: 'boom', message: 'no' } },
        status: 500,
      },
    ]);
    renderApp('/item/i1');

    await screen.findByDisplayValue('Call the dentist');
    expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('opens the item from a list row', async () => {
    lastStub = stubFetch([...BASE, { path: '/api/items', body: { items: [item()], total: 1 } }]);
    const { user } = renderApp('/list/next_action');

    await user.click(await screen.findByText('Call the dentist'));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.path === '/api/items/i1')).toBe(true);
    });
  });
});
