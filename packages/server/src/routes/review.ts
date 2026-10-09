/**
 * Review routes: the weekly review's data, the Waiting For list, and the system
 * invariant report.
 *
 * All three answer questions the review asks, so they are grouped. The invariant
 * checks and the review step definitions live in `core` as pure functions; these
 * routes only fetch rows and shape the answer.
 */

import {
  REVIEW_PHASES,
  WEEKLY_REVIEW_STEPS,
  checkInvariants,
  groupWaitingByPerson,
  summariseReview,
  type Item,
} from '@gtd/core';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { compact } from '../utils/compact.js';
import { expandItem } from './item-helpers.js';

export function registerReviewRoutes(app: FastifyInstance): void {
  /** Everything the review and invariant endpoints need, fetched once per request. */
  const snapshot = (): { items: Item[]; projects: ReturnType<typeof app.repos.projects.list> } => ({
    items: app.repos.items.query({
      resolver: app.itemFieldResolver(app.repos.fieldDefs.listAll()),
      limit: 5000,
      sort: [{ field: 'createdAt', direction: 'desc' }],
    }).items,
    projects: app.repos.projects.list(),
  });

  const optionsSchema = z.object({
    today: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    staleInboxDays: z.coerce.number().int().min(0).max(365).optional(),
  });

  const reviewOptions = (query: z.infer<typeof optionsSchema>) => ({
    today: query.today ?? app.today(),
    ...(query.staleInboxDays === undefined ? {} : { staleInboxDays: query.staleInboxDays }),
  });

  /* ------------------------------------------------------------- invariants */

  app.get('/api/invariants', async (request) => {
    const query = optionsSchema.parse(request.query ?? {});
    const { items, projects } = snapshot();
    return { violations: checkInvariants(items, projects, reviewOptions(query)) };
  });

  /**
   * Whether everything is consistent.
   *
   * Separate from the report so a client can poll a single boolean, and so the
   * dashboard can show one badge without parsing the whole list.
   */
  app.get('/api/invariants/ok', async (request) => {
    const query = optionsSchema.parse(request.query ?? {});
    const { items, projects } = snapshot();
    const violations = checkInvariants(items, projects, reviewOptions(query));
    return {
      ok: violations.length === 0,
      errors: violations.filter((violation) => violation.severity === 'error').length,
      warnings: violations.filter((violation) => violation.severity === 'warning').length,
    };
  });

  /* ---------------------------------------------------------------- waiting */

  app.get('/api/waiting', async (request) => {
    const query = z
      .object({
        today: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        staleAfterDays: z.coerce.number().int().min(0).max(365).optional(),
        includeSettled: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value !== 'false'),
      })
      .parse(request.query ?? {});

    const { items } = snapshot();
    const groups = groupWaitingByPerson(
      items,
      compact({
        today: query.today ?? app.today(),
        staleAfterDays: query.staleAfterDays,
        includeSettled: query.includeSettled,
      }),
    );

    const people = new Map(app.repos.people.list().map((person) => [person.id, person]));

    return {
      groups: groups.map((group) => ({
        ...group,
        personName:
          group.personId === null
            ? 'Nobody in particular'
            : (people.get(group.personId)?.name ?? 'Unknown person'),
        items: group.items.map((item) =>
          expandItem(item, app.repos.fieldDefs.listForCategory(item.categoryId)),
        ),
      })),
    };
  });

  /* --------------------------------------------------------- weekly review */

  /**
   * The review's shape and progress.
   *
   * Counts only, not the items. The client fetches each collection as it reaches
   * that step, so opening the review does not pull the entire database.
   */
  app.get('/api/review', async (request) => {
    const query = optionsSchema.parse(request.query ?? {});
    const { items, projects } = snapshot();
    const progress = summariseReview(items, projects, reviewOptions(query));

    const lastReviewAt = app.repos.settings.getKnown('review.last_weekly_at');

    return {
      phases: REVIEW_PHASES,
      steps: WEEKLY_REVIEW_STEPS,
      progress,
      lastReviewAt: lastReviewAt ?? null,
      outstanding: progress.filter((entry) => !entry.satisfied).length,
      violations: checkInvariants(items, projects, reviewOptions(query)),
    };
  });

  /**
   * Records that a review ran.
   *
   * Storing the timestamp is what makes the weekly cadence enforceable rather than
   * aspirational, and it is the only state the review itself owns.
   */
  app.post('/api/review/complete', async (request, reply) => {
    const at = app.repos.settings.set('review.last_weekly_at', new Date().toISOString());

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 7);
    app.repos.settings.set('review.next_weekly_at', nextDue.toISOString());

    return reply.status(201).send({ lastReviewAt: at.value });
  });
}
