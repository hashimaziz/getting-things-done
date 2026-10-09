/**
 * Clarify.
 *
 * Allen's second step, and the one most systems get wrong by turning into a form.
 * The questions are asked of a person, in order, skipping the ones already answered,
 * because a clarifying conversation that reads five questions to get one answer is a
 * form with better manners.
 *
 * Everything the flow decides goes through `decide`, which refuses decisions that would
 * produce an invalid item. An item in the calendar with no hard date is not a calendar
 * item; an item in waiting with nobody to wait on is not waiting for anything. Catching
 * that here, with a sentence a person can act on, is the difference between a flow and
 * a data entry screen.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
  Label,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { useCategories, useItems, useMoveItem } from '@/lib/hooks';
import { useDocumentTitle } from '@/lib/document-title';
import { CLARIFY_QUESTIONS, decide, describeDecision, type ClarifyKind } from '@/lib/clarify';
import type { Person } from '@/lib/types';
import { apiFetch } from '@/lib/api';

/** The decision a delegation always produces, for describing it before committing. */
const DELEGATE_DECISION = { kind: 'delegate', container: 'waiting', reason: '' } as const;

export function ClarifyPage() {
  useDocumentTitle('Clarify');

  const navigate = useNavigate();
  const move = useMoveItem();
  const categories = useCategories();

  const inbox = useItems({ container: 'inbox', limit: 1, offset: 0 });
  const [people, setPeople] = useState<Person[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [answered, setAnswered] = useState(0);

  const [waitingOn, setWaitingOn] = useState('');
  const [followUp, setFollowUp] = useState('');

  useEffect(() => {
    // People are needed only for the delegation question, and only then are they
    // fetched. Asking for them up front is a question before the question.
    void apiFetch
      .get<{ people: Person[] }>('/people')
      .then((response) => setPeople(response.people))
      // A missing people list does not block the other four questions.
      .catch(() => setPeople([]));
  }, []);

  const current = inbox.data?.items[0];

  const categoryName = useMemo(() => {
    const id = current?.categoryId;
    return (categories.data ?? []).find((category) => category.id === id)?.name ?? '';
  }, [categories.data, current?.categoryId]);

  const answer = async (kind: ClarifyKind): Promise<void> => {
    if (!current) {
      return;
    }

    const result = decide({
      kind,
      waitingOnPersonId: kind === 'delegate' ? waitingOn : null,
      followUpAt: kind === 'delegate' ? followUp : null,
    });

    if (!result.ok) {
      // Feedback, not an error: the person is mid-flow and needs to know which
      // question was skipped.
      setProblem(result.problem);
      return;
    }

    try {
      await move.mutateAsync({ id: current.id, container: result.decision.container });
      setProblem(null);
      setAnswered((count) => count + 1);
      setWaitingOn('');
      setFollowUp('');

      // Back to page one of the inbox, since the item just left it.
      await inbox.refetch();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That move is not allowed');
    }
  };

  const chosenPerson = people.find((person) => person.id === waitingOn);
  const total = inbox.data?.total ?? 0;

  if (inbox.isPending) {
    return (
      <Page>
        <PageHeader title="Clarify" />
      </Page>
    );
  }

  if (!current) {
    return (
      <Page>
        <PageHeader title="Clarify" description={`${total} in the inbox`} />
        <Card>
          <CardHeader>
            <CardTitle>The inbox is empty</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {answered === 0
                ? 'Nothing has been captured yet.'
                : `All ${answered} ${answered === 1 ? 'item' : 'items'} clarified this session.`}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => navigate('/capture')}>
                Capture something
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/list/inbox')}>
                Open the inbox
              </Button>
            </div>
          </CardContent>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Clarify"
        description={`${total} left in the inbox${categoryName === '' ? '' : ` · captured as ${categoryName}`}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>{current.title}</CardTitle>
          {current.notes ? <p className="text-xs text-muted-foreground">{current.notes}</p> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Decide one thing at a time. Nothing here is permanent: everything can be moved later.
          </p>

          {/*
            Every question is shown at once, with the delegation details revealed only
            when that answer is chosen. Showing one question at a time hides the shape
            of the decision; showing all five hides nothing but wastes a screen. The
            middle ground is all five questions, and the extra fields only when asked.
          */}
          <div className="flex flex-col gap-2">
            {CLARIFY_QUESTIONS.map((entry) => (
              <div key={entry.kind} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={move.isPending}
                    onClick={() => void answer(entry.kind)}
                  >
                    {entry.question}
                  </Button>
                  <span className="text-xs text-muted-foreground">{entry.hint}</span>
                </div>

                {entry.kind === 'delegate' ? (
                  <div className="flex flex-wrap items-center gap-2 pl-1">
                    <Label htmlFor="clarify-person">Waiting on</Label>
                    <select
                      id="clarify-person"
                      value={waitingOn}
                      onChange={(event) => setWaitingOn(event.target.value)}
                      className="h-8 rounded border border-input bg-background px-2 text-xs"
                    >
                      <option value="">Someone…</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>

                    <Label htmlFor="clarify-follow-up">Follow up on</Label>
                    <input
                      id="clarify-follow-up"
                      type="date"
                      value={followUp}
                      onChange={(event) => setFollowUp(event.target.value)}
                      className="h-8 rounded border border-input bg-background px-2 text-xs"
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <FieldError>{problem}</FieldError>

          {/*
            Shown as a sentence before it is committed elsewhere in the app: "Waiting
            on Dana" is understood instantly, and it is the last chance to notice the
            wrong answer.
          */}
          <p className="text-xs text-muted-foreground">
            Delegating will move this to{' '}
            {describeDecision(DELEGATE_DECISION, { personName: chosenPerson?.name }).toLowerCase()}
          </p>
        </CardContent>
      </Card>
    </Page>
  );
}
