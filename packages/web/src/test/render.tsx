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

  // A query client with no retries and no caching: retries in a test turn a
  // deterministic failure into a timeout, and a shared cache lets one test's data
  // satisfy another test's query.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

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
