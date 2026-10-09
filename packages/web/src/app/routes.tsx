/**
 * Route table.
 *
 * Exported as a factory rather than a constant because a router owns history state.
 * A module-level router is fine in `main.tsx` and wrong in tests, where a second
 * `createMemoryRouter` must not inherit the first one's location.
 *
 * Paths that are not built yet render {@link ComingSoon} rather than 404ing. A
 * navigation entry that leads to "not found" reads as a broken application, and the
 * sidebar already links everywhere.
 */

import type { RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { ComingSoon } from '@/pages/coming-soon';
import { NotFound } from '@/pages/not-found';
import { SetupGate, SetupRedirect } from '@/components/setup-gate';
import { SetupWizard } from '@/pages/setup-wizard';
import { ShortcutSettings } from '@/pages/shortcut-settings';
import { ListPage } from '@/pages/list-page';
import { ItemPage } from '@/pages/item-page';
import { CapturePage } from '@/pages/capture-page';
import { ClarifyPage } from '@/pages/clarify-page';

export function createRoutes(): RouteObject[] {
  return [
    {
      // The wizard and the app guard each other: one refuses to run twice, the
      // other refuses to run at all until it has. Without both, the only thing
      // standing between a fresh database and an empty, unusable app is one of
      // them remembering.
      path: '/setup',
      element: (
        <SetupRedirect>
          <SetupWizard />
        </SetupRedirect>
      ),
    },
    {
      element: (
        <SetupGate>
          <AppShell />
        </SetupGate>
      ),
      children: [
        { index: true, element: <ComingSoon title="Dashboard" feature="Dashboard widgets" /> },
        {
          path: '/dashboard',
          element: <ComingSoon title="Dashboard" feature="Dashboard widgets" />,
        },
        { path: '/capture', element: <CapturePage /> },
        { path: '/clarify', element: <ClarifyPage /> },
        { path: '/list/:container', element: <ListPage /> },
        { path: '/item/:id', element: <ItemPage /> },
        {
          path: '/calendar',
          element: <ComingSoon title="Calendar" feature="Week and month grid" />,
        },
        { path: '/projects', element: <ComingSoon title="Projects" feature="Project review" /> },
        { path: '/review', element: <ComingSoon title="Weekly Review" feature="Guided review" /> },
        { path: '/archive', element: <ComingSoon title="Archive" feature="Completed browser" /> },
        { path: '/settings', element: <ComingSoon title="Settings" feature="Settings" /> },
        {
          path: '/settings/categories',
          element: <ComingSoon title="Categories" feature="Category editor" />,
        },
        {
          path: '/settings/fields',
          element: <ComingSoon title="Fields" feature="Field editor" />,
        },
        {
          path: '/settings/reference',
          element: <ComingSoon title="Reference Data" feature="Projects, people, contexts" />,
        },
        {
          path: '/settings/templates',
          element: <ComingSoon title="Checklist Templates" feature="Template editor" />,
        },
        {
          path: '/settings/dashboards',
          element: <ComingSoon title="Dashboards" feature="Widget layout editor" />,
        },
        { path: '/settings/shortcuts', element: <ShortcutSettings /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ];
}
