/**
 * Item routes.
 *
 * The interesting part is dynamic field validation. Every category may define its
 * own fields, so the set of valid field keys, their types and their option lists
 * are only knowable at request time. Values arriving on a create or update are
 * validated against the definitions that apply to the item's category, using the
 * same `validateFieldValues` the whole application shares.
 */

import {
  CONTAINER_SPECS,
  CONTAINERS,
  FIELD_TYPES,
  applyFieldDefaults,
  resolveDefinitionsForCategory,
  validateFieldValues,
  type CreateItemInput,
  type FieldDefinition,
  type FieldType,
  type FieldValue,
  type FilterNode,
  type Item,
  type SortRule,
  type UpdateItemPatch,
} from '@gtd/core';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { compact } from '../utils/compact.js';
import { BadRequestError } from '../http-errors.js';
import { expandItem } from './item-helpers.js';

/**
 * A container name, typed as the domain union rather than `string`, so a parsed
 * body can be passed straight to the repository without a cast at every field.
 */
const containerSchema = z.enum(CONTAINERS);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar date in YYYY-MM-DD');

const isoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/,
    'must be an ISO 8601 instant with a timezone offset',
  );

const createItemSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().trim().min(1).max(500),
  container: containerSchema.optional(),
  notes: z.string().max(100_000).nullish(),
  whenAt: isoDateTimeSchema.nullish(),
  deadlineOn: isoDateSchema.nullish(),
  estimateMinutes: z.number().int().min(0).nullish(),
  projectId: z.string().nullish(),
  waitingOnPersonId: z.string().nullish(),
  followUpAt: isoDateTimeSchema.nullish(),
  contextIds: z.array(z.string()).nullish(),
  recurrenceId: z.string().nullish(),
  parentItemId: z.string().nullish(),
  occurrenceDate: isoDateSchema.nullish(),
  data: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
});

const updateItemSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  categoryId: z.string().min(1).optional(),
  container: containerSchema.optional(),
  notes: z.string().max(100_000).nullish(),
  whenAt: isoDateTimeSchema.nullish(),
  deadlineOn: isoDateSchema.nullish(),
  estimateMinutes: z.number().int().min(0).nullish(),
  projectId: z.string().nullish(),
  waitingOnPersonId: z.string().nullish(),
  followUpAt: isoDateTimeSchema.nullish(),
  contextIds: z.array(z.string()).nullish(),
  recurrenceId: z.string().nullish(),
  sortOrder: z.number().int().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Validates a payload's dynamic field values against the definitions that apply
 * to a category.
 *
 * `null` clears a field, which must be distinguished from "absent, leave alone".
 * A null is validated as an explicit clear, so it becomes the type's empty value
 * rather than being silently dropped.
 *
 * `applyingDefaults` distinguishes the two callers: on create the values are
 * being materialised into a complete item, so defaults apply and required fields
 * must be present. On a partial update an absent key means "leave alone", so
 * requiring it would be wrong.
 */
function resolveData(
  definitions: readonly FieldDefinition[],
  raw: Record<string, unknown>,
  { applyingDefaults }: { applyingDefaults: boolean },
): Record<string, FieldValue> {
  const result = validateFieldValues(definitions, raw, {
    enforceRequired: applyingDefaults,
  });

  if (!result.ok) {
    throw new BadRequestError(
      result.issues.map((issue) => `${issue.key}: ${issue.message}`).join('; '),
      result.issues,
    );
  }

  return applyingDefaults ? applyFieldDefaults(definitions, result.values) : result.values;
}

export function registerItemRoutes(app: FastifyInstance): void {
  const definitionsFor = (categoryId: string): FieldDefinition[] =>
    app.repos.fieldDefs.listForCategory(categoryId);

  app.get('/api/items', async (request, reply) => {
    const query = request.query as {
      filter?: string;
      sort?: string;
      limit?: string;
      offset?: string;
      categoryId?: string;
    };

    // The filter arrives as JSON text. Parse failures are the client's problem
    // and are reported as such rather than surfacing as a 500.
    let filter: FilterNode | null = null;
    if (query.filter !== undefined && query.filter !== '') {
      try {
        filter = JSON.parse(query.filter) as FilterNode;
      } catch {
        return reply.status(400).send({
          error: { code: 'invalid_query', message: 'The filter parameter is not valid JSON' },
        });
      }
    }

    let sort: SortRule[] | undefined;
    if (query.sort !== undefined && query.sort !== '') {
      try {
        sort = JSON.parse(query.sort) as SortRule[];
      } catch {
        return reply.status(400).send({
          error: { code: 'invalid_query', message: 'The sort parameter is not valid JSON' },
        });
      }
    }

    const all = app.repos.fieldDefs.listAll();
    const definitions = query.categoryId
      ? resolveDefinitionsForCategory(all, query.categoryId)
      : all;

    const result = app.repos.items.query(
      compact({
        resolver: app.itemFieldResolver(definitions),
        filter,
        sort,
        limit: query.limit === undefined ? undefined : Number(query.limit),
        offset: query.offset === undefined ? undefined : Number(query.offset),
      }),
    );

    return { items: result.items, total: result.total };
  });

  app.post('/api/items', async (request, reply) => {
    const {
      categoryId,
      title,
      data: rawData,
      contextIds,
      ...rest
    } = createItemSchema.parse(request.body);

    const definitions = definitionsFor(categoryId);
    const data = resolveData(definitions, rawData ?? {}, { applyingDefaults: true });

    const input: CreateItemInput = {
      categoryId,
      title,
      data,
      ...compact(rest),
      // Contexts are a set. A null means "none", not "unclear", so it collapses
      // to the empty set rather than being an error.
      ...(contextIds === undefined ? {} : { contextIds: contextIds ?? [] }),
    };

    return reply.status(201).send({ item: app.repos.items.create(input) });
  });

  app.get<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    const item = app.repos.items.getById(request.params.id);
    if (!item) {
      return reply
        .status(404)
        .send({ error: { code: 'not_found', message: `No item with id "${request.params.id}"` } });
    }
    return { item: expandItem(item, definitionsFor(item.categoryId)) };
  });

  /** The definitions applying to an item, for rendering its editor. */
  app.get<{ Params: { id: string } }>('/api/items/:id/fields', async (request, reply) => {
    const item = app.repos.items.getById(request.params.id);
    if (!item) {
      return reply
        .status(404)
        .send({ error: { code: 'not_found', message: `No item with id "${request.params.id}"` } });
    }
    return { fields: definitionsFor(item.categoryId) };
  });

  app.patch<{ Params: { id: string } }>('/api/items/:id', async (request) => {
    const { data: rawData, contextIds, ...rest } = updateItemSchema.parse(request.body);
    const patch: UpdateItemPatch = {
      ...compact(rest),
      ...(contextIds === undefined ? {} : { contextIds: contextIds ?? [] }),
    };

    if (rawData !== undefined) {
      // Field data is validated against whichever category the item ends up in,
      // so changing category and data in one request is checked consistently.
      const existing = app.repos.items.getById(request.params.id);
      const targetCategory = rest.categoryId ?? existing?.categoryId ?? '';
      const definitions = definitionsFor(targetCategory);
      // Merge rather than replace, so editing one field does not blank every
      // other field the client never mentioned.
      patch.data = resolveData(
        definitions,
        { ...(existing?.data ?? {}), ...rawData },
        { applyingDefaults: false },
      );
    }

    const item = app.repos.items.update(request.params.id, patch);
    return { item: expandItem(item, definitionsFor(item.categoryId)) };
  });

  app.delete<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    app.repos.items.remove(request.params.id);
    return reply.status(204).send();
  });

  /**
   * Lifecycle actions as verbs rather than a container patch, so the transition
   * rules and the timestamp bookkeeping live in exactly one place.
   */
  for (const [action, handler] of [
    ['complete', app.repos.items.complete],
    ['reopen', app.repos.items.reopen],
    ['trash', app.repos.items.trash],
    ['restore', app.repos.items.restore],
  ] as const) {
    app.post<{ Params: { id: string } }>(`/api/items/:id/${action}`, async (request) => {
      const item = handler(request.params.id);
      return { item: expandItem(item, definitionsFor(item.categoryId)) };
    });
  }

  const moveSchema = z.object({ container: containerSchema });

  app.post<{ Params: { id: string } }>('/api/items/:id/move', async (request) => {
    const body = moveSchema.parse(request.body);
    const item = app.repos.items.setContainer(
      request.params.id,
      body.container as Item['container'],
    );
    return { item: expandItem(item, definitionsFor(item.categoryId)) };
  });

  /** Container metadata, so the web app renders labels and review cadences. */
  app.get('/api/containers', async () => ({
    containers: CONTAINERS.map((container) => CONTAINER_SPECS[container]),
  }));

  app.get('/api/field-types', async () => ({
    fieldTypes: FIELD_TYPES as readonly FieldType[],
  }));
}
