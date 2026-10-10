import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { healthPayload, stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';
import type { Item } from '@/lib/types';

/**
 * The recurring section of the item editor.
 *
 * Attaching a series is the one edit on this page whose consequences are invisible
 * until they are enormous, so these tests care about two things: the choice is
 * described in words before it is committed, and the count of what is about to be
 * created is shown rather than discovered later by scrolling.
 */

let stub: FetchStub;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    categoryId: 'c1',
    container: 'next_action',
    title: 'Water the plants',
    notes: null,
    estimateMinutes: null,
    deadlineOn: null,
    whenAt: null,
    followUpAt: null,
    waitingOnPersonId: null,
    projectId: null,
    values: {},
    recurrenceId: null,
    contextIds: [],
    parentItemId: null,
    occurrenceDate: null,
    isTemplate: false,
    data: {},
    sortOrder: 0,
    completedAt: null,
    trashedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const PRESETS = {
  presets: [
    { key: 'daily', label: 'Every day' },
    { key: 'weekly', label: 'Every week' },
    { key: 'monthly', label: 'Every month' },
  ],
};

function routes(extra: StubbedRoute[] = [], answer: Item = item()): StubbedRoute[] {
  return [
    { path: '/api/status', body: { app: 'GTD', version: 1, setupCompleted: true } },
    { path: '/api/metrics/health', body: healthPayload() },
    { path: '/api/items/i1', body: { item: answer } },
    { path: '/api/items/i1/history', body: { entries: [] } },
    { path: '/api/recurrence/presets', body: PRESETS },
    { path: '/api/categories', body: { categories: [{ id: 'c1', key: 'home', name: 'Home' }] } },
    { path: '/api/fields', body: { fields: [] } },
    { path: '/api/projects', body: { projects: [] } },
    { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
    { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
    {
      path: '/api/settings',
      body: { settings: [{ key: 'app.timezone', value: 'Europe/London' }] },
    },
    {
      path: '/api/items/i1/recurrence',
      method: 'POST',
      body: { occurrences: [item({ id: 'i2' }), item({ id: 'i3' })] },
    },
    { path: '/api/items/i1/recurrence', method: 'DELETE', body: { ok: true } },
    ...extra,
  ];
}

beforeEach(() => {
  stub = stubFetch(routes());
});

describe('recurrence', () => {
  it('describes the choice in words and estimates what it will create', async () => {
    const { user } = renderApp('/item/i1');

    await screen.findByRole('option', { name: 'Every week' });
    expect(screen.getByLabelText('How often')).toHaveProperty('value', 'weekly');
    expect(screen.getByText(/from .* all day, forever/)).toBeDefined();

    await user.selectOptions(screen.getByLabelText('How often'), 'daily');

    // The sentence and the count both move with the choice, so the consequence is on
    // screen before anything is saved.
    expect(await screen.findByText(/Every day, from/)).toBeDefined();
    expect(screen.getByText(/occurrences will be created/)).toBeDefined();
  });

  it('sends the chosen rule with the item timezone', async () => {
    const { user } = renderApp('/item/i1');

    await screen.findByRole('option', { name: 'Every week' });
    await user.selectOptions(screen.getByLabelText('How often'), 'monthly');
    await user.click(screen.getByRole('button', { name: 'Make it repeat' }));

    await waitFor(() => {
      expect(stub.lastBody('POST', '/api/items/i1/recurrence')).toBeDefined();
    });
    const body = stub.lastBody('POST', '/api/items/i1/recurrence');
    expect(body?.['preset']).toBe('monthly');
    expect(body?.['timezone']).toBe('Europe/London');
    // The anchor is always a date, never an instant: a series is wall-clock time.
    expect(typeof body?.['anchorDate']).toBe('string');
    expect(body?.['anchorDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses to attach when the frequencies could not be loaded', async () => {
    stub.restore();
    stub = stubFetch([
      ...routes().filter((route) => route.path !== '/api/recurrence/presets'),
      {
        path: '/api/recurrence/presets',
        status: 500,
        body: { error: { code: 'x', message: 'x' } },
      },
    ]);

    renderApp('/item/i1');

    // Otherwise the button works with an empty dropdown, and the frequency is committed
    // without ever having been named on screen.
    expect(await screen.findByText('The list of frequencies could not be loaded.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Make it repeat' })).toHaveProperty('disabled', true);
  });

  it('enables attaching once the frequencies are named on screen', async () => {
    renderApp('/item/i1');

    // Waiting for the named frequencies, not just for the empty dropdown: the select is
    // rendered before its options arrive.
    await screen.findByRole('option', { name: 'Every week' });
    expect(screen.getByRole('button', { name: 'Make it repeat' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('shows the server description and can stop repeating', async () => {
    stub.restore();
    const recurring = item({ recurrenceId: 'r1' });
    stub = stubFetch([
      ...routes([], recurring),
      {
        path: '/api/items/i1/occurrences',
        body: {
          template: 'FREQ=WEEKLY',
          rrule: 'FREQ=WEEKLY',
          description: 'Every week, from 2 March, forever.',
          occurrences: [],
        },
      },
    ]);

    const { user } = renderApp('/item/i1');

    expect(await screen.findByText('Every week, from 2 March, forever.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Stop repeating' }));

    await waitFor(() => {
      expect(stub.calls.some((call) => call.method === 'DELETE')).toBe(true);
    });
  });

  it('says when a series could not be stopped', async () => {
    stub.restore();
    const recurring = item({ recurrenceId: 'r1' });
    stub = stubFetch([
      ...routes()
        .filter(
          (route) => !(route.method === 'DELETE' && route.path === '/api/items/i1/recurrence'),
        )
        .map((route) =>
          route.path === '/api/items/i1' ? { ...route, body: { item: recurring } } : route,
        ),
      {
        path: '/api/items/i1/occurrences',
        body: { description: 'Every week.', occurrences: [] },
      },
      {
        path: '/api/items/i1/recurrence',
        method: 'DELETE',
        status: 500,
        body: { error: { code: 'internal', message: 'no' } },
      },
    ]);

    const { user } = renderApp('/item/i1');

    await screen.findByText('Every week.');
    await user.click(screen.getByRole('button', { name: 'Stop repeating' }));

    // Without this the item keeps repeating and the button looks broken.
    expect(await screen.findByText('The series could not be removed')).toBeDefined();
  });
});
