import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { healthPayload, stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';
import type { Item } from '@/lib/types';

/**
 * Capture and clarify.
 *
 * Capture has the hardest requirement in the method: it must never ask a question. If
 * capture makes you think, you stop capturing, and an inbox holding only what felt
 * worth typing has already lost things. These tests are mostly about what is *absent*
 * from the capture screen.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

const CATEGORIES = {
  categories: [
    {
      id: 'c1',
      key: 'work',
      name: 'Work',
      description: null,
      color: null,
      icon: null,
      sortOrder: 0,
      isArchived: false,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'c2',
      key: 'home',
      name: 'Home',
      description: null,
      color: null,
      icon: null,
      sortOrder: 1,
      isArchived: false,
      createdAt: '',
      updatedAt: '',
    },
  ],
};

const BASE: StubbedRoute[] = [
  STATUS_SET_UP,
  { path: '/api/metrics/health', body: healthPayload() },
  { path: '/api/categories', body: CATEGORIES },
  { path: '/api/fields', body: { fields: [] } },
  { path: '/api/projects', body: { projects: [] } },
  {
    path: '/api/people',
    body: {
      people: [
        {
          id: 'p1',
          name: 'Dana',
          email: null,
          notes: null,
          categoryId: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
    },
  },
  { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
  { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
];

let lastStub: FetchStub | null = null;

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    categoryId: 'c1',
    title: 'Something to think about',
    container: 'inbox',
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

describe('capture', () => {
  it('has one input', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    renderApp('/capture');

    expect(await screen.findByLabelText('Capture')).toBeInTheDocument();
  });

  /*
   * The property that matters. A capture screen with a container dropdown, a project
   * picker and a date field is a small form, and forms are what people stop using.
   */
  it('asks nothing else about the item', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    renderApp('/capture');

    await screen.findByLabelText('Capture');

    expect(screen.queryByLabelText(/project/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/deadline/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/container/i)).not.toBeInTheDocument();
  });

  it('says why there is nothing else there', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    renderApp('/capture');

    expect(await screen.findByText('Why there is nothing else here')).toBeInTheDocument();
  });

  it('captures on Enter', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    const { user } = renderApp('/capture');

    await user.type(await screen.findByLabelText('Capture'), 'Call the plumber{Enter}');

    await waitFor(() => {
      expect(
        lastStub?.calls.some((entry) => entry.method === 'POST' && entry.path === '/api/items'),
      ).toBe(true);
    });
  });

  it('sends the text that was typed', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    const { user } = renderApp('/capture');

    await user.type(await screen.findByLabelText('Capture'), 'Call the plumber{Enter}');

    await waitFor(() => {
      expect(lastStub?.lastBody('POST', '/api/items')?.['title']).toBe('Call the plumber');
    });
  });

  it('always files into the inbox', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    const { user } = renderApp('/capture');

    await user.type(await screen.findByLabelText('Capture'), 'A thought{Enter}');

    await waitFor(() => {
      expect(lastStub?.lastBody('POST', '/api/items')?.['container']).toBe('inbox');
    });
  });

  it('clears the box after capturing, ready for the next thought', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    const { user } = renderApp('/capture');

    const input = await screen.findByLabelText('Capture');
    await user.type(input, 'One thing{Enter}');

    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('counts what it captured rather than toasting each one', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    const { user } = renderApp('/capture');

    await user.type(await screen.findByLabelText('Capture'), 'One thing{Enter}');

    // A notification per thought is a notification per capture, and notifications are
    // how a capture box becomes something you dismiss.
    expect(await screen.findByText('1 captured')).toBeInTheDocument();
  });

  it('treats Shift+Enter as a newline rather than capturing', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    const { user } = renderApp('/capture');

    const input = await screen.findByLabelText('Capture');
    await user.type(input, 'A thought{Shift>}{Enter}{/Shift}and another line');

    expect(lastStub?.calls.some((entry) => entry.method === 'POST')).toBe(false);
  });

  it('ignores an empty capture', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    const { user } = renderApp('/capture');

    await user.type(await screen.findByLabelText('Capture'), '   {Enter}');

    expect(lastStub?.calls.some((entry) => entry.method === 'POST')).toBe(false);
  });

  it('offers the category choice when there is more than one', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    renderApp('/capture');

    expect(await screen.findByLabelText('Category')).toBeInTheDocument();
  });

  it('hides the category choice when there is only one category', async () => {
    // A control with one option is a question with no answer to give.
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/categories', body: { categories: [CATEGORIES.categories[0]] } },
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    renderApp('/capture');

    await screen.findByLabelText('Capture');
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
  });

  it('points at the inbox', async () => {
    lastStub = stubFetch([
      ...BASE,
      { path: '/api/items', method: 'POST', body: { item: item({ id: 'new' }) } },
    ]);
    renderApp('/capture');

    expect(await screen.findByRole('link', { name: /clarify the inbox/i })).toBeInTheDocument();
  });
});

describe('clarify', () => {
  function inboxRoutes(items: Item[]): StubbedRoute[] {
    return [
      ...BASE,
      { path: '/api/items', body: { items, total: items.length } },
      {
        path: '/api/items/:id/move',
        method: 'POST',
        body: { item: items[0] ?? item({ id: 'x' }) },
      },
    ];
  }

  it('says the inbox is empty when there is nothing to clarify', async () => {
    lastStub = stubFetch(inboxRoutes([]));
    renderApp('/clarify');

    expect(await screen.findByText('The inbox is empty')).toBeInTheDocument();
  });

  it('shows the item being clarified', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1', title: 'Something to think about' })]));
    renderApp('/clarify');

    expect(await screen.findByText('Something to think about')).toBeInTheDocument();
  });

  it('asks the clarifying questions', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    renderApp('/clarify');

    expect(await screen.findByRole('button', { name: 'Is it actionable?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Is it someday / maybe?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Are you waiting on someone?' })).toBeInTheDocument();
  });

  it('offers deleting as an answer, because it is one', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    renderApp('/clarify');

    expect(
      await screen.findByRole('button', { name: 'Do you still need it?' }),
    ).toBeInTheDocument();
  });

  it('moves an actionable thing to next actions', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    const { user } = renderApp('/clarify');

    await user.click(await screen.findByRole('button', { name: 'Is it actionable?' }));

    await waitFor(() => {
      expect(
        lastStub?.calls.some((entry) => entry.path.endsWith('/move') && entry.method === 'POST'),
      ).toBe(true);
    });
  });

  it('refuses delegation without a person, and says which question was skipped', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    const { user } = renderApp('/clarify');

    await user.click(await screen.findByRole('button', { name: 'Are you waiting on someone?' }));

    expect(await screen.findByText('Who is it waiting on?')).toBeInTheDocument();
    expect(lastStub?.calls.some((entry) => entry.path.endsWith('/move'))).toBe(false);
  });

  it('refuses delegation without a follow-up date', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    const { user } = renderApp('/clarify');

    await user.selectOptions(await screen.findByLabelText('Waiting on'), 'p1');
    await user.click(screen.getByRole('button', { name: 'Are you waiting on someone?' }));

    expect(await screen.findByText('When will you chase it?')).toBeInTheDocument();
  });

  it('delegates once both details are given', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    const { user } = renderApp('/clarify');

    await user.selectOptions(await screen.findByLabelText('Waiting on'), 'p1');
    await user.type(screen.getByLabelText('Follow up on'), '2026-03-10');
    await user.click(screen.getByRole('button', { name: 'Are you waiting on someone?' }));

    await waitFor(() => {
      expect(
        lastStub?.calls.some((entry) => entry.path.endsWith('/move') && entry.method === 'POST'),
      ).toBe(true);
    });
  });

  it('previews the delegation in a sentence before it is committed', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    const { user } = renderApp('/clarify');

    await user.selectOptions(await screen.findByLabelText('Waiting on'), 'p1');

    // "Waiting on Dana." is understood instantly; it is the last chance to notice the
    // wrong answer.
    expect(await screen.findByText(/waiting on dana/i)).toBeInTheDocument();
  });

  it('moves a reference item to reference', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    const { user } = renderApp('/clarify');

    await user.click(await screen.findByRole('button', { name: 'Is it just reference?' }));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.path.endsWith('/move'))).toBe(true);
    });
  });

  it('moves a someday item out of the inbox and off the calendar', async () => {
    lastStub = stubFetch(inboxRoutes([item({ id: 'i1' })]));
    const { user } = renderApp('/clarify');

    await user.click(await screen.findByRole('button', { name: 'Is it someday / maybe?' }));

    await waitFor(() => {
      const call = lastStub?.calls.find((entry) => entry.path.endsWith('/move'));
      expect(call?.method).toBe('POST');
    });
  });
});
