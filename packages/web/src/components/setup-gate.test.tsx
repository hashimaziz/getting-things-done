import { screen, waitFor } from '@testing-library/react';
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

  it('shows the wizard, not the app, when the status check fails', async () => {
    // Fails closed. The wizard is the recoverable state; a database that will not
    // answer one query should not be written to on the strength of that.
    stubFetch([
      { path: '/api/status', body: { error: { code: 'boom', message: 'no' } }, status: 500 },
    ]);

    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Set up GTD' })).toBeInTheDocument();
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
