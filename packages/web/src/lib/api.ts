/**
 * The API client.
 *
 * Every server call goes through {@link apiFetch}, so error handling is in one
 * place. A failed request comes back as an `ApiError` carrying the server's stable
 * machine-readable code, because callers branch on the code rather than parsing an
 * English message.
 */

import { APP_CONFIG, type ExpandedLike } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages from a validation failure, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const entry of this.details as Array<{ path?: string; key?: string; message?: string }>) {
      const field = entry.path ?? entry.key;
      if (field && entry.message) {
        out[field] = entry.message;
      }
    }
    return out;
  }
}

const BASE = APP_CONFIG.paths.apiBasePath;

type QueryValue = string | number | boolean | null | undefined;

export type Query = Record<string, QueryValue>;

/**
 * Renders the query string, including the leading `?`, or an empty string.
 *
 * Null and undefined are dropped rather than serialised: a filter that was never
 * set must not arrive at the server as the string "undefined", which parses as a
 * value and matches nothing.
 */
export function buildQueryString(query?: Query): string {
  if (!query) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

function buildUrl(path: string, query?: Query): string {
  return `${BASE}${path}${buildQueryString(query)}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    ...(options.body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text === '' ? undefined : safeParse(text);

  if (!response.ok) {
    const error = (payload ?? {}) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    throw new ApiError(
      response.status,
      error.error?.code ?? 'unknown_error',
      error.error?.message ?? `Request failed with status ${response.status}`,
      error.error?.details,
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export const apiFetch = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    // Built conditionally rather than `{ query, signal }`. With
    // `exactOptionalPropertyTypes`, an explicit undefined is not the same as an
    // omitted key, and React Query needs that distinction to know whether a request
    // is cancellable.
    request<T>(path, {
      ...(query === undefined ? {} : { query }),
      ...(signal === undefined ? {} : { signal }),
    }),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
      ...(query === undefined ? {} : { query }),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', ...(body === undefined ? {} : { body }) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', ...(body === undefined ? {} : { body }) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** JSON encoding for the filter and sort ASTs the API accepts in query strings. */
export function encodeJsonParam(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

export type { ExpandedLike };
