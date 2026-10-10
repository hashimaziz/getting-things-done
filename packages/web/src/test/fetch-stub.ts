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

export interface RecordedCall {
  method: string;
  path: string;
  search: URLSearchParams;
  /** The parsed JSON body, or undefined for a request without one. */
  body: Record<string, unknown> | undefined;
}

export interface FetchStub {
  /** Every request made, in order. */
  readonly calls: RecordedCall[];
  /** The body of the most recent call with the given method and path suffix. */
  lastBody: (method: string, pathSuffix: string) => Record<string, unknown> | undefined;
  restore: () => void;
}

/**
 * Whether a route answers a pathname.
 *
 * Supports `:param` segments, so a test can write `/api/items/:id` once rather than
 * hard-coding an id in every test that navigates. An exact string still matches only
 * itself, which is what the dashboard's own id needs.
 */
function pathMatches(pattern: string | RegExp, pathname: string): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(pathname);
  }
  if (!pattern.includes(':')) {
    return pattern === pathname;
  }

  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) {
    return false;
  }
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

export function stubFetch(routes: StubbedRoute[]): FetchStub {
  const calls: RecordedCall[] = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;

    calls.push({ method, path: url.pathname, search: url.searchParams, body });

    const route = routes.find(
      (candidate) =>
        (candidate.method ?? 'GET') === method && pathMatches(candidate.path, url.pathname),
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

    /*
     * A 204 carries no body, and the Response constructor refuses to be given one.
     * Every delete endpoint in the application answers 204, so a test that stubs one
     * with `body: null` — the obvious way to write it — failed inside the stub rather
     * than in the assertion it was written for.
     */
    if (payload === null || payload === undefined) {
      return new Response(null, { status: route.status ?? 200 });
    }

    return new Response(JSON.stringify(payload), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', impl);

  return {
    calls,
    lastBody: (method, pathSuffix) =>
      [...calls].reverse().find((call) => call.method === method && call.path.endsWith(pathSuffix))
        ?.body,
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
