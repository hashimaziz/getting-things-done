import { ApiError, apiFetch, buildQueryString } from './api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed body', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ items: [1, 2] }));

    await expect(apiFetch.get<{ items: number[] }>('/items')).resolves.toEqual({ items: [1, 2] });
  });

  it('treats 204 as no content rather than a parse failure', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch.delete('/items/1')).resolves.toBeUndefined();
  });

  it('throws an ApiError carrying the server code', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: 'validation_failed', message: 'Title is required' } }, 400),
    );

    const error = await apiFetch.post('/items', {}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe('validation_failed');
    expect((error as ApiError).message).toBe('Title is required');
  });

  it('falls back when the error body is not the expected shape', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    const error = (await apiFetch.get('/items').catch((cause: unknown) => cause)) as ApiError;

    expect(error.status).toBe(502);
    expect(error.code).toBe('unknown_error');
  });

  it('exposes field errors from a validation failure', () => {
    const error = new ApiError(400, 'validation_failed', 'Invalid', [
      { path: 'title', message: 'Title is required' },
      { path: 'estimateMinutes', message: 'Must not be negative' },
    ]);

    expect(error.fieldErrors).toEqual({
      title: 'Title is required',
      estimateMinutes: 'Must not be negative',
    });
  });

  it('has no field errors when the details are not a list', () => {
    expect(new ApiError(409, 'duplicate_key', 'Duplicate', {}).fieldErrors).toEqual({});
  });

  it('omits null and undefined query parameters', () => {
    expect(buildQueryString({ a: 1, b: null, c: undefined, d: false })).toBe('?a=1&d=false');
  });

  it('encodes filter values rather than concatenating them', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ items: [] }));

    await apiFetch.get('/items', { filter: 'kind=condition&field=title' });

    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain('filter=kind%3Dcondition%26field%3Dtitle');
  });

  it('sends a JSON body with the right content type', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ item: {} }));

    await apiFetch.post('/items', { title: 'New' });

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"title":"New"}');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends no body for a request without one', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch.get('/items');

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  it('propagates an abort signal', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
    const controller = new AbortController();

    await apiFetch.get('/items', undefined, controller.signal);

    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
