import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';
import type { FieldDefinition } from '@/lib/types';

/**
 * The settings screens.
 *
 * A field created here shapes every item editor, list column and filter for as long as
 * the database exists, which is why these tests concentrate on the choices: creating a
 * priority field without being able to name its options produced a field the server
 * filled with "Option 1" and "Option 2", and nothing on the screen explained why it was
 * useless.
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
  ],
};

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: 'f1',
    categoryId: 'c1',
    key: 'my_priority',
    label: 'My priority',
    description: null,
    type: 'priority',
    options: {
      kind: 'choices',
      choices: [{ value: 'high', label: 'High', color: null, order: 0 }],
    },
    required: false,
    defaultValue: null,
    groupLabel: null,
    showInTable: true,
    showInCard: false,
    filterable: true,
    sortable: false,
    isCore: false,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as FieldDefinition;
}

let lastStub: FetchStub | null = null;

function routes(extra: StubbedRoute[] = [], answer: unknown = { fields: [] }): StubbedRoute[] {
  return [
    ...extra,
    STATUS_SET_UP,
    { path: '/api/categories', body: CATEGORIES },
    { path: '/api/fields', body: answer },
    {
      path: '/api/metrics/health',
      body: { health: { inboxBacklog: 0, overdue: 0, waiting: 0, someday: 0 } },
    },
    { path: '/api/projects', body: { projects: [] } },
    { path: '/api/people', body: { people: [] } },
    { path: '/api/contexts', body: { contexts: [] } },
    { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
    { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
    { path: '/api/settings', body: { settings: [] } },
    {
      path: '/api/system/wipe/preview',
      body: { confirmation: 'WIPE EVERYTHING', total: 0, tables: [] },
    },
  ];
}

describe('categories', () => {
  it('lists them', async () => {
    lastStub = stubFetch(routes());
    renderApp('/settings/categories');

    expect(await screen.findByText('Work')).toBeInTheDocument();
  });

  it('creates one', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/categories');

    await user.type(await screen.findByLabelText('New category name'), 'Home');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(() => {
      expect(lastStub?.lastBody('POST', '/api/categories')?.['name']).toBe('Home');
    });
  });

  it('will not submit an unnamed category', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/categories');

    await user.click(await screen.findByRole('button', { name: 'Add category' }));

    expect(lastStub?.calls.some((entry) => entry.method === 'POST')).toBe(false);
    expect(screen.getByText(/needs a name/)).toBeInTheDocument();
  });

  it('says so when creating fails', async () => {
    // A create button that fails silently is worse than no button: the person believes
    // it worked and finds out later, with data attached.
    lastStub = stubFetch(
      routes([
        {
          path: '/api/categories',
          method: 'POST',
          body: {
            error: { code: 'duplicate_key', message: 'A category called Home already exists.' },
          },
          status: 409,
        },
      ]),
    );
    const { user } = renderApp('/settings/categories');

    await user.type(await screen.findByLabelText('New category name'), 'Home');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(() => {
      expect(document.body.textContent).toContain('already exists');
    });
  });

  it('renames one', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/categories');

    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByLabelText('Rename Work'));
    await user.type(screen.getByLabelText('Rename Work'), 'Employment');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(lastStub?.lastBody('PATCH', '/api/categories/c1')?.['name']).toBe('Employment');
    });
  });

  it('deletes one', async () => {
    lastStub = stubFetch(routes([{ path: '/api/categories/:id', method: 'DELETE', body: {} }]));
    const { user } = renderApp('/settings/categories');

    await user.click(await screen.findByRole('button', { name: 'Delete Work' }));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.method === 'DELETE')).toBe(true);
    });
  });
});

describe('fields', () => {
  it('offers every field type', async () => {
    lastStub = stubFetch(routes());
    renderApp('/settings/fields');

    const select = await screen.findByLabelText('Field type');
    expect(select.querySelectorAll('option')).toHaveLength(14);
  });

  it('asks for options when the type needs them', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/fields');

    await user.selectOptions(await screen.findByLabelText('Field type'), 'priority');

    // Without this the server fills in "Option 1" and "Option 2", and the field is
    // useless in a way nothing on the screen explains.
    expect(screen.getByLabelText(/options, highest first/i)).toBeInTheDocument();
  });

  it('does not ask for options for a text field', async () => {
    lastStub = stubFetch(routes());
    renderApp('/settings/fields');

    await screen.findByLabelText('Field type');
    expect(screen.queryByLabelText(/options, highest first/i)).not.toBeInTheDocument();
  });

  it('sends the options in the order they were written', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/fields');

    await user.selectOptions(await screen.findByLabelText('Field type'), 'priority');
    await user.type(screen.getByLabelText('Field label'), 'Urgency');
    await user.selectOptions(screen.getByLabelText('Field category'), 'c1');
    await user.click(screen.getByRole('button', { name: 'Add field' }));

    await waitFor(() => {
      const body = lastStub?.lastBody('POST', '/api/categories/c1/fields');
      expect(body).toMatchObject({
        type: 'priority',
        options: {
          kind: 'choices',
          choices: [
            { value: 'high', label: 'High', color: null, order: 0 },
            { value: 'medium', label: 'Medium', color: null, order: 1 },
            { value: 'low', label: 'Low', color: null, order: 2 },
          ],
        },
      });
    });
  });

  it('refuses a priority field with no options', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/fields');

    await user.selectOptions(await screen.findByLabelText('Field type'), 'priority');
    await user.type(screen.getByLabelText('Field label'), 'Urgency');
    await user.selectOptions(screen.getByLabelText('Field category'), 'c1');
    await user.clear(screen.getByLabelText(/options, highest first/i));
    await user.click(screen.getByRole('button', { name: 'Add field' }));

    expect(lastStub?.calls.some((entry) => entry.method === 'POST')).toBe(false);
    expect(screen.getByText(/at least two options/)).toBeInTheDocument();
  });

  it('refuses a field with no category', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/fields');

    await user.type(await screen.findByLabelText('Field label'), 'Urgency');
    await user.click(screen.getByRole('button', { name: 'Add field' }));

    expect(screen.getByText(/which category/i)).toBeInTheDocument();
  });

  it('lists existing fields with their options described', async () => {
    lastStub = stubFetch(routes([], { fields: [field({ required: true })] }));
    renderApp('/settings/fields');

    expect(await screen.findByText('My priority')).toBeInTheDocument();
    expect(screen.getByText(/Priority · required/)).toBeInTheDocument();
  });

  it('can hide a field from list columns', async () => {
    lastStub = stubFetch(routes([], { fields: [field()] }));
    const { user } = renderApp('/settings/fields');

    await user.click(await screen.findByRole('button', { name: /hide from lists/i }));

    await waitFor(() => {
      expect(lastStub?.lastBody('PATCH', '/fields/f1')?.['showInTable']).toBe(false);
    });
  });

  it('deletes a field', async () => {
    lastStub = stubFetch(
      routes([{ path: '/api/fields/:id', method: 'DELETE', body: {} }], { fields: [field()] }),
    );
    const { user } = renderApp('/settings/fields');

    await user.click(await screen.findByRole('button', { name: 'Delete My priority' }));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.method === 'DELETE')).toBe(true);
    });
  });
});

describe('reference data', () => {
  it('lists projects', async () => {
    lastStub = stubFetch(routes());
    renderApp('/settings/reference');

    await screen.findByLabelText('Reference kind');
    // Nothing yet in the stub, so the Add button is available and the list is empty.
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('adds a person', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings/reference');
    await screen.findByLabelText('Reference kind');

    await user.selectOptions(screen.getByLabelText('Reference kind'), 'people');
    await user.type(screen.getByLabelText('New name'), 'Dana');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(lastStub?.lastBody('POST', '/api/people')?.['name']).toBe('Dana');
    });
  });

  it('will not add an empty name', async () => {
    lastStub = stubFetch(routes());
    renderApp('/settings/reference');

    await screen.findByLabelText('New name');
    // A disabled button rather than a request the server will reject: the name is
    // obviously empty and the request would say nothing more.
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });
});

describe('application settings', () => {
  it('saves the timezone', async () => {
    lastStub = stubFetch(routes());
    const { user } = renderApp('/settings');

    const input = await screen.findByLabelText('Timezone');
    await user.clear(input);
    await user.type(input, 'Europe/London');
    await user.tab();

    await waitFor(() => {
      expect(lastStub?.lastBody('PUT', '/settings/app.timezone')?.['value']).toBe('Europe/London');
    });
  });

  it('offers the first day of the week as days, not numbers', async () => {
    lastStub = stubFetch(routes());
    renderApp('/settings');

    const select = await screen.findByLabelText('Week starts on');
    expect(select.querySelectorAll('option')).toHaveLength(7);
    expect(select.querySelector('option[value="0"]')?.textContent).toBe('Sunday');
  });

  it('says so when a setting cannot be saved', async () => {
    // A setting that appears to save and does not is the worst outcome here: the next
    // recurring series anchors in the old zone and nobody is told.
    lastStub = stubFetch(
      routes([
        {
          path: '/api/settings/app.timezone',
          method: 'PUT',
          body: { error: { code: 'boom', message: 'Could not save' } },
          status: 500,
        },
      ]),
    );
    const { user } = renderApp('/settings');

    const input = await screen.findByLabelText('Timezone');
    await user.clear(input);
    await user.type(input, 'Mars/Olympus');
    await user.tab();

    await waitFor(() => {
      expect(document.body.textContent).toContain('Could not save');
    });
  });
});
