/**
 * The setup gate.
 *
 * Two questions the router has to answer before it can render anything: has setup
 * run, and is this person allowed past it. Both need an answer, and answering them
 * per-route produces a flash of the wrong screen on every load — the dashboard
 * rendering for 80ms before the wizard replaces it, or the wizard appearing over a
 * fully configured app.
 *
 * So the gate waits. It is a deliberate blank while the answer is in flight, and it
 * fails closed: if `/status` cannot be reached, the wizard is shown rather than the
 * app, because the wizard is the recoverable state. A database that will not answer
 * a single query is not one that should be written to.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useStatus } from '@/lib/hooks';

export function SetupGate({ children }: { children: ReactNode }) {
  const { data: status, isPending, isError } = useStatus();

  if (isPending) {
    return <Waiting label="Checking whether setup is finished" />;
  }

  // Failing closed: unknown means not set up.
  if (isError || status?.setupCompleted !== true) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

/**
 * The other direction: someone who has already set the app up, landing on the
 * wizard.
 *
 * Without this, the wizard offers to create a second set of categories alongside
 * the first, and the duplicate-key constraint turns that into a confusing failure
 * halfway through rather than an obvious no.
 */
export function SetupRedirect({ children }: { children: ReactNode }) {
  const { data: status, isPending } = useStatus();

  if (isPending) {
    return <Waiting label="Loading" />;
  }

  if (status?.setupCompleted === true) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

/**
 * Deliberately minimal and explicitly labelled as a live region, so it reads as
 * "waiting" rather than as a broken blank page.
 */
function Waiting({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center p-8 text-sm text-muted-foreground"
    >
      {label}…
    </div>
  );
}
