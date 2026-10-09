/**
 * The application root.
 *
 * Composition only: providers, then the router. Everything with behaviour lives in
 * a module named for what it does, so this file stays readable as a map of the app
 * rather than a place where logic accumulates.
 *
 * The router is built in `useMemo` so a re-render does not discard navigation
 * history, and built inside the component rather than at module scope so nothing
 * shared is created at import time.
 */

import { useMemo } from 'react';
import { createBrowserRouter } from 'react-router';
import { createRoutes } from './app/routes';
import { AppProviders } from './lib/providers';

export function App() {
  const router = useMemo(() => createBrowserRouter(createRoutes()), []);

  return <AppProviders router={router} />;
}
