/**
 * The recurring section of the item editor.
 *
 * Attaching a series is a decision with a visible consequence — this thing will keep
 * happening — so the choice is shown as a sentence before it is saved, along with
 * roughly how many occurrences it will create. Discovering sixty new rows afterwards, by
 * scrolling, is how a database ends up with ten thousand future items nobody asked for.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
  Select,
} from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { formatDate } from '@/lib/item-list/format';
import {
  buildAttachBody,
  defaultChoice,
  describeChoice,
  estimatedOccurrences,
  frequencyPerDay,
  horizonExplanation,
  validateChoice,
  type RecurrenceChoice,
  type RecurrencePreset,
} from '@/lib/recurrence';
import type { Item } from '@/lib/types';

export interface RecurrenceSectionProps {
  item: Item;
  today: string;
  timezone: string | undefined;
  onChanged: () => void;
}

interface OccurrencesResponse {
  template: string;
  rrule: string;
  description: string;
  occurrences: Item[];
}

export function RecurrenceSection({ item, today, timezone, onChanged }: RecurrenceSectionProps) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<RecurrenceChoice>(() => defaultChoice(today));

  const presets = useQuery({
    queryKey: [...keys.recommendations.all, 'recurrence-presets'],
    queryFn: async () =>
      (await apiFetch.get<{ presets: RecurrencePreset[] }>('/recurrence/presets')).presets,
  });

  const series = useQuery({
    queryKey: ['recurrence', item.id],
    queryFn: async () =>
      (await apiFetch.get<OccurrencesResponse>(`/items/${item.id}/occurrences`)).description,
    enabled: item.recurrenceId !== null,
    // A series that has ended returns no rule, which is not an error worth showing.
    retry: false,
  });

  const attach = useMutation({
    mutationFn: async () =>
      apiFetch.post<{ occurrences: Item[] }>(
        `/items/${item.id}/recurrence`,
        buildAttachBody(choice, { timezone }),
      ),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ['recurrence', item.id] });
      void queryClient.invalidateQueries({ queryKey: keys.items.all });
      toast.success(`${response.occurrences.length} occurrences created`);
      onChanged();
    },
    onError: (error) => {
      // The server expands the rule, so its complaint is the only meaningful one. A rule
      // the browser assembled would produce worse errors than this.
      toast.error(error instanceof ApiError ? error.message : 'The series could not be attached');
    },
  });

  const detach = useMutation({
    mutationFn: async () => apiFetch.delete(`/items/${item.id}/recurrence`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurrence', item.id] });
      void queryClient.invalidateQueries({ queryKey: keys.items.all });
      toast.success('Series removed');
      onChanged();
    },
    // Without this the button appears to do nothing, and the item keeps repeating.
    onError: () => toast.error('The series could not be removed'),
  });

  const problem = validateChoice(choice);
  /*
   * Attaching before the presets arrive means committing to a frequency the user never
   * saw named — the dropdown would be empty while the button still worked.
   */
  const presetsProblem = presets.isError
    ? 'The list of frequencies could not be loaded.'
    : presets.data === undefined
      ? 'Loading frequencies…'
      : presets.data.length === 0
        ? 'No frequencies are configured.'
        : null;
  const presetLabel =
    presets.data?.find((preset) => preset.key === choice.preset)?.label ?? choice.preset;
  const estimate = useMemo(
    () => estimatedOccurrences(choice, frequencyPerDay(choice.preset)),
    [choice],
  );

  if (item.recurrenceId !== null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="size-4" />
            Repeats
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm">{series.data ?? 'This item repeats.'}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={detach.isPending}
              onClick={() => detach.mutate()}
            >
              Stop repeating
            </Button>
            <span className="text-xs text-muted-foreground">
              Removing the rule also removes the occurrences already created.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="size-4" />
          Make this repeat
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A series creates its next occurrences ahead of time, so it never runs out silently.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="recurrence-preset">How often</Label>
            <Select
              id="recurrence-preset"
              value={choice.preset}
              onChange={(event) => setChoice({ ...choice, preset: event.target.value })}
              className="w-44"
            >
              {(presets.data ?? []).map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="recurrence-start">Starting</Label>
            <Input
              id="recurrence-start"
              type="date"
              className="w-40"
              value={choice.anchorDate}
              onChange={(event) => setChoice({ ...choice, anchorDate: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="recurrence-time">At (optional)</Label>
            <Input
              id="recurrence-time"
              type="time"
              className="w-32"
              value={choice.startTime}
              onChange={(event) => setChoice({ ...choice, startTime: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="recurrence-end">Stops</Label>
            <Select
              id="recurrence-end"
              value={choice.end.kind}
              onChange={(event) => {
                const kind = event.target.value as RecurrenceChoice['end']['kind'];
                setChoice({
                  ...choice,
                  end:
                    kind === 'never'
                      ? { kind: 'never' }
                      : kind === 'on'
                        ? { kind: 'on', date: choice.anchorDate }
                        : { kind: 'after', count: 10 },
                });
              }}
              className="w-36"
            >
              <option value="never">Never</option>
              <option value="on">On a date</option>
              <option value="after">After a count</option>
            </Select>
          </div>

          {choice.end.kind === 'on' ? (
            <Input
              aria-label="Ends on"
              type="date"
              className="w-40"
              value={choice.end.date}
              onChange={(event) =>
                setChoice({ ...choice, end: { kind: 'on', date: event.target.value } })
              }
            />
          ) : null}

          {choice.end.kind === 'after' ? (
            <Input
              aria-label="Number of times"
              type="number"
              min={1}
              className="w-28"
              value={choice.end.count}
              onChange={(event) =>
                setChoice({ ...choice, end: { kind: 'after', count: Number(event.target.value) } })
              }
            />
          ) : null}
        </div>

        {/*
          The consequence, in words, before it is committed. "Every week, from 4 March,
            at 09:00, forever" is understood without knowing what a frequency interval is.
        */}
        <div className="rounded-md border p-2">
          <p className="text-sm">{describeChoice(choice, presetLabel)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            About <Badge variant="secondary">{estimate}</Badge> occurrences will be created.{' '}
            {horizonExplanation(choice.horizonDays)}
          </p>
        </div>

        <FieldError>{problem ?? presetsProblem}</FieldError>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={problem !== null || presetsProblem !== null || attach.isPending}
            onClick={() => attach.mutate()}
          >
            {attach.isPending ? 'Attaching…' : 'Make it repeat'}
          </Button>
          <span className="text-xs text-muted-foreground">
            The first few are {formatDate(choice.anchorDate)} onward.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
