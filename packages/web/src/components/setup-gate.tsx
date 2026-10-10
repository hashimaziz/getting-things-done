/**
 * The setup gate.
 *
 * Two questions the router has to answer before it can render anything: has setup
 * run, and is this person allowed past it. Both need an answer, and answering them
 * per-route produces a flash of the wrong screen on every load — the dashboard
 * rendering for 80ms before the wizard replaces it, or the wizard appearing over a
 * fully configured app.
 *
 * So the gate waits. It is a deliberate blank while the answer is in flight.
 *
 * And it distinguishes "not set up" from "could not ask". Those are different
 * answers, and treating the second as the first was a bug with teeth: a configured
 * app whose API had not finished booting opened the wizard, which invites running
 * setup a second time over the top of the categories already there. An unanswered
 * question now produces a connection error and a button to ask again, and only a
 * definite `false` sends anyone to setup.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { Button } from '@/components/ui';
import { useStatus } from '@/lib/hooks';

export function SetupGate({ children }: { children: ReactNode }) {
  const { data: status, isPending, isError, refetch, isFetching } = useStatus();

  if (isPending) {
    return <Waiting label="Checking whether setup is finished" />;
  }

  // The question could not be answered. Say that, rather than answering it wrongly.
  if (isError) {
    return <ApiUnreachable onRetry={() => void refetch()} busy={isFetching} />;
  }

  if (status?.setupCompleted !== true) {
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
  const { data: status, isPending, isError, refetch, isFetching } = useStatus();

  if (isPending) {
    return <Waiting label="Loading" />;
  }

  // Same reasoning as the gate, in the other direction: showing the wizard because the
  // API was unreachable invites a second setup over the first.
  if (isError) {
    return <ApiUnreachable onRetry={() => void refetch()} busy={isFetching} />;
  }

  if (status?.setupCompleted === true) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

/**
 * Shown when `/status` cannot be reached.
 *
 * Says what is wrong and offers to ask again, because the usual cause is a server
 * that is one more second from starting. Deliberately not a link into setup: the
 * wizard's whole purpose is to create categories, and arriving here from a boot race
 * does not mean anyone needs any.
 */
function ApiUnreachable({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <h1 className="text-lg font-semibold">Cannot reach the GTD server</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The app could not ask whether setup is finished. That usually means the server is still
        starting, or is not running — check that <code>pnpm dev</code> is up, then try again. Your
        data has not been touched.
      </p>
      <Button onClick={onRetry} disabled={busy}>
        {busy ? 'Trying…' : 'Try again'}
      </Button>
    </div>
  );
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
