/**
 * HTTP-shaped errors for cases the domain does not model.
 *
 * A domain error like `ItemNotFoundError` is raised by a repository. These are
 * raised by a route when the request itself is wrong in a way the domain has no
 * concept of, such as field values that do not match their definitions.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The request was well formed JSON but semantically wrong. */
export class BadRequestError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, 'bad_request', message, details);
    this.name = 'BadRequestError';
  }
}

/** The request conflicts with the current state of the resource. */
export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, 'conflict', message, details);
    this.name = 'ConflictError';
  }
}
