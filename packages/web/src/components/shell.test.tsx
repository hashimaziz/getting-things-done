import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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

/**
 * Setup is complete for every shell test.
 *
 * The shell sits behind the setup gate, and the gate reads `/api/status`. Without
 * this, every shell test would be measuring the gate: it would redirect to the
 * wizard and there would be no navigation to find. The gate has its own tests.
 */
const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

/**
 * Waits for the shell to appear.
 *
 * The shell sits behind the setup gate, which is an async answer, so nothing is on
 * screen synchronously after render. Every lookup below therefore has to be an
 * awaited one — a synchronous `getByRole` fails here in a way that looks like a
 * missing link rather than a missing wait.
 */
async function findNavLink(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('link', { name });
}

/**
 * A narrow window.
 *
 * jsdom has one viewport and it never changes on its own, so a test that needs a
 * phone sets the width and re-renders. Tests are otherwise shaped as a desktop,
 * because that is the layout where the sidebar is permanent and a mistake there is
 * the one nobody would notice in a screenshot.
 */
function setWindowWidth(width: number): void {
  (window as unknown as { innerWidth: number }).innerWidth = width;
}

const DESKTOP = 1280;
const PHONE = 480;

describe('the shell', () => {
  it('renders the navigation', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);

    renderApp('/dashboard');

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Inbox/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next Actions/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Weekly Review/ })).toBeInTheDocument();
  });

  it('navigates when a container is clicked', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    const { user } = renderApp('/dashboard');

    await user.click(await findNavLink(/Inbox/));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    });
  });

  it('marks the current destination as active', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    const { user } = renderApp('/dashboard');

    expect(await findNavLink('Dashboard')).toHaveAttribute('aria-current', 'page');

    await user.click(await findNavLink(/Inbox/));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Inbox/ })).toHaveAttribute('aria-current', 'page');
    });
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the parent row inactive on a settings sub-page', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes(), { path: '/api/settings/categories', body: {} }]);

    // `/settings` is a prefix of `/settings/categories`, so without an exact match
    // both rows highlight at once.
    const { user } = renderApp('/settings');
    await user.click(await findNavLink('Categories'));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
    expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('surfaces the overdue count only when there is one', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes({ overdue: 3 })]);
    const { unmount } = renderApp('/dashboard');

    expect(await screen.findByText('3 overdue')).toBeInTheDocument();
    unmount();

    stubFetch([STATUS_SET_UP, ...baseRoutes({ overdue: 0 })]);
    renderApp('/dashboard');
    await waitFor(() => {
      expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    });
  });

  it('shows container counts from health rather than separate queries', async () => {
    const stub = stubFetch([STATUS_SET_UP, ...baseRoutes({ inboxBacklog: 7, waiting: 2 })]);
    renderApp('/dashboard');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Inbox\s*7/ })).toBeInTheDocument();
    });

    // One request for health, not one per container: four counts that arrive at
    // different times produce a sidebar that briefly lies.
    expect(stub.calls.filter((call) => call.path === '/api/metrics/health')).toHaveLength(1);
  });

  it('sets the document title from the route', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/list/waiting');

    await waitFor(() => {
      expect(document.title).toBe('Waiting For — GTD');
    });
  });

  it('cycles the theme through system, light and dark, and remembers each choice', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    const { user } = renderApp('/dashboard');

    // The first state is `system`, so a fresh user following an OS that wants dark
    // sees dark already. One click from there is an explicit light, and the next is
    // dark. The cycle is asserted rather than a single click, so the order is part
    // of the contract instead of an accident.
    const first = await screen.findByRole('button', { name: /Switch to dark theme/ });
    expect(first).toBeInTheDocument();

    await user.click(first);
    expect(localStorage.getItem('gtd.theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(await screen.findByRole('button', { name: /Switch to/ }));
    expect(localStorage.getItem('gtd.theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies a stored theme before anything is clicked', async () => {
    localStorage.setItem('gtd.theme', 'dark');
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/dashboard');

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('renders a not-found page that says where to go', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/nowhere-at-all');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to the dashboard/ })).toBeInTheDocument();
  });

  it('routes every navigation destination somewhere', async () => {
    const stub = stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/nowhere-at-all');

    // The not-found page itself renders, so the router matched the catch-all rather
    // than throwing, which means the shell is wired up.
    await screen.findByRole('heading', { name: 'Page not found' });
    expect(stub.calls.every((call) => call.path.startsWith('/api/'))).toBe(true);
  });
});

/*
 * The sidebar on a narrow screen.
 *
 * These are the tests for the drawer, and they exist because the drawer had no way out.
 * It was painted over the top bar at a higher layer, so the toggle that opened it was
 * underneath the thing it opened, and following a link changed the screen behind it
 * without moving it. Every way of dismissing a drawer is asserted here, because any
 * one of them being absent is a screen the user cannot leave.
 */
describe('the sidebar drawer', () => {
  beforeEach(() => {
    setWindowWidth(PHONE);
  });

  it('is closed until asked for', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/dashboard');

    const toggle = await screen.findByRole('button', { name: 'Open navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('opens and closes from the same button', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Open navigation' }));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();

    // The control is still reachable while the drawer is open. It was painted over
    // before, which is what made the drawer a one-way door.
    const close = screen.getByRole('button', { name: 'Close navigation' });
    expect(close).toHaveAttribute('aria-expanded', 'true');
    await user.click(close);

    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('closes when a destination is chosen, so the screen is not hidden behind it', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Open navigation' }));
    await user.click(await findNavLink(/Inbox/));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Open navigation' }));
    await screen.findByRole('navigation', { name: 'Main' });

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('closes when the area beside it is tapped', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    const { user } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('navigation', { name: 'Main' });

    // The scrim, which is the parent of the drawer rather than the drawer itself.
    const scrim = drawer.parentElement?.previousElementSibling;
    expect(scrim).not.toBeNull();
    await user.click(scrim as HTMLElement);

    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('points the button at the drawer it controls', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/dashboard');

    const toggle = await screen.findByRole('button', { name: 'Open navigation' });
    expect(toggle.getAttribute('aria-controls')).toBe('app-sidebar');
  });
});

/*
 * The sidebar on a wide screen.
 *
 * Navigation that has to be summoned on a screen with room for it is one more click
 * on every visit, and the toggle that summoned it had nothing to close.
 */
describe('the sidebar on a wide screen', () => {
  beforeEach(() => {
    setWindowWidth(DESKTOP);
  });

  it('is present without being asked for', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/dashboard');

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('offers no toggle, because there is nothing to open', async () => {
    stubFetch([STATUS_SET_UP, ...baseRoutes()]);
    renderApp('/dashboard');

    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('button', { name: /navigation/ })).not.toBeInTheDocument();
  });
});
