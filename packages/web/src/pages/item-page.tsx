/**
 * One item, edited.
 *
 * The lifecycle actions live here rather than in a menu elsewhere, because the moment
 * someone decides something is done is the moment they are looking at it.
 *
 * Every action goes through the server's transition rules. Completing an item is not
 * "set container to done" — it stamps a completion time, records the activity entry
 * and, for a recurring item, schedules the next occurrence. Doing it client-side
 * would mean three screens implementing the same rule slightly differently.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
  Textarea,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { FieldEditor } from '@/components/items/field-editor';
import {
  useCategories,
  useFieldDefinitions,
  useItem,
  useMoveItem,
  useUpdateItem,
} from '@/lib/hooks';
import { apiFetch } from '@/lib/api';
import { useDocumentTitle } from '@/lib/document-title';
import { validateItem } from '@/lib/item-editor';
import { fromLocalInputValue, toLocalInputValue } from '@/components/items/field-editor';
import { formatDateTime } from '@/lib/item-list/format';
import type { FieldValue } from '@/lib/types';

export function ItemPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const query = useItem(id);
  const categories = useCategories();
  const fields = useFieldDefinitions();
  const update = useUpdateItem(id);
  const move = useMoveItem();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [estimate, setEstimate] = useState<string>('');
  const [deadline, setDeadline] = useState('');
  const [whenAt, setWhenAt] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [waitingOn, setWaitingOn] = useState('');
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [dirty, setDirty] = useState(false);

  const item = query.data;

  // Seeded from the item once it arrives. Keyed on the id so switching between two
  // items does not leave the second one showing the first one's edits.
  useEffect(() => {
    if (!item) {
      return;
    }
    setTitle(item.title);
    setNotes(item.notes ?? '');
    setEstimate(item.estimateMinutes === null ? '' : String(item.estimateMinutes));
    setDeadline(item.deadlineOn ?? '');
    setWhenAt(item.whenAt === null ? '' : toLocal(item.whenAt));
    setFollowUpAt(item.followUpAt === null ? '' : toLocal(item.followUpAt));
    setWaitingOn(item.waitingOnPersonId ?? '');
    setValues(item.values ?? {});
    setDirty(false);
  }, [item?.id]);

  useDocumentTitle(item?.title ?? 'Item');

  const definitions = useMemo(() => {
    if (!item) {
      return [];
    }
    // Only the fields this item's category actually has, plus global ones.
    return (fields.data ?? []).filter(
      (definition) => definition.categoryId === null || definition.categoryId === item.categoryId,
    );
  }, [fields.data, item?.categoryId, item]);

  const problems = useMemo(
    () =>
      item
        ? validateItem(definitions, values, {
            title,
            // Only checked for the containers where the rule applies. A next action
            // with no hard date is ordinary; a calendar item without one is not a
            // calendar item. The key is absent rather than undefined so the checker
            // can tell "not applicable" from "set to nothing".
            ...(item.container === 'calendar' ? { whenAt } : {}),
            ...(item.container === 'waiting' ? { waitingOnPersonId: waitingOn, followUpAt } : {}),
          })
        : [],
    [definitions, values, title, whenAt, waitingOn, followUpAt, item?.container],
  );

  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setDirty(true);
    };

  const save = async (): Promise<void> => {
    if (problems.length > 0) {
      // Said plainly rather than as a red border on a field someone may not be
      // looking at.
      toast.error('Fix the highlighted fields first');
      return;
    }

    await update.mutateAsync({
      title,
      notes: notes === '' ? null : notes,
      estimateMinutes: estimate === '' ? null : Number(estimate),
      deadlineOn: deadline === '' ? null : deadline,
      whenAt: whenAt === '' ? null : String(fromLocal(whenAt)),
      followUpAt: followUpAt === '' ? null : followUpAt.slice(0, 10),
      waitingOnPersonId: waitingOn === '' ? null : waitingOn,
      data: values,
    });

    setDirty(false);
    toast.success('Saved');
  };

  const act = async (container: string, label: string): Promise<void> => {
    try {
      await move.mutateAsync({ id, container });
      toast.success(label);
    } catch (error) {
      // The server owns the transition rules, so its refusal is the answer, not an
      // error to work around.
      toast.error(error instanceof Error ? error.message : 'That move is not allowed');
    }
  };

  if (query.isPending) {
    return (
      <Page>
        <PageHeader title="Loading" />
      </Page>
    );
  }

  if (query.isError || !item) {
    return (
      <Page>
        <PageHeader title="Not found" />
        <p className="text-sm text-muted-foreground">
          This item is not in the database. It may have been deleted, or the link may be out of
          date.
        </p>
        <Button onClick={() => navigate('/list/inbox')}>Go to the inbox</Button>
      </Page>
    );
  }

  const categoryName =
    (categories.data ?? []).find((category) => category.id === item.categoryId)?.name ??
    'Unknown category';

  return (
    <Page>
      <PageHeader
        title={item.title || 'Untitled'}
        description={`${categoryName} · ${item.container}`}
        actions={
          <>
            {item.container !== 'done' ? (
              <Button size="sm" onClick={() => act('done', 'Completed')}>
                Complete
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => act('next_action', 'Reopened')}>
                Reopen
              </Button>
            )}
            {item.container !== 'trash' ? (
              <Button size="sm" variant="outline" onClick={() => act('trash', 'Moved to trash')}>
                Trash
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => act('next_action', 'Restored')}>
                Restore
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-title">Title</Label>
            <Input
              id="item-title"
              value={title}
              onChange={(event) => change(setTitle)(event.target.value)}
            />
            <FieldError>
              {problems.find((problem) => problem.field === 'title')?.message}
            </FieldError>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="item-notes">Notes</Label>
            <Textarea
              id="item-notes"
              value={notes}
              onChange={(event) => change(setNotes)(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="item-estimate">Estimate (minutes)</Label>
              <Input
                id="item-estimate"
                type="number"
                min={0}
                value={estimate}
                onChange={(event) => change(setEstimate)(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              {/*
                A soft deadline. It never becomes a calendar entry — that is the whole
                point of having both fields, and the labels say so because a person
                under pressure will otherwise assume the date on screen is a promise.
              */}
              <Label htmlFor="item-deadline">Deadline (soft)</Label>
              <Input
                id="item-deadline"
                type="date"
                value={deadline}
                onChange={(event) => change(setDeadline)(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="item-when">Hard date and time</Label>
              <Input
                id="item-when"
                type="datetime-local"
                value={whenAt}
                onChange={(event) => change(setWhenAt)(event.target.value)}
              />
              <FieldError>
                {problems.find((problem) => problem.field === 'whenAt')?.message}
              </FieldError>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="item-follow-up">Follow-up date</Label>
              <Input
                id="item-follow-up"
                type="date"
                value={followUpAt === '' ? '' : followUpAt.slice(0, 10)}
                onChange={(event) => change(setFollowUpAt)(event.target.value)}
              />
              <FieldError>
                {problems.find((problem) => problem.field === 'followUpAt')?.message}
              </FieldError>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
        </CardHeader>
        <CardContent>
          {definitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This category has no custom fields. Add them in settings.
            </p>
          ) : (
            <FieldEditor
              definitions={definitions}
              values={values}
              problems={problems}
              people={[]}
              onChange={(key, value) => {
                setValues((previous) => ({ ...previous, [key]: value }));
                setDirty(true);
              }}
            />
          )}
        </CardContent>
      </Card>

      <Activity itemId={item.id} />

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={update.isPending || !dirty}>
          {dirty ? 'Save' : 'Saved'}
        </Button>
        {dirty ? (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Updated {formatDateTime(item.updatedAt)}
          </span>
        )}
      </div>
    </Page>
  );
}

/**
 * The item's history.
 *
 * Present on the item rather than behind a tab: "when did I move this, and why does
 * it say waiting?" is a question that gets asked while looking at the item, and the
 * answer being one click away is the difference between trusting the data and
 * rebuilding it from memory.
 */
function Activity({ itemId }: { itemId: string }) {
  const [entries, setEntries] = useState<Array<{ id: string; verb: string; at: string }>>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch
      .get<{ entries: Array<{ id: string; verb: string; at: string }> }>(`/items/${itemId}/history`)
      .then((response) => {
        if (!cancelled) {
          setEntries(response.entries);
        }
      })
      // A missing history is not worth an error banner on the item itself.
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (failed) {
    return null;
  }

  if (entries.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="font-medium text-foreground">{entry.verb}</span> ·{' '}
              {formatDateTime(entry.at)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// The wall-clock conversions live with the editor, which is the only other place that
// needs them. Two copies of a timezone conversion is two places for the off-by-an-hour
// bug to live.
const toLocal = toLocalInputValue;
const fromLocal = fromLocalInputValue;
