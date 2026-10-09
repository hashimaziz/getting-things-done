/**
 * Application providers.
 *
 * React Query is configured here, and the defaults are not the library's. Two
 * matter:
 *
 * - Retries are off for 4xx, because a request that was rejected as malformed will
 *   be rejected identically every time, and retrying it just delays the error the
 *   user needs to see by three seconds.
 * - `refetchOnWindowFocus` is off. This is a single-user local app with a database
 *   on the same machine: nothing changes underneath it while the window is in the
 *   background, and refetching on every tab switch is pure noise.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { RouterProvider, type RouterProviderProps } from 'react-router';
import { Toaster } from 'sonner';
import { ApiError } from './api';
import { ThemeProvider } from './theme-provider';
import { ErrorBoundary } from '../components/error-boundary';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export interface AppProvidersProps {
  /**
   * A router instance, passed in rather than built here. The browser app uses a
   * browser router and tests use a memory router; both then get identical providers,
   * and no navigation state is shared between tests.
   */
  router: RouterProviderProps['router'];
  children?: ReactNode;
}

export function AppProviders({ router, children }: AppProvidersProps) {
  // Created in state, not module scope: two AppProviders in one test run must not
  // share a cache.
  const [queryClient] = useState(createQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {children ?? <RouterProvider router={router} />}
          <Toaster position="bottom-right" closeButton richColors />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
