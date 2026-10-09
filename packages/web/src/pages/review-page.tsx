/**
 * The weekly review.
 *
 * Allen's fourth step, and the one that decides whether the other three were worth doing.
 * It is built as a sequence rather than a list for a reason: most systems fail at the
 * review because they treat it as a page of counts to glance at, when its value comes
 * from working through each collection in the order the method specifies.
 *
 * Each step links to the list it applies to. "Done" is not a tick box — it is having
 * been somewhere and dealt with the work there — and a step with nothing outstanding says
 * so, because a review where every step reports nothing is a good outcome and should
 * look like one.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Progress } from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { useDocumentTitle } from '@/lib/document-title';
import { apiFetch } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { todayIso } from '@/lib/calendar';
import {
  actionLabelFor,
  completionPercent,
  daysSinceReview,
  describeViolation,
  destinationFor,
  groupByPhase,
  nextStep,
  reviewCadenceLabel,
  statusOf,
} from '@/lib/review';
import type { ReviewProgress, ReviewStep, SystemHealth, SystemViolation } from '@/lib/types';

interface ReviewResponse {
  phases: Array<{ id: string; title: string; description: string }>;
  steps: ReviewStep[];
  progress: ReviewProgress[];
  lastReviewAt: string | null;
  outstanding: number;
  violations: SystemViolation[];
}

export function ReviewPage() {
  useDocumentTitle('Weekly Review');

  const queryClient = useQueryClient();
  const today = todayIso();
  const [expanded, setExpanded] = useState<string | null>(null);

  const review = useQuery({
    queryKey: keys.review.data,
    queryFn: async () => await apiFetch.get<ReviewResponse>('/review'),
  });

  const health = useQuery({
    queryKey: keys.metrics.health,
    queryFn: async () => (await apiFetch.get<{ health: SystemHealth }>('/metrics/health')).health,
  });

  const complete = useMutation({
    mutationFn: async () =>
      (await apiFetch.post<{ lastReviewAt: string }>('/review/complete')).lastReviewAt,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.review.all });
      toast.success('Weekly review recorded');
    },
  });

  const data = review.data;
  const groups = useMemo(
    () => (data === undefined ? [] : groupByPhase(data.progress, data.phases)),
    [data],
  );
  const upcoming = nextStep(data?.progress ?? []);
  const days = daysSinceReview(data?.lastReviewAt ?? null, today);
  const cadence = reviewCadenceLabel(days);

  if (review.isPending) {
    return (
      <Page>
        <PageHeader title="Weekly Review" />
      </Page>
    );
  }

  if (review.isError || !data) {
    return (
      <Page>
        <PageHeader title="Weekly Review" />
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              {review.error instanceof Error
                ? review.error.message
                : 'The review could not be loaded.'}
            </p>
            <Button onClick={() => void review.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Weekly Review"
        description="Work through each collection. The order is the order the method gives, not the order that is easiest."
        actions={
          <Button size="sm" onClick={() => complete.mutate()} disabled={complete.isPending}>
            Mark review complete
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">{describeOutstanding(data.outstanding)}</span>
            <Badge
              variant={
                cadence.tone === 'ok'
                  ? 'success'
                  : cadence.tone === 'problem'
                    ? 'destructive'
                    : 'warning'
              }
            >
              {cadence.label}
            </Badge>
          </div>

          <Progress value={completionPercent(data.progress)} />

          {upcoming !== null ? (
            <p className="text-xs text-muted-foreground">
              Start with <span className="font-medium text-foreground">{upcoming.step.title}</span>
              {destinationFor(upcoming.step) === null ? ' — this one you do from memory.' : '.'}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing outstanding. That is what a review is for.
            </p>
          )}
        </CardContent>
      </Card>

      {data.violations.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">
              {data.violations.length} {data.violations.length === 1 ? 'thing is' : 'things are'}{' '}
              inconsistent
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-xs">
            {data.violations.map((violation) => (
              <p
                key={`${violation.kind}-${violation.itemIds.join(',')}`}
                className="text-muted-foreground"
              >
                {describeViolation(violation.message)}
                {violation.itemIds.length > 0 ? ` (${violation.itemIds.length})` : ''}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {groups.map((group) => (
        <Card key={group.phase}>
          <CardHeader>
            <div className="flex items-baseline justify-between gap-2">
              <CardTitle>{group.title}</CardTitle>
              <span className="text-xs text-muted-foreground">
                {group.satisfied} of {group.steps.length} clear
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{group.description}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {group.steps.map((entry) => {
              const status = statusOf(entry);
              const destination = destinationFor(entry.step);
              const isOpen = expanded === entry.step.id;

              return (
                <div key={entry.step.id} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{entry.step.title}</p>
                      <p className="text-xs text-muted-foreground">{entry.step.description}</p>
                    </div>
                    <Badge
                      variant={
                        status.tone === 'ok'
                          ? 'success'
                          : status.tone === 'problem'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {status.label}
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {destination === null ? (
                      // No destination means no button. A link to a screen that does not
                      // exist is worse than saying plainly that this step is done from
                      // memory.
                      <span className="text-[0.6875rem] text-muted-foreground">
                        Done from memory, away from the screen.
                      </span>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <Link to={destination}>{actionLabelFor(entry.step)}</Link>
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : entry.step.id)}
                    >
                      {isOpen ? 'Hide detail' : 'What this means'}
                    </Button>
                  </div>

                  {isOpen ? (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.6875rem] text-muted-foreground">
                      <dt>Outstanding</dt>
                      <dd className="tabular-nums">{entry.pending}</dd>
                      <dt>Flagged</dt>
                      <dd className="tabular-nums">{entry.problems}</dd>
                      <dt>Source</dt>
                      <dd>{entry.step.source}</dd>
                    </dl>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {health.data !== undefined ? <ReviewFooter health={health.data} /> : null}
    </Page>
  );
}

/**
 * How much is left, as a sentence.
 *
 * Split out because the singular needs "has" rather than "have", and a mismatch there is
 * the kind of small wrongness that makes a whole screen feel unpolished.
 */
export function describeOutstanding(outstanding: number): string {
  if (outstanding === 0) {
    return 'Everything has been reviewed.';
  }
  return outstanding === 1
    ? '1 collection still has something outstanding.'
    : `${outstanding} collections still have something outstanding.`;
}

/**
 * The numbers behind the review.
 *
 * At the end rather than the start, because a person who reads a wall of counts before
 * starting decides they will do it later.
 */
function ReviewFooter({ health }: { health: SystemHealth }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Right now</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Inbox</dt>
            <dd className="tabular-nums">{health.inboxBacklog}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Overdue</dt>
            <dd className="tabular-nums">{health.overdue}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Waiting</dt>
            <dd className="tabular-nums">{health.waiting}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Someday</dt>
            <dd className="tabular-nums">{health.someday}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
