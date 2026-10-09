/**
 * Capture.
 *
 * The most-used screen in the whole method, and the one with the hardest requirement:
 * capturing must never ask a question. If capture makes you think, you stop capturing,
 * and an inbox that only holds what felt worth typing is an inbox that has already lost
 * things.
 *
 * So this screen has one input, one key, and no decisions. Everything else about an
 * item — is it actionable, which container, is it for later — is asked later, by
 * clarify. The only configuration offered is which category an uncategorised thought
 * lands in, because an item needs a category to exist and asking "which category?"
 * here would be the first question.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Separator,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { useCategories, useCreateItem } from '@/lib/hooks';
import { useDocumentTitle } from '@/lib/document-title';
import { INBOX_CAPTURE_TIPS } from '@/lib/capture-tips';
import type { Category } from '@/lib/types';

export function CapturePage() {
  useDocumentTitle('Capture');

  const [searchParams] = useSearchParams();
  const categories = useCategories();
  const create = useCreateItem();

  const active: Category[] = useMemo(
    () => (categories.data ?? []).filter((category) => !category.isArchived),
    [categories.data],
  );

  /*
   * One category is used for everything by default, and it is chosen rather than
   * asked about. When there is exactly one category the choice is invisible: there is
   * nothing to choose, so the question would be noise.
   */
  const [categoryId, setCategoryId] = useState<string>(() => {
    const fromUrl = searchParams.get('category');
    return fromUrl ?? '';
  });

  const [title, setTitle] = useState('');
  const [saved, setSaved] = useState(0);

  const effectiveCategoryId = categoryId !== '' ? categoryId : (active[0]?.id ?? '');

  const capture = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') {
        return;
      }
      if (effectiveCategoryId === '') {
        // Only reachable with no categories at all, which the setup gate prevents.
        // Said plainly rather than failing with a server error about a foreign key.
        toast.error('Create a category first');
        return;
      }

      await create.mutateAsync({
        categoryId: effectiveCategoryId,
        title: trimmed,
        container: 'inbox',
      });

      // The count is shown rather than a toast each time. A toast per capture is a
      // notification per thought, and notifications are how a capture box becomes
      // something you dismiss.
      setSaved((count) => count + 1);
    },
    [create, effectiveCategoryId],
  );

  const submit = async (): Promise<void> => {
    const text = title;
    // Cleared before awaiting, so the next thought can be typed while this one saves.
    // Waiting would make capture feel like a form submission, which it is not.
    setTitle('');
    await capture(text);
  };

  return (
    <Page>
      <PageHeader
        title="Capture"
        description="Type it and press Enter. Decide what it is later, or not at all."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/list/inbox">Open the inbox</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>What is on your mind?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <textarea
            aria-label="Capture"
            autoFocus
            rows={4}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // Enter captures. Shift+Enter is a newline, because occasionally the
              // thought does need one and rewriting it to fit a single line would
              // lose part of it.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Anything at all. A sentence is fine."
            className="w-full resize-y rounded-md border border-input bg-background p-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/*
                Hidden when there is only one category: a control with one option is a
                question with no answer to give.
              */}
              {active.length > 1 ? (
                <>
                  <Label htmlFor="capture-category">Category</Label>
                  <select
                    id="capture-category"
                    value={effectiveCategoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                    className="h-8 rounded border border-input bg-background px-2 text-xs"
                  >
                    {active.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}

              {/*
                A live region, so the count is announced rather than only visible.
                Someone capturing by keyboard needs to know the thought landed.
              */}
              <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {saved === 0 ? '' : `${saved} captured`}
              </span>
            </div>

            <Button onClick={submit} disabled={title.trim() === ''}>
              Capture
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why there is nothing else here</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {INBOX_CAPTURE_TIPS.map((tip) => (
            <p key={tip.title} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{tip.title}</span> — {tip.body}
            </p>
          ))}
          <Separator />
          {/* A link, not a button: it navigates, and a link can be opened in a new tab,
              copied, and recognised by anything reading the page. */}
          <Button asChild variant="ghost" size="sm" className="self-start">
            <Link to="/clarify">Clarify the inbox →</Link>
          </Button>
        </CardContent>
      </Card>
    </Page>
  );
}
