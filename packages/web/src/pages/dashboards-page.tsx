/**
 * Managing dashboards.
 *
 * A dashboard is a saved arrangement of widgets, and arranging one is only half the
 * job: somebody has to be able to say what it is called, make a second one, throw one
 * away, and decide which one the app opens on. None of that was reachable — the
 * dashboard screen showed the default and the settings screen was a placeholder — so
 * the feature existed only for whoever happened to have a default already.
 *
 * The list is the whole feature, and it is ordered by what somebody would do with it:
 * what the app opens on, then the rest.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { useDocumentTitle } from '@/lib/document-title';
import { apiFetch, ApiError } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { WIDGETS } from '@/lib/dashboard/registry';
import type { Dashboard } from '@/lib/types';

/** Why a dashboard failed to save, said the way the server said it. */
function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : 'That did not work.';
}

export function DashboardSettingsPage() {
  useDocumentTitle('Dashboards');

  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const dashboards = useQuery({
    queryKey: keys.dashboards.list,
    queryFn: async () =>
      (await apiFetch.get<{ dashboards: Dashboard[] }>('/dashboards')).dashboards,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: keys.dashboards.all });
  };

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (trimmed === '') {
        // Said here rather than by the server: an empty name is not a request worth
        // making, and the message is already on the screen.
        throw new Error('Give the dashboard a name.');
      }
      const response = await apiFetch.post<{ dashboard: Dashboard }>('/dashboards', {
        name: trimmed,
        // A sensible first screen rather than an empty grid. Somebody who has just
        // named a dashboard has not yet decided what belongs on it, and an empty
        // rectangle teaches nothing about what a widget is.
        widgets: starterWidgets(),
      });
      return response.dashboard;
    },
    onSuccess: (dashboard) => {
      invalidate();
      setName('');
      setNameProblem(null);
      toast.success(`"${dashboard.name}" created`);
    },
    onError: (error) => setNameProblem(failureMessage(error)),
  });

  const rename = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: string }) => {
      await apiFetch.patch(`/dashboards/${id}`, { name: next });
    },
    onSuccess: invalidate,
    onError: (error) => toast.error(failureMessage(error)),
  });

  const makeDefault = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch.patch(`/dashboards/${id}`, { isDefault: true });
    },
    onSuccess: () => {
      invalidate();
      toast.success('Opening dashboard changed');
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const remove = useMutation({
    mutationFn: async (dashboard: Dashboard) => {
      await apiFetch.delete(`/dashboards/${dashboard.id}`);
      return dashboard;
    },
    onSuccess: (dashboard) => {
      invalidate();
      toast.success(`"${dashboard.name}" deleted`);
    },
    onError: (error) => toast.error(failureMessage(error)),
  });

  const list = dashboards.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Dashboards"
        description="A saved arrangement of widgets. The one marked as default is what the app opens on."
      />

      <Card>
        <CardHeader>
          <CardTitle>New dashboard</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="dashboard-name">Name</Label>
              <Input
                id="dashboard-name"
                value={name}
                placeholder="Morning review"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !create.isPending) {
                    void create.mutate();
                  }
                }}
              />
            </div>
            <Button
              onClick={() => void create.mutate()}
              // An empty name is not a request worth making, and a disabled button says
              // that before anyone wonders why nothing happened.
              disabled={create.isPending || name.trim() === ''}
            >
              <Plus />
              Create
            </Button>
          </div>

          {nameProblem === null ? null : (
            <p className="text-xs text-destructive" role="alert">
              {nameProblem}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            New dashboards start with system health, inbox backlog and the overdue count. Add, move
            and remove widgets from the dashboard itself.
          </p>
        </CardContent>
      </Card>

      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No dashboards yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Name one above. Without a dashboard the app opens on an empty screen, which is a poor
              way to learn what a widget is.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((dashboard) => (
            <Card key={dashboard.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle>{dashboard.name}</CardTitle>
                    {dashboard.isDefault ? <Badge>Opens on launch</Badge> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {dashboard.widgets.length}{' '}
                    {dashboard.widgets.length === 1 ? 'widget' : 'widgets'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {dashboard.isDefault ? (
                    <Button size="sm" variant="ghost" disabled>
                      <Check />
                      Opening dashboard
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === dashboard.id}
                      onClick={() => {
                        setBusyId(dashboard.id);
                        void makeDefault.mutateAsync(dashboard.id).finally(() => setBusyId(null));
                      }}
                    >
                      <Check />
                      Open on launch
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // Prefilled with "copy" so a second dashboard usually needs no
                      // typing, and Enter from the inline field saves it.
                      const next = `${dashboard.name} copy`;
                      void rename.mutateAsync({ id: dashboard.id, next });
                    }}
                  >
                    <Plus />
                    Duplicate
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${dashboard.name}`}
                    onClick={() => void remove.mutateAsync(dashboard)}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>

                <Input
                  aria-label={`Rename ${dashboard.name}`}
                  defaultValue={dashboard.name}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    // Not a change worth reporting. Every click elsewhere is a blur.
                    if (next === '' || next === dashboard.name) {
                      event.target.value = dashboard.name;
                      return;
                    }
                    void rename.mutateAsync({ id: dashboard.id, next });
                  }}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Deleting a dashboard removes the arrangement, not any items. Items live in containers; a
        widget is only a view of them.
      </p>
    </Page>
  );
}

/**
 * The layout a new dashboard starts with.
 *
 * Deliberately three widgets that need one source between them. Ten widgets across six
 * different queries is a first screen that is mostly loading.
 */
function starterWidgets(): Array<Record<string, unknown>> {
  return [
    { id: 'w_health', type: 'health.summary', title: null, x: 0, y: 0, width: 6, height: 2 },
    { id: 'w_inbox', type: 'inbox.backlog', title: null, x: 6, y: 0, width: 3, height: 2 },
    { id: 'w_overdue', type: 'overdue.count', title: null, x: 9, y: 0, width: 3, height: 2 },
  ].filter((widget) => WIDGETS.some((definition) => definition.type === widget['type']));
}
