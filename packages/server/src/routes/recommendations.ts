/**
 * Recommendation routes.
 *
 * The provider registry lives in `core`, and the deterministic provider ships
 * registered. A future local-model provider registers alongside it and becomes
 * addressable by name, with no change here beyond passing through the id.
 */

import {
  checkInvariants,
  createDefaultRegistry,
  type RecommendationContext,
  type RecommendationData,
  type RecommendationFocus,
} from '@gtd/core';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../http-errors.js';
import { expandItem } from './item-helpers.js';

const FOCUSES = [
  'what_next',
  'overdue',
  'waiting',
  'stalled_projects',
  'daily_review',
  'schedule',
] as const;

const querySchema = z.object({
  provider: z.string().default('rules'),
  focus: z.enum(FOCUSES).default('what_next'),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  /** Comma-separated context ids, or absent for "anywhere". */
  contextIds: z.string().optional(),
  timeAvailableMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  energy: z.enum(['low', 'medium', 'high']).optional(),
  /** Include the full item for each suggestion, so the UI can render it. */
  expand: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export function registerRecommendationRoutes(app: FastifyInstance): void {
  const registry = createDefaultRegistry();

  /** The snapshot providers read. Assembled here so providers stay pure. */
  const snapshot = (): RecommendationData => {
    const items = app.repos.items.query({
      resolver: app.itemFieldResolver(app.repos.fieldDefs.listAll()),
      limit: 5000,
      sort: [{ field: 'createdAt', direction: 'desc' }],
    }).items;

    const projects = app.repos.projects.list();

    return {
      items,
      projects,
      people: app.repos.people.list(),
      contexts: app.repos.contexts.list(),
      categories: app.repos.categories.list(),
      violations: checkInvariants(items, projects, { today: app.today() }),
      definitions: app.repos.fieldDefs.listAll(),
    };
  };

  const buildContext = (query: z.infer<typeof querySchema>): RecommendationContext => ({
    today: app.today(),
    timezone: app.repos.settings.getKnown('app.timezone') ?? 'UTC',
    focus: query.focus as RecommendationFocus,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    // Absent means "not stated", which must not exclude everything. Only an
    // explicitly empty value means nowhere.
    contextIds:
      query.contextIds === undefined
        ? null
        : query.contextIds === ''
          ? []
          : query.contextIds
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean),
    timeAvailableMinutes: query.timeAvailableMinutes ?? null,
    energy: query.energy ?? null,
  });

  /** Which providers are available, so the UI can offer the choice. */
  app.get('/api/recommendations/providers', async () => ({
    providers: registry.list(),
    default: 'rules',
  }));

  app.get('/api/recommendations', async (request) => {
    const query = querySchema.parse(request.query ?? {});

    if (!registry.has(query.provider)) {
      throw new BadRequestError(
        `No provider named "${query.provider}". Available: ${registry
          .list()
          .map((provider) => provider.id)
          .join(', ')}`,
      );
    }

    const provider = registry.get(query.provider);
    const recommendations = await provider.suggest(buildContext(query), snapshot());

    return {
      provider: { id: provider.id, label: provider.label, requiresModel: provider.requiresModel },
      focus: query.focus,
      recommendations: recommendations.map((entry) =>
        query.expand && entry.itemId !== undefined
          ? {
              ...entry,
              item: expandItem(
                app.repos.items.getById(entry.itemId) as never,
                app.repos.fieldDefs.listAll(),
              ),
            }
          : entry,
      ),
    };
  });

  /** Applies a recommendation's verdict, so a suggestion can be acted on. */
  app.post<{ Params: { id: string } }>('/api/items/:id/adopt', async (request, reply) => {
    const body = z.object({ container: z.string() }).parse(request.body);
    const item = app.repos.items.setContainer(request.params.id, body.container as never);
    return reply.send({
      item: expandItem(item, app.repos.fieldDefs.listForCategory(item.categoryId)),
    });
  });
}
