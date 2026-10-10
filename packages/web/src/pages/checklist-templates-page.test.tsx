import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';

/**
 * Checklist templates.
 *
 * Two things are worth protecting here. The first is that a template's steps are
 * *copied* onto the item it creates, never referenced: a template that stays linked is
 * how editing next year's packing list silently rewrites last year's. The second is the
 * dead end — a template cannot be used at all without a category, and an error that
 * arrives after clicking is worse than a button that says why it cannot be pressed.
 */

let stub: FetchStub;

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'Pack for a week away',
    entries: [
      { id: 'step_0', label: 'Charger' },
      { id: 'step_1', label: 'Passport' },
    ],
    appliesTo: [],
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function categories(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index + 1}`,
    key: `cat_${index + 1}`,
    name: `Category ${index + 1}`,
    description: null,
    color: null,
    icon: null,
    sortOrder: index,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
  }));
}

function routes(extra: StubbedRoute[] = []): StubbedRoute[] {
  return [
    {
      path: '/api/status',
      body: { app: 'GTD', version: 1, setupCompleted: true },
    },
    { path: '/api/checklist-templates', body: { templates: [template()] } },
    { path: '/api/categories', body: { categories: categories() } },
    {
      path: '/api/items',
      method: 'POST',
      body: { item: { id: 'i1', title: 'Pack for a week away' } },
    },
    ...extra,
  ];
}

beforeEach(() => {
  stub = stubFetch(routes());
});

describe('checklist templates', () => {
  it('lists a template with its steps', async () => {
    renderApp('/settings/templates');

    expect(await screen.findByText('Pack for a week away')).toBeDefined();
    expect(screen.getByText('Charger')).toBeDefined();
    expect(screen.getByText('Passport')).toBeDefined();
  });

  it('says so when there are none, rather than showing an empty list', async () => {
    stub.restore();
    stub = stubFetch(
      routes().map((route) =>
        route.path === '/api/checklist-templates' ? { ...route, body: { templates: [] } } : route,
      ),
    );

    renderApp('/settings/templates');

    expect(await screen.findByText('No templates yet.')).toBeDefined();
  });

  it('will not save a template with no name', async () => {
    const { user } = renderApp('/settings/templates');

    await screen.findByText('Pack for a week away');
    expect(screen.getByRole('button', { name: 'Save template' })).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('Template name'), 'Renovations');

    // Named but still empty: the button stays disabled and the reason is on screen.
    expect(await screen.findByText('A checklist needs at least one step.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save template' })).toHaveProperty('disabled', true);
  });

  it('trims steps and drops blank rows', async () => {
    const { user } = renderApp('/settings/templates');

    await screen.findByText('Pack for a week away');
    await user.type(screen.getByLabelText('Template name'), 'Renovations');
    await user.type(screen.getByLabelText('Step 1'), '  Quote from a builder  ');
    await user.click(screen.getByRole('button', { name: 'Add a step' }));
    await user.type(screen.getByLabelText('Step 2'), 'Compare two quotes');

    await user.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => {
      expect(stub.lastBody('POST', '/api/checklist-templates')).toBeDefined();
    });
    expect(stub.lastBody('POST', '/api/checklist-templates')).toMatchObject({
      name: 'Renovations',
      entries: [{ label: 'Quote from a builder' }, { label: 'Compare two quotes' }],
    });
  });

  it('copies the steps onto a new item instead of referencing the template', async () => {
    const { user } = renderApp('/settings/templates');

    await screen.findByText('Pack for a week away');
    await user.click(screen.getByRole('button', { name: 'Use this checklist' }));
    await user.click(await screen.findByRole('button', { name: 'Create the item' }));

    await waitFor(() => {
      expect(stub.lastBody('POST', '/api/items')).toBeDefined();
    });

    const body = stub.lastBody('POST', '/api/items');
    expect(body?.['title']).toBe('Pack for a week away');
    expect(body?.['data']).toEqual({
      checklist: [
        { id: 'step_0', label: 'Charger', done: false },
        { id: 'step_1', label: 'Passport', done: false },
      ],
    });
    // No template id anywhere in the item: nothing about this item can be changed by
    // editing the template later.
    expect(JSON.stringify(body)).not.toContain('templateId');
  });

  it('offers a category choice when there is more than one', async () => {
    const { user } = renderApp('/settings/templates');

    await screen.findByText('Pack for a week away');
    await user.click(screen.getByRole('button', { name: 'Use this checklist' }));
    await user.selectOptions(await screen.findByLabelText('Category'), 'c2');
    await user.click(screen.getByRole('button', { name: 'Create the item' }));

    await waitFor(() => {
      expect(stub.lastBody('POST', '/api/items')).toBeDefined();
    });
    expect(stub.lastBody('POST', '/api/items')?.['categoryId']).toBe('c2');
  });

  it('says a category is needed instead of failing after the click', async () => {
    stub.restore();
    stub = stubFetch(
      routes().map((route) =>
        route.path === '/api/categories' ? { ...route, body: { categories: [] } } : route,
      ),
    );

    const { user } = renderApp('/settings/templates');

    await screen.findByText('Pack for a week away');
    await user.click(screen.getByRole('button', { name: 'Use this checklist' }));

    expect(
      await screen.findByText('Create a category first: an item has to belong to one.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create the item' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(stub.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('reports a failed delete rather than leaving the button looking broken', async () => {
    stub.restore();
    stub = stubFetch([
      ...routes(),
      {
        path: '/api/checklist-templates/:id',
        method: 'DELETE',
        status: 500,
        body: { error: { code: 'internal', message: 'nope' } },
      },
    ]);

    const { user } = renderApp('/settings/templates');

    await screen.findByText('Pack for a week away');
    await user.click(screen.getByRole('button', { name: 'Delete Pack for a week away' }));

    expect(await screen.findByText('That template could not be deleted')).toBeDefined();
  });

  it('removes a deleted step without disturbing the others', async () => {
    const { user } = renderApp('/settings/templates');

    await screen.findByText('Pack for a week away');
    await user.type(screen.getByLabelText('Template name'), 'Renovations');
    await user.type(screen.getByLabelText('Step 1'), 'First');
    await user.click(screen.getByRole('button', { name: 'Add a step' }));
    await user.type(screen.getByLabelText('Step 2'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Add a step' }));
    await user.type(screen.getByLabelText('Step 3'), 'Third');

    await user.click(screen.getByRole('button', { name: 'Remove step 2' }));

    // The remaining rows keep their text, and the labels renumber without gaps.
    expect((screen.getByLabelText('Step 1') as HTMLInputElement).value).toBe('First');
    expect((screen.getByLabelText('Step 2') as HTMLInputElement).value).toBe('Third');

    await user.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => {
      expect(stub.lastBody('POST', '/api/checklist-templates')).toBeDefined();
    });
    expect(stub.lastBody('POST', '/api/checklist-templates')?.['entries']).toEqual([
      // Ids follow the row, not the position, so the surviving third row keeps its own.
      { id: 'draft_0', label: 'First' },
      { id: 'draft_2', label: 'Third' },
    ]);
  });
});
