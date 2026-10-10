/**
 * The danger zone.
 *
 * Wiping everything is a legitimate thing to want — a system built up over months can
 * become one you no longer want, and deleting the database file by hand also takes the
 * directory and the WAL files. So it is a button.
 *
 * What makes it a button rather than a hazard is the confirmation. You are shown what
 * will be deleted, counted from the database rather than described vaguely, and you
 * have to type a phrase before anything happens. The phrase is not a "are you sure?"
 * dialog: a dialog is dismissed by muscle memory, and this one cannot be dismissed by
 * accident because nothing happens until the words match.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface WipePreview {
  confirmation: string;
  tables: Array<{ table: string; rows: number }>;
  total: number;
}

export function DangerZone() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState('');

  const preview = useQuery({
    queryKey: ['system', 'wipe-preview'],
    queryFn: async () => await apiFetch.get<WipePreview>('/system/wipe/preview'),
  });

  const wipe = useMutation({
    mutationFn: async () =>
      apiFetch.post<{ wiped: number; remaining: number }>('/system/wipe', {
        confirm: preview.data?.confirmation ?? 'WIPE EVERYTHING',
      }),
    onSuccess: (result) => {
      /*
       * Every cached query is dropped, not invalidated. There is nothing left to
       * invalidate *from* — the categories the queries describe no longer exist — so
       * clearing is both correct and the only thing that cannot leave a stale page
       * behind.
       */
      queryClient.clear();
      setConfirming(false);
      setPhrase('');
      toast.success(`Everything wiped: ${result.wiped} rows removed`);
      // A full reload rather than a client-side navigation, because every route in the
      // application renders from data that is now gone.
      window.location.assign('/setup');
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'The wipe did not happen');
    },
  });

  const total = preview.data?.total ?? 0;
  const matches = phrase === (preview.data?.confirmation ?? 'WIPE EVERYTHING');

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4" />
          Danger zone
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Delete every item, category, field, project and setting, and return the application to
          first-run setup. The database structure is kept, so setup can be done again immediately.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {preview.isError ? (
          <p className="text-xs text-muted-foreground">
            Could not read what would be deleted. The button is disabled so nothing is destroyed on
            a guess.
          </p>
        ) : (
          <p className="text-sm">
            This would delete <span className="font-semibold tabular-nums">{total}</span>{' '}
            {total === 1 ? 'row' : 'rows'} across items, categories, fields, reference data,
            dashboards and settings.
          </p>
        )}

        {confirming ? (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
            <label className="text-xs font-medium" htmlFor="wipe-confirmation">
              Type{' '}
              <span className="font-mono">{preview.data?.confirmation ?? 'WIPE EVERYTHING'}</span>{' '}
              to confirm
            </label>
            <Input
              id="wipe-confirmation"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder="Type the phrase"
              autoComplete="off"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={!matches || wipe.isPending}
                onClick={() => wipe.mutate()}
              >
                {wipe.isPending ? 'Wiping…' : 'Delete everything'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  setPhrase('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={preview.isError || total === 0}
            onClick={() => setConfirming(true)}
          >
            Wipe everything and start again
          </Button>
        )}

        {total === 0 && !preview.isError ? (
          <p className="text-xs text-muted-foreground">
            There is nothing to delete, so the button is disabled.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
