/**
 * Metrics routes.
 *
 * The aggregation itself lives in `core` as pure functions. This only fetches the
 * rows, supplies the lookups needed to turn ids into labels, and shapes the
 * answer. Keeping the arithmetic out of the route is what lets the same numbers be
 * asserted in a unit test and rendered by a chart.
 */

import {
  ageingBuckets,
  assessSystem,
  completionsPerDay,
  countBy,
  projectsWithoutNextAction,
  recentCompletions,
  throughputWindow,
  type Grouping,
  type Item,
} from '@gtd/core';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../http-errors.js';
import { expandItem } from './item-helpers.js';

const GROUPINGS = ['container', 'category', 'project', 'person', 'field'] as const;

const metricsQuerySchema = z.object({
  /** Ceiling on items considered, so a large archive cannot stall a chart. */
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  /** Which items to consider. Defaults to everything open plus recent completions. */
  scope: z.enum(['open', 'all', 'done']).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  grouping: z.enum(GROUPINGS).optional(),
  fieldKey: z.string().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function parseGrouping(
  grouping: string | undefined,
  fieldKey: string | undefined,
): Grouping | null {
  if (grouping === undefined) {
    return null;
  }
  if (grouping === 'field') {
    if (fieldKey === undefined) {
      throw new BadRequestError('A fieldKey is required when grouping by field');
    }
    return { kind: 'field', key: fieldKey };
  }
  if (!(GROUPINGS as readonly string[]).includes(grouping)) {
    throw new BadRequestError(`Unsupported grouping "${grouping}"`);
  }
  return { kind: grouping as Grouping['kind'] } as Grouping;
}

export function registerMetricsRoutes(app: FastifyInstance): void {
  /** Resolves the label maps the breakdown needs. */
  const lookups = () => ({
    categories: new Map(app.repos.categories.list().map((category) => [category.id, category])),
    projects: new Map(app.repos.projects.list().map((project) => [project.id, project])),
    people: new Map(app.repos.people.list().map((person) => [person.id, person])),
    definitions: new Map(
      app.repos.fieldDefs.listAll().map((definition) => [definition.key, definition]),
    ),
  });

  /**
   * Every item the metrics care about.
   *
   * Open items plus recently completed ones, rather than everything ever, because
   * the archive grows without bound and a dashboard should stay responsive. The
   * completed slice is bounded by the window rather than by time.
   */
  const metricItems = (): Item[] => {
    const definitions = app.repos.fieldDefs.listAll();
    const resolver = app.itemFieldResolver(definitions);
    const sort = [{ field: 'createdAt', direction: 'desc' as const }];

    const open = app.repos.items.query({
      resolver,
      filter: {
        kind: 'group',
        // AND, not OR. "not done AND not trash" written as an OR would match
        // everything, because a completed item is certainly not trashed.
        conjunction: 'and',
        children: [
          { kind: 'condition', field: 'container', operator: 'not_equals', value: 'done' },
          { kind: 'condition', field: 'container', operator: 'not_equals', value: 'trash' },
        ],
      },
      sort,
      limit: 5000,
    });

    const done = app.repos.archive.query({
      resolver,
      sort: [{ field: 'completedAt', direction: 'desc' }],
      limit: 500,
    });

    return [...open.items, ...done.items];
  };

  /** The status panel: one pass over the items answering the review's questions. */
  app.get('/api/metrics/health', async (request) => {
    const query = z
      .object({ dueSoonDays: z.coerce.number().int().min(0).max(90).optional() })
      .parse(request.query ?? {});

    const items = metricItems();
    const projects = app.repos.projects.list();

    const stalled = projectsWithoutNextAction(items, projects);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return {
      ...assessSystem(items, {
        today: app.today(),
        ...(query.dueSoonDays === undefined ? {} : { dueSoonDays: query.dueSoonDays }),
      }),
      ageing: ageingBuckets(items, app.today()),
      projectsWithoutNextAction: stalled.map((id) => ({ id, name: projectNames.get(id) ?? id })),
    };
  });

  /** A grouped breakdown, for the bar and pie widgets. */
  app.get('/api/metrics/breakdown', async (request) => {
    const query = metricsQuerySchema.parse(request.query ?? {});
    const grouping = parseGrouping(query.grouping, query.fieldKey);
    if (grouping === null) {
      return { points: [] };
    }

    let items = metricItems();
    if (query.scope === 'open') {
      items = items.filter((item) => item.container !== 'done' && item.container !== 'trash');
    } else if (query.scope === 'done') {
      items = items.filter((item) => item.container === 'done');
    }
    if (query.limit !== undefined) {
      items = items.slice(0, query.limit);
    }

    return { points: countBy(items, grouping, lookups()) };
  });

  /** Completions over time, zero-filled so the chart has no gaps. */
  app.get('/api/metrics/throughput', async (request) => {
    const query = metricsQuerySchema.parse(request.query ?? {});
    const window = query.days
      ? throughputWindow(query.days, app.today())
      : query.from && query.to
        ? { from: query.from, to: query.to }
        : throughputWindow(30, app.today());

    const completed = app.repos.archive.query({
      resolver: app.itemFieldResolver(app.repos.fieldDefs.listAll()),
      sort: [{ field: 'completedAt', direction: 'desc' }],
      limit: 5000,
    });

    return { window, days: completionsPerDay(completed.items, window) };
  });

  /** The most recently completed items, newest first. */
  app.get('/api/metrics/recent', async (request) => {
    const query = z
      .object({
        days: z.coerce.number().int().min(1).max(365).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(request.query ?? {});
    const days = query.days ?? 7;
    const items = recentCompletions(metricItems(), days, app.today()).slice(0, query.limit ?? 20);
    return {
      items: items.map((item) =>
        expandItem(item, app.repos.fieldDefs.listForCategory(item.categoryId)),
      ),
    };
  });
}
