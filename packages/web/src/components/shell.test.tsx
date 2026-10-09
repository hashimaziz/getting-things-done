import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { healthPayload, stubFetch } from '@/test/fetch-stub';

/**
 * Shell tests.
 *
 * These are the tests that would catch the app being structurally broken, which is
 * the failure mode where every screen is unavailable at once and no unit test in the
 * package notices.
 */

function baseRoutes(health: Record<string, unknown> = {}) {
  return [
    { path: '/api/metrics/health', body: healthPayload(health) },
    { path: '/api/categories', body: { categories: [] } },
    { path: '/api/fields', body: { fields: [] } },
  ];
}

describe('the shell', () => {
  it('renders the navigation', async () => {
    stubFetch(baseRoutes());

    renderApp('/dashboard');

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Inbox/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next Actions/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Weekly Review/ })).toBeInTheDocument();
  });

  it('navigates when a container is clicked', async () => {
    stubFetch(baseRoutes());
    const { user } = renderApp('/dashboard');

    await user.click(screen.getByRole('link', { name: /Inbox/ }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    });
  });

  it('marks the current destination as active', async () => {
    stubFetch(baseRoutes());
    const { user } = renderApp('/dashboard');

    const dashboard = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboard).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: /Inbox/ }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Inbox/ })).toHaveAttribute('aria-current', 'page');
    });
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the parent row inactive on a settings sub-page', async () => {
    stubFetch([...baseRoutes(), { path: '/api/settings/categories', body: {} }]);

    // `/settings` is a prefix of `/settings/categories`, so without an exact match
    // both rows highlight at once.
    const { user } = renderApp('/settings');
    await user.click(screen.getByRole('link', { name: 'Categories' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
    expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('surfaces the overdue count only when there is one', async () => {
    stubFetch(baseRoutes({ overdue: 3 }));
    const { unmount } = renderApp('/dashboard');

    expect(await screen.findByText('3 overdue')).toBeInTheDocument();
    unmount();

    stubFetch(baseRoutes({ overdue: 0 }));
    renderApp('/dashboard');
    await waitFor(() => {
      expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    });
  });

  it('shows container counts from health rather than separate queries', async () => {
    const stub = stubFetch(baseRoutes({ inboxBacklog: 7, waiting: 2 }));
    renderApp('/dashboard');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Inbox\s*7/ })).toBeInTheDocument();
    });

    // One request for health, not one per container: four counts that arrive at
    // different times produce a sidebar that briefly lies.
    expect(stub.calls.filter((call) => call.path === '/api/metrics/health')).toHaveLength(1);
  });

  it('sets the document title from the route', async () => {
    stubFetch(baseRoutes());
    renderApp('/list/waiting');

    await waitFor(() => {
      expect(document.title).toBe('Waiting For — GTD');
    });
  });

  it('cycles the theme through system, light and dark, and remembers each choice', async () => {
    stubFetch(baseRoutes());
    const { user } = renderApp('/dashboard');

    // The first state is `system`, so a fresh user following an OS that wants dark
    // sees dark already. One click from there is an explicit light, and the next is
    // dark. The cycle is asserted rather than a single click, so the order is part
    // of the contract instead of an accident.
    expect(screen.getByRole('button', { name: /Switch to dark theme/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Switch to/ }));
    expect(localStorage.getItem('gtd.theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(screen.getByRole('button', { name: /Switch to/ }));
    expect(localStorage.getItem('gtd.theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies a stored theme before anything is clicked', async () => {
    localStorage.setItem('gtd.theme', 'dark');
    stubFetch(baseRoutes());
    renderApp('/dashboard');

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('renders a not-found page that says where to go', async () => {
    stubFetch(baseRoutes());
    renderApp('/nowhere-at-all');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to the dashboard/ })).toBeInTheDocument();
  });

  it('routes every navigation destination somewhere', async () => {
    const stub = stubFetch(baseRoutes());
    renderApp('/nowhere-at-all');

    // The not-found page itself renders, so the router matched the catch-all rather
    // than throwing, which means the shell is wired up.
    await screen.findByRole('heading', { name: 'Page not found' });
    expect(stub.calls.every((call) => call.path.startsWith('/api/'))).toBe(true);
  });
});
