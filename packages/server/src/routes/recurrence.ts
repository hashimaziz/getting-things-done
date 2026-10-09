/**
 * Recurrence routes.
 *
 * Attaching a rule turns an existing item into a recurring series. Occurrences are
 * real rows rather than a live expansion, so they can be completed, deferred or
 * annotated individually; see recurrence-service.ts for why.
 */

import {
  RECURRENCE_PRESETS,
  addDays,
  describeRecurrence,
  expandOccurrences,
  parseRecurrence,
  withRecurrenceDtstart,
  type IsoDate,
  type Item,
} from '@gtd/core';
import { createRecurrenceService } from '@gtd/db';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../http-errors.js';
import { compact } from '../utils/compact.js';
import { expandItem } from './item-helpers.js';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const attachSchema = z.object({
  rrule: z.string().min(1).max(500),
  timezone: z.string().min(1).max(64).optional(),
  anchorDate: isoDateSchema.optional(),
  until: isoDateSchema.nullish(),
  count: z.number().int().min(1).max(10_000).nullish(),
  horizonDays: z.number().int().min(0).max(365).optional(),
});

const materializeSchema = z.object({
  horizonDays: z.number().int().min(0).max(365).optional(),
  from: isoDateSchema.optional(),
});

/** Preview does not need an rrule to be optional, only to be validated. */
const previewSchema = z.object({
  rrule: z.string().min(1).max(500),
  timezone: z.string().min(1).max(64).optional(),
  anchorDate: isoDateSchema.optional(),
});

export function registerRecurrenceRoutes(app: FastifyInstance): void {
  /**
   * Built per call rather than cached, so a timezone setting change takes effect
   * without restarting the server.
   */
  const service = () =>
    createRecurrenceService({
      items: app.repos.items,
      rules: app.repos.recurrenceRules,
      defaultTimezone: app.repos.settings.getKnown('app.timezone') ?? 'UTC',
      now: app.today,
    });

  const expand = (item: Item) =>
    expandItem(item, app.repos.fieldDefs.listForCategory(item.categoryId));

  /** Turns a recurrence error into a 400, since it is the caller's rule at fault. */
  const withRecurrenceErrors = <T>(run: () => T): T => {
    try {
      return run();
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidRecurrenceError') {
        throw new BadRequestError(error.message);
      }
      throw error;
    }
  };

  app.get('/api/recurrence/presets', async () => ({
    presets: RECURRENCE_PRESETS.map((preset) => ({ key: preset.key, label: preset.label })),
  }));

  app.get<{ Params: { id: string } }>('/api/items/:id/occurrences', async (request) => {
    const { id } = request.params;
    const spec = service().specFor(id);
    return {
      template: id,
      rrule: spec.rrule,
      description: describeRecurrence(spec),
      occurrences: service().occurrences(id).map(expand),
    };
  });

  app.post<{ Params: { id: string } }>('/api/items/:id/recurrence', async (request, reply) => {
    const body = attachSchema.parse(request.body);
    const result = withRecurrenceErrors(() =>
      service().attachSeries(request.params.id, compact(body)),
    );

    return reply.status(201).send({
      item: expand(result.item),
      created: result.created,
      occurrences: service().occurrences(request.params.id).map(expand),
    });
  });

  app.delete<{ Params: { id: string } }>('/api/items/:id/recurrence', async (request, reply) => {
    service().detachSeries(request.params.id);
    return reply.status(204).send();
  });

  /** Tops up the horizon for one series. Idempotent. */
  app.post<{ Params: { id: string } }>('/api/items/:id/recurrence/materialize', async (request) => {
    const body = materializeSchema.parse(request.body ?? {});
    const result = service().materialize(request.params.id, compact(body));
    return {
      created: result.created.map(expand),
      createdCount: result.created.length,
      skipped: result.skipped,
      truncated: result.truncated,
    };
  });

  /** Tops up every series. Run at startup and after a period offline. */
  app.post('/api/recurrence/materialize', async (request) => {
    const body = materializeSchema.parse(request.body ?? {});
    const results = service().materializeAll(compact(body));
    return {
      series: results.length,
      created: results.reduce((total, result) => total + result.created.length, 0),
      truncated: results.some((result) => result.truncated),
    };
  });

  /**
   * Completing an occurrence also ensures the next one exists.
   *
   * Without the eager top-up a series would quietly run out the moment the last
   * materialised occurrence was completed, which is the failure nobody notices
   * until a recurring chore has silently stopped happening.
   */
  app.post<{ Params: { id: string } }>('/api/items/:id/occurrence/complete', async (request) => {
    const result = withRecurrenceErrors(() => service().completeOccurrence(request.params.id));
    return {
      occurrence: expand(result.occurrence),
      next: result.next === null ? null : expand(result.next),
    };
  });

  /** The preview a picker shows before anything is saved. */
  app.post('/api/recurrence/preview', async (request) => {
    const body = previewSchema.parse(request.body ?? {});
    const timezone = body.timezone ?? app.repos.settings.getKnown('app.timezone') ?? 'UTC';
    const anchorDate = (body.anchorDate ?? new Date().toISOString().slice(0, 10)) as IsoDate;

    const result = withRecurrenceErrors(() => {
      const spec = parseRecurrence(withRecurrenceDtstart(body.rrule, anchorDate, timezone), {
        defaultTimezone: timezone,
      });
      return {
        rrule: spec.rrule,
        description: describeRecurrence(spec),
        occurrences: expandOccurrences(spec, {
          start: anchorDate,
          end: addDays(anchorDate, 60),
          limit: 12,
        }),
      };
    });

    return result;
  });
}
