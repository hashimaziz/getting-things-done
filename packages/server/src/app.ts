/**
 * The Fastify application factory.
 *
 * `buildApp` takes an already-opened database and returns a configured Fastify
 * instance. It never opens a connection itself, which is what lets the API tests
 * run against an in-memory database and the CLI share the same repository code
 * without going through HTTP.
 */

import { APP_CONFIG, type IsoDate } from '@gtd/core';
import { createRepositories, reconcileFieldIndexes, type Db, type Repositories } from '@gtd/db';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { sendError } from './errors.js';
import { registerRoutes } from './routes/index.js';

export interface BuildAppOptions {
  db: Db;
  /** Skip request logging in tests, where it is pure noise. */
  logger?: boolean;
  /**
   * Reconcile lazily-created JSON indexes against the field definitions at
   * startup. On by default, off in tests that do not care.
   */
  reconcileIndexes?: boolean;
  /**
   * The clock, returning an ISO 8601 date or date-time.
   *
   * One clock for the whole app, wired into the repositories as well as the
   * routes. It used to reach only the recurrence service, so item timestamps and
   * activity-log entries still came from the real `Date` while recurrence
   * followed the injected value, which made the archive's date filters miss rows
   * the test had just created.
   */
  now?: () => string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Repositories, available to every route without threading them through. */
    repos: Repositories;
    db: Db;
    /** The host's notion of today, injectable for deterministic tests. */
    today: () => IsoDate;
  }
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    // Loopback only. The API is reachable from the local browser during
    // development, which is the sole origin permitted.
    origin: true,
    credentials: false,
  });

  const raw = options.now ?? (() => new Date().toISOString());

  /** A bare `YYYY-MM-DD` is treated as midnight UTC for storage. */
  const instant = (): string => {
    const value = raw();
    return value.length === 10 ? `${value}T00:00:00.000Z` : value;
  };
  const today = (): IsoDate => instant().slice(0, 10);

  const repos = createRepositories(options.db, { items: { now: instant } });

  if (options.reconcileIndexes !== false) {
    // Three drift cases would otherwise stay invisible until a query got
    // mysteriously slow. See field-indexes.ts.
    reconcileFieldIndexes(options.db, repos.fieldDefs.listAll());
  }

  app.decorate('db', options.db);
  app.decorate('repos', repos);
  app.decorate('today', today);

  app.setErrorHandler((error, request, reply) => {
    return sendError(error, request, reply);
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'route_not_found',
        message: `No route for ${request.method} ${request.url}`,
      },
    });
  });

  registerRoutes(app);

  return app;
}

export { ZodError, APP_CONFIG };
export type { Db, Repositories };
