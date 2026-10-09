/**
 * Test environment setup.
 *
 * jsdom is missing or wrong about several things the application touches, and each
 * one fails in a way that points somewhere unhelpful. Fixing them here, once, keeps
 * the cause and the fix together and keeps every test file free of environment
 * workarounds.
 *
 * Note that the shims are re-installed after every test. `vi.unstubAllGlobals()` is
 * a blunt instrument: a test that uses it to tidy up after itself also removes
 * these, and the failure then appears in whichever test runs next as a mysterious
 * error from a file that did not cause it.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * React Router builds a `Request` for every client-side navigation and passes the
 * environment's `AbortSignal` along for cancellation. Under jsdom that is jsdom's
 * class, which Node's undici rejects with "Expected signal to be an instance of
 * AbortSignal". The visible symptom is that no link click ever navigates, reported
 * as an unhandled rejection in an unrelated test.
 *
 * Dropping the signal is safe here: this app defines no route loaders or actions,
 * so nothing uses it for cancellation. All data comes from React Query, which
 * manages its own abort controller and is unaffected.
 */
function patchRequest(): void {
  const NativeRequest = globalThis.Request;
  class EnvironmentTolerantRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init: RequestInit = {}) {
      const { signal, ...rest } = init;
      super(input, signal === undefined ? init : rest);
    }
  }
  vi.stubGlobal('Request', EnvironmentTolerantRequest);
}

/** jsdom has no `matchMedia`. The theme code calls it whenever the preference is `system`. */
function patchMatchMedia(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/**
 * A fetch that 404s anything unrouted.
 *
 * Staying stubbed between tests also prevents the real fetch from reappearing
 * mid-run, where an in-flight query being aborted with this environment's signal
 * would raise an unhandled rejection in a test that never made a request.
 */
function patchFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      return new Response(
        JSON.stringify({ error: { code: 'not_found', message: `No stub for ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
}

/**
 * jsdom has no `ResizeObserver`, which cmdk (and therefore the command palette)
 * uses to keep its list sized to the viewport. Without it the palette throws during
 * its first render and the failure appears as a router error page in whatever test
 * happened to render it.
 */
function patchResizeObserver(): void {
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  vi.stubGlobal('ResizeObserverEntry', class {});
}

/**
 * jsdom implements no scrolling. cmdk scrolls the highlighted result into view as the
 * selection moves, and without this the palette throws on the second keystroke.
 */
function patchScrolling(): void {
  if (typeof Element === 'undefined') {
    return;
  }
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

function installEnvironmentShims(): void {
  patchRequest();
  patchMatchMedia();
  patchFetch();
  patchResizeObserver();
  patchScrolling();
}

installEnvironmentShims();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  installEnvironmentShims();

  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
});
