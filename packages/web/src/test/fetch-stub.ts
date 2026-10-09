/**
 * A fetch stub driven by route patterns.
 *
 * Component tests need the server's answers without a server. Rather than mocking
 * the fetch call itself, this answers requests by path, so a test states the data
 * the API would return and the component code runs unmodified, exactly as in the
 * browser. Anything unrouted 404s loudly, which catches a component asking for an
 * endpoint that does not exist.
 */

import { vi } from 'vitest';

export interface StubbedRoute {
  /** Matched against the pathname only, so query strings are ignored. */
  path: string | RegExp;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** A value, or a function of the parsed URL for dynamic answers. */
  body: unknown | ((url: URL) => unknown);
  status?: number;
}

export interface FetchStub {
  /** Every request made, in order, as `{ method, path, search }`. */
  readonly calls: Array<{ method: string; path: string; search: URLSearchParams }>;
  restore: () => void;
}

export function stubFetch(routes: StubbedRoute[]): FetchStub {
  const calls: FetchStub['calls'] = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();

    calls.push({ method, path: url.pathname, search: url.searchParams });

    const route = routes.find(
      (candidate) =>
        (candidate.method ?? 'GET') === method &&
        (typeof candidate.path === 'string'
          ? candidate.path === url.pathname
          : candidate.path.test(url.pathname)),
    );

    if (!route) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'not_found',
            message: `No stub for ${method} ${url.pathname}`,
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const payload = typeof route.body === 'function' ? route.body(url) : route.body;
    return new Response(JSON.stringify(payload), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', impl);

  return {
    calls,
    restore: () => vi.unstubAllGlobals(),
  };
}

/** A health payload with sensible zero values, overridable per test. */
export function healthPayload(overrides: Record<string, unknown> = {}) {
  return {
    health: {
      inboxBacklog: 0,
      inboxOldest: null,
      overdue: 0,
      dueSoon: 0,
      scheduledOn: '2026-03-02',
      scheduledCount: 0,
      waiting: 0,
      waitingOverdue: 0,
      waitingOldestDays: 0,
      someday: 0,
      openWithoutEstimate: 0,
      openMinutes: 0,
      openWithoutProject: 0,
      ...overrides,
    },
  };
}
