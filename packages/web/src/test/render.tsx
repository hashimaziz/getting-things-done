/**
 * Renders the whole app at a given route.
 *
 * Tests go through the real router, the real providers and the real components.
 * A test double at the router level would let the shell break without any test
 * noticing, since every test would be rendering a route table that only exists in
 * the test.
 */

import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { ReactElement } from 'react';
import { Toaster } from 'sonner';
import { createRoutes } from '../app/routes';
import { ThemeProvider } from '../lib/theme-provider';

export function renderApp(
  initialPath = '/dashboard',
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const router = createMemoryRouter(createRoutes(), { initialEntries: [initialPath] });

  // Retries off, because in a test a retry turns a deterministic failure into a
  // timeout. Garbage collection left at its default, deliberately: `gcTime: 0` looks
  // like a way to isolate tests, but a failed query is collected the instant it
  // errors, so the next render finds no cache entry, refetches, errors again, and
  // the screen never settles. A client per render already isolates tests, because
  // no two renders share a cache.
  //
  // `staleTime: Infinity` so a second observer mounting later does not refetch what
  // the first one already fetched. With the default of zero every mount refetches, and
  // a test asserting "one request for this data" would fail for a reason that has
  // nothing to do with the code under test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
        {/*
          The real application renders toasts, and several screens report the outcome
          of an action through one. Without the toaster here, a test asserting "the
          server said the move is illegal" has nothing to assert against, and the
          component could drop the message entirely without a failure.
        */}
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { ...result, user: userEvent.setup() };
}

/**
 * Renders one component inside a router.
 *
 * For components that navigate. `renderWithProviders` deliberately has no router:
 * a component that needs one should ask for this, so a test that renders it without
 * a router fails loudly instead of passing against a component that never navigates.
 */
export function renderInRouter(ui: ReactElement, initialPath = '/dashboard') {
  const router = createMemoryRouter([{ path: '*', element: ui }], {
    initialEntries: [initialPath],
  });

  return renderWithProviders(<RouterProvider router={router} />);
}

/** Renders a component with the same providers, for testing one piece. */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {ui}
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>,
    ),
    user: userEvent.setup(),
    queryClient,
  };
}
