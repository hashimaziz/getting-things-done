/**
 * Placeholder for a screen that is not built yet.
 *
 * Stated plainly rather than hidden or faked. A placeholder that renders fake
 * numbers is worse than an empty one: it makes an unbuilt feature look like a
 * broken one, and it is easy to ship a screenshot of it by mistake.
 */

import { Page, PageHeader } from '@/components/layout/app-shell';
import { EmptyState } from '@/components/ui';

export function ComingSoon({ title, feature }: { title: string; feature: string }) {
  return (
    <Page>
      <PageHeader title={title} />
      <EmptyState
        title={`${feature} is not built yet`}
        description="This screen is routed so the navigation is honest about what the application will contain."
      />
    </Page>
  );
}
