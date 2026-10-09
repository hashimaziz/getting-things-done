/**
 * Dashboard routes.
 *
 * A dashboard is a name and a layout. The layout is validated as a *shape* here —
 * a list — and normalised by the web client into a renderable grid. The server does not
 * know what a widget is: it stores rectangles for a client that may change, and
 * validating widget types against the registry would make a layout unreadable by an
 * older build of the app, which is the wrong trade for a single-user local database.
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { DashboardNotFoundError } from '@gtd/db';
import { BadRequestError } from '../http-errors.js';

/** One rectangle. Values are bounded so a hand-edited row cannot be absurd. */
const widgetSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  title: z.string().max(120).nullish(),
  // Coerced rather than left optional, so the stored widget always has a props object
  // and the client never has to test for one.
  x: z.number().int().min(0).max(64),
  y: z.number().int().min(0).max(100_000),
  width: z.number().int().min(1).max(64),
  height: z.number().int().min(1).max(64),
  props: z.record(z.string(), z.unknown()).optional(),
});

const createSchema = z.object({
  key: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  widgets: z.array(widgetSchema).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const updateSchema = z.object({
  key: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  widgets: z.array(widgetSchema).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get('/api/dashboards', async () => ({ dashboards: app.repos.dashboards.list() }));

  app.get<{ Params: { id: string } }>('/api/dashboards/:id', async (request, reply) => {
    const dashboard = app.repos.dashboards.getById(request.params.id);
    if (!dashboard) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No dashboard with id "${request.params.id}"` },
      });
    }
    return { dashboard };
  });

  app.post('/api/dashboards', async (request, reply) => {
    const parsed = createSchema.parse(request.body);
    const widgets = (parsed.widgets ?? []).map((widget) => ({
      ...widget,
      title: widget.title ?? null,
      props: widget.props ?? {},
    }));

    const dashboard = app.repos.dashboards.create({
      name: parsed.name,
      // The key is derived from the name when not given, and de-duplicated, so creating
      // two dashboards called "Work" does not fail on the unique index with an error
      // about a field the person never set.
      key: parsed.key ?? uniqueKey(app.repos.dashboards.list(), parsed.name),
      widgets,
      ...(parsed.isDefault === undefined ? {} : { isDefault: parsed.isDefault }),
      ...(parsed.sortOrder === undefined ? {} : { sortOrder: parsed.sortOrder }),
    });

    return reply.status(201).send({ dashboard });
  });

  app.patch<{ Params: { id: string } }>('/api/dashboards/:id', async (request) => {
    const patch = updateSchema.parse(request.body);

    try {
      const widgets = patch.widgets?.map((widget) => ({
        ...widget,
        title: widget.title ?? null,
        props: widget.props ?? {},
      }));

      return {
        dashboard: app.repos.dashboards.update(request.params.id, {
          ...(patch.key === undefined ? {} : { key: patch.key }),
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.isDefault === undefined ? {} : { isDefault: patch.isDefault }),
          ...(patch.sortOrder === undefined ? {} : { sortOrder: patch.sortOrder }),
          ...(widgets === undefined ? {} : { widgets }),
        }),
      };
    } catch (error) {
      if (error instanceof DashboardNotFoundError) {
        throw new BadRequestError(error.message);
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/dashboards/:id', async (request, reply) => {
    try {
      app.repos.dashboards.remove(request.params.id);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof DashboardNotFoundError) {
        return reply.status(404).send({
          error: { code: 'not_found', message: error.message },
        });
      }
      throw error;
    }
  });
}

/** A key derived from a name, made unique against the dashboards that exist. */
function uniqueKey(existing: Array<{ key: string }>, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const base = slug === '' ? 'dashboard' : slug;
  const taken = new Set(existing.map((dashboard) => dashboard.key));

  if (!taken.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${Date.now()}`;
}
