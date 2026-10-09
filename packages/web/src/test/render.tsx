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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { ...result, user: userEvent.setup() };
}

/** Renders a component with the same providers, for testing one piece. */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{ui}</ThemeProvider>
      </QueryClientProvider>,
    ),
    user: userEvent.setup(),
    queryClient,
  };
}
