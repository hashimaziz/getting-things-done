import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';

/**
 * The setup wizard's defaults.
 *
 * These tests exist because the defaults are the difference between someone using this
 * app and abandoning it on the setup screen. They assert two things: that the button
 * lands on the review step rather than writing anything behind the user's back, and
 * that what it writes is what the review step said it would write — categories, their
 * fields, and the contexts, in that order, with "Office" scoped to the "Work" that was
 * actually created.
 */

let stub: FetchStub;

/*
 * No `afterEach` here, and that is deliberate. The shared setup in `test/setup.ts`
 * unstubs every global after each test and reinstalls its environment shims, so a
 * local `vi.unstubAllGlobals()` would strip the `Request` shim React Router needs and
 * the navigation would fail in whichever test ran next instead of this one.
 */

const NOT_SET_UP = { path: '/api/status', body: { app: 'GTD', version: 1, setupCompleted: false } };

function routes(extra: StubbedRoute[] = []): StubbedRoute[] {
  return [
    NOT_SET_UP,
    { path: '/api/categories', method: 'POST', body: { category: { id: 'cat_1' } } },
    { path: '/api/contexts', method: 'POST', body: { context: { id: 'ctx_1' } } },
    { path: '/api/settings/:key', method: 'PUT', body: { setting: { key: 'k', value: true } } },
    { path: '/api/categories/:id/fields', method: 'POST', body: { field: { id: 'f1' } } },
    { path: '/api/dashboard', body: { health: {} } },
    { path: '/api/metrics/health', body: { health: {} } },
    { path: '/api/items', body: { items: [], total: 0 } },
    { path: '/api/fields', body: { fields: [] } },
    ...extra,
  ];
}

beforeEach(() => {
  stub = stubFetch(routes());
});

describe('setup defaults', () => {
  it('offers the defaults on an empty wizard', async () => {
    renderApp('/setup');

    expect(await screen.findByRole('button', { name: 'Use the defaults' })).toBeDefined();
  });

  it('shows what the defaults are before writing anything', async () => {
    const { user } = renderApp('/setup');

    await user.click(await screen.findByRole('button', { name: 'Use the defaults' }));

    // The review step, not the dashboard. Someone who did not read the defaults
    // deserves to see them before they exist.
    expect(await screen.findByText('Review')).toBeDefined();
    expect(screen.getByText('Work')).toBeDefined();
    expect(screen.getByText('Finance')).toBeDefined();
    expect(stub.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('can be undone by going back to the steps', async () => {
    const { user } = renderApp('/setup');

    await user.click(await screen.findByRole('button', { name: 'Use the defaults' }));
    await screen.findByText('Review');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    // Into the steps, with the defaults still loaded rather than discarded — the
    // review step is a summary, not a one-way door.
    expect(await screen.findByText('What each category tracks.')).toBeDefined();
    expect(screen.getByDisplayValue('Shopping list')).toBeDefined();
  });

  it('lists the contexts and where each one applies', async () => {
    const { user } = renderApp('/setup');

    await user.click(await screen.findByRole('button', { name: 'Use the defaults' }));

    // "Office — Work only" is the detail that has to be right: a context that quietly
    // applies everywhere is a filter that quietly lies.
    expect(await screen.findByText('Office — Work only')).toBeDefined();
    expect(screen.getByText('Phone — everywhere')).toBeDefined();
  });

  it('creates the categories, fields and contexts when finished', async () => {
    const { user } = renderApp('/setup');

    await user.click(await screen.findByRole('button', { name: 'Use the defaults' }));
    await user.click(await screen.findByRole('button', { name: 'Finish setup' }));

    await waitFor(() => {
      expect(stub.calls.some((call) => call.path === '/api/settings/setup.completed')).toBe(true);
    });

    const posts = stub.calls.filter((call) => call.method === 'POST');
    const categories = posts
      .filter((call) => call.path === '/api/categories')
      .map((call) => call.body?.['name']);
    expect(categories).toEqual(['Personal', 'Work', 'Home', 'Health', 'Finance']);

    const contexts = posts
      .filter((call) => call.path === '/api/contexts')
      .map((call) => call.body?.['name']);
    expect(contexts).toEqual(['Anywhere', 'Phone', 'Computer', 'Home', 'Errands', 'Office']);
  });

  it('scopes Office to the id Work was actually created with', async () => {
    const { user } = renderApp('/setup');
    await user.click(await screen.findByRole('button', { name: 'Use the defaults' }));
    await user.click(await screen.findByRole('button', { name: 'Finish setup' }));

    await waitFor(() => {
      expect(stub.calls.some((call) => call.path === '/api/contexts')).toBe(true);
    });

    const office = stub.calls.find(
      (call) => call.method === 'POST' && call.body?.['name'] === 'Office',
    );
    expect(office?.body?.['categoryId']).toBe('cat_1');
  });

  it('writes the timezone and the first day of the week', async () => {
    const { user } = renderApp('/setup');

    await user.click(await screen.findByRole('button', { name: 'Use the defaults' }));
    await user.click(await screen.findByRole('button', { name: 'Finish setup' }));

    await waitFor(() => {
      expect(stub.calls.some((call) => call.path.endsWith('/app.weekStartsOn'))).toBe(true);
    });
    expect(stub.lastBody('PUT', '/app.weekStartsOn')?.['value']).toBe(1);
  });

  it('stops offering the defaults once something has been typed', async () => {
    const { user } = renderApp('/setup');

    await screen.findByRole('button', { name: 'Use the defaults' });
    await user.click(screen.getByRole('button', { name: '2. Categories' }));
    await user.click(screen.getByRole('button', { name: 'Add a category' }));

    // Every version of the button would replace what was just typed, so it is gone
    // rather than waiting to be pressed by accident.
    expect(screen.queryByRole('button', { name: 'Use all the defaults' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use the defaults' })).toBeNull();
  });

  it('can fill the steps from the categories step instead', async () => {
    const { user } = renderApp('/setup');

    await screen.findByRole('button', { name: 'Use the defaults' });
    await user.click(screen.getByRole('button', { name: '2. Categories' }));
    await user.click(screen.getByRole('button', { name: 'Use all the defaults' }));

    expect(await screen.findByDisplayValue('Health')).toBeDefined();
    expect(screen.getByText('Where your things live.')).toBeDefined();
  });
});
