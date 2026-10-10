import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';

/**
 * The wipe button.
 *
 * This is the one control in the application that destroys everything, and it is
 * reachable without authentication because the whole application is local and
 * single-user. So the tests are mostly about what does *not* happen: nothing is deleted
 * until the phrase matches exactly, and nothing is deleted when the count could not be
 * read.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

const PREVIEW = {
  confirmation: 'WIPE EVERYTHING',
  total: 12,
  tables: [
    { table: 'items', rows: 8 },
    { table: 'categories', rows: 2 },
    { table: 'field_defs', rows: 1 },
    { table: 'settings', rows: 1 },
  ],
};

let lastStub: FetchStub | null = null;

function routes(preview: unknown = PREVIEW, extra: StubbedRoute[] = []): StubbedRoute[] {
  return [
    STATUS_SET_UP,
    { path: '/api/system/wipe/preview', body: preview },
    { path: '/api/system/wipe', method: 'POST', body: { wiped: 12, remaining: 0 } },
    {
      path: '/api/metrics/health',
      body: { health: { inboxBacklog: 8, overdue: 0, waiting: 0, someday: 0 } },
    },
    { path: '/api/categories', body: { categories: [] } },
    { path: '/api/fields', body: { fields: [] } },
    { path: '/api/projects', body: { projects: [] } },
    { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
    { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
    { path: '/api/settings', body: { settings: [] } },
    ...extra,
  ];
}

/** Navigates to the application settings tab, where the danger zone lives. */
async function openSettings() {
  const rendered = renderApp('/settings');
  await screen.findByRole('heading', { name: 'Settings' });
  return rendered;
}

describe('what it says', () => {
  it('shows the danger zone', async () => {
    lastStub = stubFetch(routes());
    await openSettings();

    expect(await screen.findByRole('heading', { name: 'Danger zone' })).toBeInTheDocument();
  });

  it('counts what would be deleted, rather than describing it vaguely', async () => {
    // "This would delete 12 rows" is a fact. "This will delete your data" is a warning
    // label. Only one of them lets someone decide.
    lastStub = stubFetch(routes());
    await openSettings();

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText(/across items, categories/)).toBeInTheDocument();
  });

  it('explains that the structure is kept', async () => {
    lastStub = stubFetch(routes());
    await openSettings();

    expect(screen.getByText(/database structure is kept/i)).toBeInTheDocument();
  });
});

describe('confirming', () => {
  it('does nothing until the button is pressed twice', async () => {
    lastStub = stubFetch(routes());
    const { user } = await openSettings();

    await user.click(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    );

    // The first press only reveals the confirmation. Nothing is deleted yet.
    expect(lastStub?.calls.some((entry) => entry.path === '/api/system/wipe')).toBe(false);
  });

  it('keeps the delete button disabled until the phrase matches exactly', async () => {
    lastStub = stubFetch(routes());
    const { user } = await openSettings();

    await user.click(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    );
    const confirmButton = screen.getByRole('button', { name: /delete everything/i });

    expect(confirmButton).toBeDisabled();
  });

  it('refuses a phrase in the wrong case', async () => {
    // A lowercase phrase is a plausible thing to type. Accepting it would defeat the
    // point of requiring one.
    lastStub = stubFetch(routes());
    const { user } = await openSettings();

    await user.click(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    );
    await user.type(screen.getByLabelText(/type/i), 'wipe everything');

    expect(screen.getByRole('button', { name: /delete everything/i })).toBeDisabled();
  });

  it('refuses a partial phrase', async () => {
    lastStub = stubFetch(routes());
    const { user } = await openSettings();

    await user.click(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    );
    await user.type(screen.getByLabelText(/type/i), 'WIPE');

    expect(screen.getByRole('button', { name: /delete everything/i })).toBeDisabled();
  });

  it('sends the phrase and wipes once it matches', async () => {
    lastStub = stubFetch(routes());
    const { user } = await openSettings();

    await user.click(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    );
    await user.type(screen.getByLabelText(/type/i), 'WIPE EVERYTHING');

    await user.click(screen.getByRole('button', { name: /delete everything/i }));

    await waitFor(() => {
      expect(lastStub?.lastBody('POST', '/api/system/wipe')?.['confirm']).toBe('WIPE EVERYTHING');
    });
  });

  it('cancels without deleting anything', async () => {
    lastStub = stubFetch(routes());
    const { user } = await openSettings();

    await user.click(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(lastStub?.calls.some((entry) => entry.path === '/api/system/wipe')).toBe(false);
    expect(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    ).toBeInTheDocument();
  });
});

describe('when there is nothing to delete', () => {
  it('disables the button', async () => {
    lastStub = stubFetch(routes({ confirmation: 'WIPE EVERYTHING', total: 0, tables: [] }));
    await openSettings();

    // Nothing to destroy is not an opportunity to practise destroying.
    expect(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    ).toBeDisabled();
  });

  it('says so', async () => {
    lastStub = stubFetch(routes({ confirmation: 'WIPE EVERYTHING', total: 0, tables: [] }));
    await openSettings();

    expect(await screen.findByText(/nothing to delete/i)).toBeInTheDocument();
  });
});

describe('when the count cannot be read', () => {
  it('disables the button rather than deleting on a guess', async () => {
    lastStub = stubFetch([
      {
        path: '/api/system/wipe/preview',
        body: { error: { code: 'boom', message: 'no' } },
        status: 500,
      },
      ...routes(),
    ]);
    await openSettings();

    // A button that fires on a failed count would destroy data while claiming to
    // describe it.
    expect(
      await screen.findByRole('button', { name: /wipe everything and start again/i }),
    ).toBeDisabled();
    expect(screen.getByText(/could not read what would be deleted/i)).toBeInTheDocument();
  });
});
