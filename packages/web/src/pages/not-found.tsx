/**
 * The not-found page.
 *
 * Shows where the user came from and where they can go, because "404" alone leaves
 * someone who mistyped a URL with no idea whether the app is broken or the link was
 * wrong.
 */

import { Link, useLocation } from 'react-router';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { EmptyState } from '@/components/ui';
import { ALL_NAV_ITEMS } from '@/lib/navigation';

export function NotFound() {
  const { pathname } = useLocation();

  return (
    <Page>
      <PageHeader title="Page not found" />
      <EmptyState
        title={`Nothing is routed at ${pathname}`}
        description="The link may be out of date. Everything the application contains is listed on the left."
        action={
          <Link to="/dashboard" className="text-sm text-primary underline-offset-4 hover:underline">
            Go to the dashboard
          </Link>
        }
      />
      <p className="text-xs text-muted-foreground">
        {ALL_NAV_ITEMS.length} destinations are available.
      </p>
    </Page>
  );
}
