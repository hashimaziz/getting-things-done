/**
 * Reference-data routes: people, contexts, projects and checklist templates.
 *
 * Thin CRUD over repositories that already exist. They live here because the
 * metrics endpoints need them, and a dashboard that can group work by person or
 * project cannot do so without a way to create either.
 */

import { resolveDefinitionsForCategory, type Item, type ProjectStatus } from '@gtd/core';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { compact } from '../utils/compact.js';
import { expandItem } from './item-helpers.js';

const idParam = z.string().min(1);

const personSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(320).nullish(),
  notes: z.string().max(10_000).nullish(),
  categoryId: idParam.nullish(),
});

const contextSchema = z.object({
  name: z.string().trim().min(1).max(120),
  categoryId: idParam.nullish(),
  sortOrder: z.number().int().min(0).optional(),
});

const projectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  outcome: z.string().max(2000).nullish(),
  categoryId: idParam.nullish(),
  status: z.enum(['active', 'someday', 'completed', 'dropped']).optional(),
});

const projectPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  outcome: z.string().max(2000).nullish(),
  categoryId: idParam.nullish(),
  status: z.enum(['active', 'someday', 'completed', 'dropped']).optional(),
  reviewAt: z.string().nullish(),
});

const checklistTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  entries: z
    .array(z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(500) }))
    .min(1)
    .max(200),
  appliesTo: z.array(z.string()).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const checklistTemplatePatchSchema = checklistTemplateSchema.partial();

export function registerReferenceRoutes(app: FastifyInstance): void {
  /* ------------------------------------------------------------------ people */

  app.get('/api/people', async (request) => {
    const query = z.object({ search: z.string().optional() }).parse(request.query ?? {});
    return {
      people:
        query.search === undefined
          ? app.repos.people.list()
          : app.repos.people.search(query.search),
    };
  });

  app.get<{ Params: { id: string } }>('/api/people/:id', async (request, reply) => {
    const person = app.repos.people.getById(request.params.id);
    if (!person) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No person with id "${request.params.id}"` },
      });
    }
    return { person };
  });

  app.post('/api/people', async (request, reply) => {
    const body = personSchema.parse(request.body);
    return reply.status(201).send({ person: app.repos.people.create(compact(body)) });
  });

  app.patch<{ Params: { id: string } }>('/api/people/:id', async (request) => ({
    person: app.repos.people.update(
      request.params.id,
      compact(personSchema.partial().parse(request.body)),
    ),
  }));

  app.delete<{ Params: { id: string } }>('/api/people/:id', async (request, reply) => {
    app.repos.people.remove(request.params.id);
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------------- contexts */

  app.get('/api/contexts', async (request) => {
    const query = z.object({ categoryId: idParam.optional() }).parse(request.query ?? {});
    return {
      contexts:
        query.categoryId === undefined
          ? app.repos.contexts.list()
          : app.repos.contexts.list(query.categoryId),
    };
  });

  app.post('/api/contexts', async (request, reply) => {
    const body = contextSchema.parse(request.body);
    return reply.status(201).send({ context: app.repos.contexts.create(compact(body)) });
  });

  app.patch<{ Params: { id: string } }>('/api/contexts/:id', async (request) => ({
    context: app.repos.contexts.update(
      request.params.id,
      compact(contextSchema.partial().parse(request.body)),
    ),
  }));

  app.delete<{ Params: { id: string } }>('/api/contexts/:id', async (request, reply) => {
    app.repos.contexts.remove(request.params.id);
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------------- projects */

  app.get('/api/projects', async (request) => {
    const query = z
      .object({ status: z.enum(['active', 'someday', 'completed', 'dropped']).optional() })
      .parse(request.query ?? {});
    return {
      projects:
        query.status === undefined
          ? app.repos.projects.list()
          : app.repos.projects.list(query.status as ProjectStatus),
    };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const project = app.repos.projects.getById(request.params.id);
    if (!project) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No project with id "${request.params.id}"` },
      });
    }
    return { project };
  });

  /**
   * A project with its open items and the GTD invariant alongside it.
   *
   * The invariant is returned with the project rather than enforced, because a
   * project with no next action is a normal state to be in briefly and an
   * abnormal one to be in at the end of a week.
   */
  app.get<{ Params: { id: string } }>('/api/projects/:id/detail', async (request, reply) => {
    const project = app.repos.projects.getById(request.params.id);
    if (!project) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No project with id "${request.params.id}"` },
      });
    }

    const items = allItems();
    const open = app.repos.projects.itemsOf(project.id, items);
    const definitions = resolveDefinitionsForCategory(
      app.repos.fieldDefs.listAll(),
      project.categoryId,
    );

    return {
      project,
      items: open.map((item: Item) => expandItem(item, definitions)),
      hasNextAction: open.length > 0,
      estimateMinutes: open.reduce((total, item) => total + (item.estimateMinutes ?? 0), 0),
    };
  });

  app.post('/api/projects', async (request, reply) => {
    const body = projectSchema.parse(request.body);
    return reply.status(201).send({ project: app.repos.projects.create(compact(body)) });
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (request) => ({
    project: app.repos.projects.update(
      request.params.id,
      compact(projectPatchSchema.parse(request.body)),
    ),
  }));

  app.post<{ Params: { id: string } }>('/api/projects/:id/complete', async (request) => ({
    project: app.repos.projects.complete(request.params.id),
  }));

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    app.repos.projects.remove(request.params.id);
    return reply.status(204).send();
  });

  /* ------------------------------------------------------ checklist templates */

  app.get('/api/checklist-templates', async () => ({
    templates: app.repos.checklistTemplates.list(),
  }));

  app.post('/api/checklist-templates', async (request, reply) => {
    const body = checklistTemplateSchema.parse(request.body);
    return reply.status(201).send({ template: app.repos.checklistTemplates.create(compact(body)) });
  });

  app.patch<{ Params: { id: string } }>('/api/checklist-templates/:id', async (request) => ({
    template: app.repos.checklistTemplates.update(
      request.params.id,
      compact(checklistTemplatePatchSchema.parse(request.body)),
    ),
  }));

  app.delete<{ Params: { id: string } }>('/api/checklist-templates/:id', async (request, reply) => {
    app.repos.checklistTemplates.remove(request.params.id);
    return reply.status(204).send();
  });

  /** Every item, for the aggregate endpoints that need the whole collection. */
  function allItems(): Item[] {
    const definitions = app.repos.fieldDefs.listAll();
    return app.repos.items.query({
      resolver: app.itemFieldResolver(definitions),
      limit: 5000,
      sort: [{ field: 'createdAt', direction: 'desc' }],
    }).items;
  }
}
