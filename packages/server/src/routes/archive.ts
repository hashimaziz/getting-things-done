/**
 * Archive routes: the completed history, and the activity log behind it.
 *
 * Allen's rule is that finished items are filed, not deleted. These endpoints are
 * where that filing becomes usable: filterable by the same field language as every
 * other list, with facets so the filter controls can be built from what is actually
 * present rather than hardcoded.
 */

import { addDays, resolveDefinitionsForCategory, type FilterNode, type SortRule } from '@gtd/core';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../http-errors.js';
import { compact } from '../utils/compact.js';
import { expandItem } from './item-helpers.js';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/** Filters and sorts arrive as JSON text in a query string, like /api/items. */
function parseJsonParam<T>(raw: string | undefined, label: string, fallback: T): T {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BadRequestError(`The ${label} parameter is not valid JSON`);
  }
}

const listQuerySchema = z.object({
  filter: z.string().optional(),
  sort: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  categoryId: z.string().optional(),
});

export function registerArchiveRoutes(app: FastifyInstance): void {
  const allDefinitions = () => app.repos.fieldDefs.listAll();

  const resolverFor = (categoryId?: string) => {
    const definitions = categoryId
      ? resolveDefinitionsForCategory(allDefinitions(), categoryId)
      : allDefinitions();
    return app.itemFieldResolver(definitions);
  };

  /** The filterable completed list. */
  app.get('/api/archive', async (request) => {
    const query = listQuerySchema.parse(request.query ?? {});
    const filter = parseJsonParam<FilterNode | null>(query.filter, 'filter', null);
    const sort = parseJsonParam<SortRule[] | undefined>(query.sort, 'sort', undefined);

    const result = app.repos.archive.query(
      compact({
        resolver: resolverFor(query.categoryId),
        filter,
        sort,
        limit: query.limit,
        offset: query.offset,
      }),
    );

    const definitions = query.categoryId
      ? resolveDefinitionsForCategory(allDefinitions(), query.categoryId)
      : allDefinitions();

    return {
      items: result.items.map((item) => expandItem(item, definitions)),
      total: result.total,
    };
  });

  /**
   * Distinct values per field, for building the filter controls.
   *
   * A free-text field is omitted, because a dropdown of every string ever typed is
   * noise rather than a filter.
   */
  app.get('/api/archive/facets', async (request) => {
    const query = z.object({ categoryId: z.string().optional() }).parse(request.query ?? {});
    const definitions = query.categoryId
      ? resolveDefinitionsForCategory(allDefinitions(), query.categoryId)
      : allDefinitions();
    return { facets: app.repos.archive.facets(definitions) };
  });

  /** Completion counts per day, for the dashboard chart. */
  app.get('/api/archive/daily', async (request) => {
    const query = z
      .object({
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
        days: z.coerce.number().int().min(1).max(365).optional(),
      })
      .parse(request.query ?? {});

    // Defaults to the last 30 days ending today.
    const to = query.to ?? app.today();
    const from = query.from ?? (query.days ? addDays(to, -(query.days - 1)) : addDays(to, -29));

    return {
      from,
      to,
      days: app.repos.archive.dailyCompletions(from, to),
    };
  });

  /** The history of one item, oldest first. */
  app.get<{ Params: { id: string } }>('/api/items/:id/history', async (request, reply) => {
    const item = app.repos.items.getById(request.params.id);
    if (!item) {
      return reply
        .status(404)
        .send({ error: { code: 'not_found', message: `No item with id "${request.params.id}"` } });
    }
    return {
      entries: [...app.repos.activity.listForItem(request.params.id)].reverse(),
    };
  });

  /** A global activity feed, with item titles so it is readable. */
  app.get('/api/activity', async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        verb: z.string().optional(),
      })
      .parse(request.query ?? {});

    return {
      entries: app.repos.activity.listWithTitles(
        compact({
          limit: query.limit,
          verb: query.verb as never,
        }),
      ),
    };
  });

  /** Counts by verb, for a summary panel. */
  app.get('/api/activity/summary', async (request) => {
    const query = z.object({ since: z.string().optional() }).parse(request.query ?? {});
    return { counts: app.repos.activity.countByVerb(query.since) };
  });
}
