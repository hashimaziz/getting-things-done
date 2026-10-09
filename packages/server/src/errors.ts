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
  ConstraintViolationError,
  ContextNotFoundError,
  DuplicateKeyError,
  FieldDefNotFoundError,
  IllegalContainerTransitionError,
  InvalidReferenceError,
  ItemNotFoundError,
  PersonNotFoundError,
  RecurrenceRuleNotFoundError,
} from '@gtd/db';
import { InvalidQueryError } from '@gtd/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { HttpError } from './http-errors.js';

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
  // A route-raised HTTP error already knows its own status and code.
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

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

  // A duplicate unique key is a conflict with existing state, and one the user
  // can act on by choosing a different value.
  if (error instanceof DuplicateKeyError) {
    return {
      status: 409,
      code: 'duplicate_key',
      message: error.message,
      details: { field: error.column },
    };
  }

  // A reference to something that does not exist is well-formed but unsatisfiable.
  if (error instanceof InvalidReferenceError) {
    return {
      status: 422,
      code: 'invalid_reference',
      message: error.message,
      details: { field: error.column },
    };
  }

  // A constraint with no specific explanation. Unique and foreign-key cases are
  // handled above, so this is either a CHECK violation from a value the schemas
  // let through, or a NOT NULL violation, which means this code has a bug.
  if (error instanceof ConstraintViolationError) {
    return {
      status: error.kind === 'not_null' ? 500 : 400,
      code: error.kind === 'not_null' ? 'internal_error' : 'constraint_violation',
      message: error.message,
      details: { kind: error.kind },
    };
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
