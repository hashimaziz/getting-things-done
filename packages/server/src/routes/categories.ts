/**
 * Category routes.
 *
 * Categories are created by the setup wizard, so nothing is seeded and the list
 * starts empty. Every category may define its own field set, which is why the
 * field definitions live under `/api/categories/:id/fields`.
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { compact } from '../utils/compact.js';

const createCategorySchema = z.object({
  key: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullish(),
  color: z.string().max(64).nullish(),
  icon: z.string().max(64).nullish(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const updateCategorySchema = createCategorySchema.partial().extend({
  isArchived: z.boolean().optional(),
});

const createFieldSchema = z.object({
  label: z.string().trim().min(1).max(120),
  type: z.string().min(1),
  key: z.string().trim().min(1).max(64).optional(),
  description: z.string().max(500).nullish(),
  options: z.unknown().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  groupLabel: z.string().max(120).nullish(),
  showInTable: z.boolean().optional(),
  showInCard: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const updateFieldSchema = createFieldSchema.partial();

const updateFieldQuerySchema = z.object({
  /**
   * Optional new scope. A global field has `categoryId` set to null.
   *
   * A query string cannot express null, so the literal text `null` is decoded
   * here. Without this, "make this global" would be sent as the four-character
   * string "null", which is a category id that does not exist, and the request
   * would fail as a foreign key violation rather than doing what was asked.
   */
  categoryId: z
    .union([z.string(), z.null()])
    .transform((value) => (value === 'null' ? null : value))
    .optional(),
});

export function registerCategoryRoutes(app: FastifyInstance): void {
  app.get('/api/categories', async (request) => {
    const includeArchived =
      (request.query as { includeArchived?: string }).includeArchived === 'true';
    return { categories: app.repos.categories.list({ includeArchived }) };
  });

  app.get<{ Params: { id: string } }>('/api/categories/:id', async (request, reply) => {
    const category = app.repos.categories.getById(request.params.id);
    if (!category) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No category with id "${request.params.id}"` },
      });
    }
    return { category };
  });

  app.post('/api/categories', async (request, reply) => {
    const category = app.repos.categories.create(compact(createCategorySchema.parse(request.body)));
    return reply.status(201).send({ category });
  });

  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (request) => {
    const body = compact(updateCategorySchema.parse(request.body));
    return { category: app.repos.categories.update(request.params.id, body) };
  });

  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (request, reply) => {
    app.repos.categories.remove(request.params.id);
    return reply.status(204).send();
  });

  /** The definitions that apply to a category: its own plus every global one. */
  app.get<{ Params: { id: string } }>('/api/categories/:id/fields', async (request) => {
    return { fields: app.repos.fieldDefs.listForCategory(request.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/categories/:id/fields', async (request, reply) => {
    const body = createFieldSchema.parse(request.body);
    const definition = app.repos.fieldDefs.create({
      ...compact(body),
      type: body.type as never,
      options: body.options as never,
      defaultValue: body.defaultValue as never,
      categoryId: request.params.id,
    });
    return reply.status(201).send({ field: definition });
  });

  app.get('/api/fields', async () => {
    return { fields: app.repos.fieldDefs.listAll() };
  });

  app.get<{ Params: { id: string } }>('/api/fields/:id', async (request, reply) => {
    const field = app.repos.fieldDefs.getById(request.params.id);
    if (!field) {
      return reply
        .status(404)
        .send({ error: { code: 'not_found', message: `No field with id "${request.params.id}"` } });
    }
    return { field };
  });

  app.patch<{ Params: { id: string } }>('/api/fields/:id', async (request) => {
    const body = updateFieldSchema.parse(request.body);
    // Scope moves go through the query string, since a null categoryId means
    // "make this global" and a body field cannot distinguish absent from null.
    const { categoryId } = updateFieldQuerySchema.parse(request.query ?? {});
    const field = app.repos.fieldDefs.update(request.params.id, {
      ...body,
      ...(categoryId === undefined ? {} : { categoryId }),
    } as never);
    return { field };
  });

  app.delete<{ Params: { id: string } }>('/api/fields/:id', async (request, reply) => {
    app.repos.fieldDefs.remove(request.params.id);
    return reply.status(204).send();
  });
}
