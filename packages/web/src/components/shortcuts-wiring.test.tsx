import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { healthPayload, stubFetch } from '@/test/fetch-stub';

/**
 * Shortcuts, from the app's point of view.
 *
 * The unit tests cover the rules; this covers the wiring. A shortcut registry that
 * works perfectly and a shell that never installs it is a feature nobody can find.
 *
 * Modified shortcuts are pressed with Control, not Command. jsdom reports a
 * non-Mac platform, and on a non-Mac `mod` *is* Control — a test that pressed Command
 * would pass on a developer's Mac and fail here, which is the opposite of what a test
 * is for.
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

const SHELL = [
  { path: '/api/metrics/health', body: healthPayload() },
  { path: '/api/categories', body: { categories: [] } },
  { path: '/api/fields', body: { fields: [] } },
  { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
];

describe('the palette shortcut', () => {
  it('opens the palette', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/dashboard');

    await screen.findByRole('navigation', { name: 'Main' });
    await user.keyboard('{Control>}k{/Control}');

    expect(await screen.findByPlaceholderText(/search actions/i)).toBeInTheDocument();
  });

  it('closes when the same shortcut is pressed again', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/dashboard');

    await screen.findByRole('navigation', { name: 'Main' });
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByPlaceholderText(/search actions/i);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/search actions/i)).not.toBeInTheDocument();
    });
  });

  it('opens from the search button too', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: /search/i }));

    expect(await screen.findByPlaceholderText(/search actions/i)).toBeInTheDocument();
  });
});

describe('navigation shortcuts', () => {
  it('goes to the inbox', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/dashboard');

    await screen.findByRole('navigation', { name: 'Main' });
    await user.keyboard('i');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    });
  });

  it('goes to the weekly review', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/dashboard');

    await screen.findByRole('navigation', { name: 'Main' });
    await user.keyboard('r');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Weekly Review' })).toBeInTheDocument();
    });
  });

  it('goes to capture', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/dashboard');

    await screen.findByRole('navigation', { name: 'Main' });
    await user.keyboard('c');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Capture' })).toBeInTheDocument();
    });
  });
});

describe('the theme shortcut', () => {
  it('steps through the theme cycle', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/dashboard');

    await screen.findByRole('navigation', { name: 'Main' });

    // Starts at `system`, which the test environment resolves to light.
    await user.keyboard('t');
    expect(localStorage.getItem('gtd.theme')).toBe('light');

    await user.keyboard('t');
    expect(localStorage.getItem('gtd.theme')).toBe('dark');
  });
});

describe('typing wins', () => {
  /*
   * The rule that keeps bare-letter shortcuts from destroying data. Without it,
   * pressing "c" to start capturing a thought would instead type a "c" into whatever
   * field was focused, which for a capture box means a corrupted inbox.
   */
  it('does not act on a bare key while an input has focus', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL, { path: '/capture', body: {} }]);
    const { user } = renderApp('/dashboard');
    await screen.findByRole('navigation', { name: 'Main' });

    // Put focus somewhere a person would be typing.
    const search = await screen.findByRole('button', { name: /search/i });
    await user.click(search);
    const input = await screen.findByPlaceholderText(/search actions/i);

    await user.keyboard('i');

    expect(input).toHaveFocus();
    // The inbox was not opened behind the palette.
    expect(screen.queryByRole('heading', { name: 'Inbox' })).not.toBeInTheDocument();
  });
});

describe('the shortcut settings screen', () => {
  it('lists every action with its current binding', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    renderApp('/settings/shortcuts');

    expect(await screen.findByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Command palette')).toBeInTheDocument();
    expect(screen.getByText('Capture something')).toBeInTheDocument();
  });

  it('records a pressed combination rather than a typed one', async () => {
    stubFetch([
      STATUS_SET_UP,
      ...SHELL,
      { path: '/api/settings/ui.shortcuts', method: 'PUT', body: { key: 'ui.shortcuts' } },
    ]);
    const { user } = renderApp('/settings/shortcuts');

    const rows = await screen.findAllByRole('button', { name: 'Change' });
    const firstRow = rows.at(0);
    if (!firstRow) {
      throw new Error('No shortcut rows rendered');
    }
    await user.click(firstRow);

    expect(await screen.findByText('Press keys…')).toBeInTheDocument();

    await user.keyboard('{Control>}j{/Control}');

    // Displayed in the same notation the key itself uses, so the value about to be
    // saved is visible before it is committed.
    expect(await screen.findByText('Ctrl+J')).toBeInTheDocument();
  });

  it('offers a way out of recording without saving', async () => {
    stubFetch([STATUS_SET_UP, ...SHELL]);
    const { user } = renderApp('/settings/shortcuts');

    const rows = await screen.findAllByRole('button', { name: 'Change' });
    const firstRow = rows.at(0);
    if (!firstRow) {
      throw new Error('No shortcut rows rendered');
    }
    await user.click(firstRow);
    await screen.findByText('Press keys…');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Press keys…')).not.toBeInTheDocument();
    });
  });
});
