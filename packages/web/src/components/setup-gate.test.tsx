import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch } from '@/test/fetch-stub';

/**
 * The gate.
 *
 * These tests exist because the gate is the difference between a usable app and a
 * blank one. Its job is small and its failure modes are severe: show the wizard
 * when setup has not run, keep the wizard away when it has, and never let a screen
 * flash before the answer arrives.
 */

const NOT_SET_UP = { path: '/api/status', body: { app: 'GTD', version: 1, setupCompleted: false } };
const SET_UP = { path: '/api/status', body: { app: 'GTD', version: 1, setupCompleted: true } };

const SHELL_ROUTES = [
  {
    path: '/api/metrics/health',
    body: { health: { inboxBacklog: 0, overdue: 0, waiting: 0, someday: 0 } },
  },
  { path: '/api/categories', body: { categories: [] } },
  { path: '/api/fields', body: { fields: [] } },
];

describe('when the server cannot be reached', () => {
  /*
   * The bug this protects: `/status` failing was read as "setup has not run", so an
   * app that was fully configured opened the wizard whenever the API was a second
   * behind the browser — which `pnpm dev` causes routinely, because it builds the
   * packages before starting anything. The wizard then invites a second setup over
   * the top of the categories that are already there.
   */

  it('does not send a configured app to the wizard when the status call fails', async () => {
    stubFetch([
      {
        path: '/api/status',
        status: 503,
        body: { error: { code: 'unavailable', message: 'starting' } },
      },
    ]);

    renderApp('/dashboard');

    expect(
      await screen.findByRole(
        'heading',
        { name: /Cannot reach the GTD server/ },
        { timeout: 6000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up GTD' })).not.toBeInTheDocument();
  });

  it('does not send an unconfigured app to the wizard it cannot confirm', async () => {
    /*
     * The other direction. Someone who has not set up still needs the server before
     * the wizard can save anything, so this is about the message being honest: "the
     * server is unreachable" is true, and "here is the wizard" pretends to be an
     * answer the app does not have.
     */
    stubFetch([{ path: '/api/status', status: 503, body: { error: { code: 'x', message: 'x' } } }]);

    renderApp('/setup');

    expect(
      await screen.findByRole(
        'heading',
        { name: /Cannot reach the GTD server/ },
        { timeout: 6000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use the defaults' })).toBeNull();
  });

  it('asks again when the server comes back, without a reload', async () => {
    stubFetch([{ path: '/api/status', status: 503, body: { error: { code: 'x', message: 'x' } } }]);

    renderApp('/dashboard');

    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 });

    // The server comes up. The usual cause of all this is a boot that is one more
    // second from finished, so the button has to be enough on its own — no reload.
    const back = stubFetch([SET_UP, ...SHELL_ROUTES]);
    await userEvent.setup().click(retry);

    // The gate lets the app through.
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(back.calls.some((call) => call.path === '/api/metrics/health')).toBe(true);
  });

  it('keeps asking a few times before giving up', async () => {
    const stub = stubFetch([
      { path: '/api/status', status: 503, body: { error: { code: 'x', message: 'x' } } },
    ]);

    renderApp('/dashboard');

    await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 });

    // More than one attempt, so a refused connection during boot resolves on its own.
    // Not a fixed count: what matters is that it tries again rather than asking once.
    expect(stub.calls.filter((call) => call.path === '/api/status').length).toBeGreaterThan(1);
  });
});

describe('the setup gate', () => {
  it('sends an unconfigured app to the wizard', async () => {
    stubFetch([NOT_SET_UP]);

    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Set up GTD' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('sends an unconfigured app to the wizard from anywhere', async () => {
    stubFetch([NOT_SET_UP]);

    // Not only the root. Every entry point has to lead to setup, or a bookmarked
    // deep link lands on an empty list with no explanation.
    renderApp('/list/inbox');

    expect(await screen.findByRole('heading', { name: 'Set up GTD' })).toBeInTheDocument();
  });

  it('lets a configured app through', async () => {
    stubFetch([SET_UP, ...SHELL_ROUTES]);

    renderApp('/dashboard');

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up GTD' })).not.toBeInTheDocument();
  });

  it('does not open the wizard over a configured app when the status check fails', async () => {
    /*
     * This test used to assert the opposite, and it was wrong.
     *
     * Failing closed is right for a definite "no" — a database that answers "setup
     * has not run" should not be written to on the strength of a guess. It is not
     * right for silence. Sending a configured person to the wizard because the API
     * was one second behind offered to create a second set of categories on top of
     * the first, which is the outcome every other test here is defending against.
     */
    stubFetch([
      { path: '/api/status', body: { error: { code: 'boom', message: 'no' } }, status: 500 },
    ]);

    renderApp('/dashboard');

    expect(
      await screen.findByRole(
        'heading',
        { name: /Cannot reach the GTD server/ },
        { timeout: 6000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up GTD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('does not flash the app before the answer arrives', async () => {
    // The gate waits for the answer. Rendering the dashboard first and redirecting
    // a moment later is a flash of a screen that cannot work.
    stubFetch([NOT_SET_UP]);

    renderApp('/dashboard');

    // Immediately after render, with the status request still in flight.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();

    await screen.findByRole('heading', { name: 'Set up GTD' });
  });

  it('announces that it is waiting, so a blank screen reads as waiting', async () => {
    stubFetch([NOT_SET_UP]);

    renderApp('/dashboard');

    // The status region is there before the wizard, which is what makes the blank
    // screen legible rather than broken.
    await waitFor(() => {
      expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    });
  });
});

describe('the wizard guard', () => {
  it('sends a configured user away from the wizard', async () => {
    stubFetch([SET_UP, ...SHELL_ROUTES]);

    renderApp('/setup');

    // The wizard would offer to create a second set of categories beside the first,
    // and the duplicate-key constraint would turn that into a failure two steps in.
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Set up GTD' })).not.toBeInTheDocument();
  });

  it('lets an unconfigured user in', async () => {
    stubFetch([NOT_SET_UP]);

    renderApp('/setup');

    expect(await screen.findByRole('heading', { name: 'Set up GTD' })).toBeInTheDocument();
  });
});
