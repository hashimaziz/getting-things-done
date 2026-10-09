/**
 * Domain error to HTTP status mapping.
 *
 * Keeping this in one place means a route handler can simply throw a domain
 * error and get a sensible status, instead of every handler re-deciding whether a
 * missing row is a 404 or a 500.
 */

import {
  CategoryNotFoundError,
  ChecklistTemplateNotFoundError,
  ContextNotFoundError,
  FieldDefNotFoundError,
  IllegalContainerTransitionError,
  ItemNotFoundError,
  PersonNotFoundError,
  RecurrenceRuleNotFoundError,
} from '@gtd/db';
import { InvalidQueryError } from '@gtd/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export interface ErrorBody {
  error: {
    /** A stable, machine-readable code. Clients branch on this, not the message. */
    code: string;
    message: string;
    /** Field-level or path-level detail, when there is any. */
    details?: unknown;
  };
}

interface Mapping {
  status: number;
  code: string;
  /** Zod issue paths, included as details for a 400. */
  issues?: (error: unknown) => unknown;
}

const NOT_FOUND: Mapping = { status: 404, code: 'not_found' };

/**
 * Maps an error onto a status and a stable code.
 *
 * Unknown errors deliberately fall through to a generic 500 with no detail.
 * Leaking a stack trace or an SQL message over HTTP would leak the schema and the
 * filesystem layout to anything that can reach the port.
 */
export function describeError(error: unknown): Mapping & { message: string; details?: unknown } {
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'validation_failed',
      message: 'Request failed validation',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  if (error instanceof InvalidQueryError) {
    return {
      status: 400,
      code: 'invalid_query',
      message: error.message,
      details: { path: error.path },
    };
  }

  // A refused container move is a conflict: the request was well formed, but it
  // asks for something the current state forbids.
  if (error instanceof IllegalContainerTransitionError) {
    return { status: 409, code: 'illegal_transition', message: error.message };
  }

  if (
    error instanceof ItemNotFoundError ||
    error instanceof CategoryNotFoundError ||
    error instanceof FieldDefNotFoundError ||
    error instanceof PersonNotFoundError ||
    error instanceof ContextNotFoundError ||
    error instanceof RecurrenceRuleNotFoundError ||
    error instanceof ChecklistTemplateNotFoundError
  ) {
    return { ...NOT_FOUND, message: error.message };
  }

  return {
    status: 500,
    code: 'internal_error',
    message: 'Something went wrong',
  };
}

/** Sends an error response and returns, so callers can `return sendError(...)`. */
export function sendError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const mapping = describeError(error);

  if (mapping.status >= 500) {
    // Log the real error server-side; the client gets nothing sensitive.
    request.log.error({ err: error }, 'unhandled error while handling request');
  }

  const body: ErrorBody = {
    error: {
      code: mapping.code,
      message: mapping.message,
      ...(mapping.details === undefined ? {} : { details: mapping.details }),
    },
  };

  return reply.status(mapping.status).send(body);
}
