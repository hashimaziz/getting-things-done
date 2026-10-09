import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SHORTCUT_SETTING_KEY } from './store';
import { DEFAULT_BINDINGS, findConflicts } from './registry';

/**
 * The store.
 *
 * The interesting question is not "does it save" but "what does it do when it
 * cannot", because the server is on the same machine and that is exactly when it is
 * most likely to be unavailable.
 */

const CACHE_KEY = 'gtd.shortcuts';

/** Replaces the module-level store with one wired to a controllable fetch. */
async function freshStore(routes: Array<{ value?: unknown; status?: number }>) {
  vi.resetModules();
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = url.pathname.split('/').pop();
    const route = routes.find(
      (candidate) => candidate.value !== undefined && key === SHORTCUT_SETTING_KEY,
    );

    const payload =
      route === undefined
        ? { error: { code: 'not_found', message: 'no such setting' } }
        : { key: SHORTCUT_SETTING_KEY, value: route.value };
    const status = route?.status ?? (route === undefined ? 404 : 200);

    if (init?.method === 'PUT') {
      // Record the write so the save path can be asserted.
      saved.push(JSON.parse(String(init.body)) as { value: unknown });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const saved: Array<{ value: unknown }> = [];
  vi.stubGlobal('fetch', stub);

  const module = await import('./store');
  return { store: module.shortcutStore, saved, stub };
}

beforeEach(() => {
  localStorage.clear();
});

describe('loading', () => {
  it('uses the defaults when there is no saved setting', async () => {
    const { store } = await freshStore([]);

    await act(async () => {
      await store.getState().load();
    });

    expect(store.getState().bindings).toEqual(DEFAULT_BINDINGS);
    expect(store.getState().overrides).toEqual({});
    expect(store.getState().loaded).toBe(true);
  });

  it('applies a saved override', async () => {
    const { store } = await freshStore([{ value: { goInbox: 'mod+j' } }]);

    await act(async () => {
      await store.getState().load();
    });

    expect(store.getState().bindings.goInbox).toBe('mod+j');
    expect(store.getState().bindings.goReview).toBe(DEFAULT_BINDINGS.goReview);
  });

  it('records only the differences, so a reset knows what to undo', async () => {
    const { store } = await freshStore([{ value: { goInbox: 'mod+j', goCalendar: 'mod+c' } }]);

    await act(async () => {
      await store.getState().load();
    });

    expect(store.getState().overrides).toEqual({ goInbox: 'mod+j', goCalendar: 'mod+c' });
  });

  it('drops an override for an action that no longer exists', async () => {
    const { store } = await freshStore([{ value: { longGone: 'mod+z' } }]);

    await act(async () => {
      await store.getState().load();
    });

    expect(store.getState().bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('caches the overrides locally, so they survive a reload', async () => {
    const { store } = await freshStore([{ value: { goInbox: 'mod+j' } }]);

    await act(async () => {
      await store.getState().load();
    });

    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')).toEqual({ goInbox: 'mod+j' });
  });

  /*
   * "No setting saved" and "the server did not answer" are different states, and
   * only the first should replace what is cached. Conflating them wipes custom
   * shortcuts on every start with the server briefly unavailable.
   */
  it('seeds from the cache when the server cannot be reached', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ goInbox: 'mod+j' }));

    const { store } = await freshStore([]);
    // A 500 rather than a 404: the difference is "no such setting" versus "no
    // answer", and both must leave the app usable.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    await act(async () => {
      await store.getState().load();
    });

    expect(store.getState().bindings.goInbox).toBe('mod+j');
    expect(store.getState().loaded).toBe(true);
  });

  it('replaces the cache when the server answers with something different', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ goInbox: 'mod+shift+i' }));
    const { store } = await freshStore([{ value: { goInbox: 'mod+j' } }]);

    await act(async () => {
      await store.getState().load();
    });

    expect(store.getState().bindings.goInbox).toBe('mod+j');
  });

  it('survives a corrupt cache', async () => {
    localStorage.setItem(CACHE_KEY, 'not json at all');
    const { store } = await freshStore([]);

    await act(async () => {
      await store.getState().load();
    });

    expect(store.getState().bindings).toEqual(DEFAULT_BINDINGS);
  });
});

describe('saving', () => {
  it('applies a new binding immediately and persists it', async () => {
    const { store, saved } = await freshStore([{ value: {} }]);
    await act(async () => {
      await store.getState().load();
    });

    await act(async () => {
      await store.getState().setBinding('goInbox', 'mod+j');
    });

    expect(store.getState().bindings.goInbox).toBe('mod+j');
    expect(saved).toEqual([{ value: { goInbox: 'mod+j' } }]);
  });

  it('refuses a binding that would conflict with another action', async () => {
    const { store, saved } = await freshStore([{ value: {} }]);
    await act(async () => {
      await store.getState().load();
    });

    let accepted = true;
    await act(async () => {
      accepted = await store.getState().setBinding('goInbox', 'mod+k');
    });

    // Saving it anyway would silently break the palette.
    expect(accepted).toBe(false);
    expect(store.getState().bindings.goInbox).toBe(DEFAULT_BINDINGS.goInbox);
    expect(saved).toEqual([]);
  });

  it('keeps the local state even when the write fails', async () => {
    const { store } = await freshStore([{ value: {} }]);
    await act(async () => {
      await store.getState().load();
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    let accepted = false;
    await act(async () => {
      accepted = await store.getState().setBinding('goInbox', 'mod+j');
    });

    expect(accepted).toBe(true);
    expect(store.getState().bindings.goInbox).toBe('mod+j');
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')).toEqual({ goInbox: 'mod+j' });
  });

  it('never leaves a conflict behind, whichever binding is tried', async () => {
    const { store } = await freshStore([{ value: {} }]);
    await act(async () => {
      await store.getState().load();
      await store.getState().setBinding('goInbox', 'mod+j');
      await store.getState().setBinding('goReview', 'mod+k');
    });

    expect(findConflicts(store.getState().bindings)).toEqual([]);
  });
});

describe('resetting', () => {
  it('returns one action to its default', async () => {
    const { store, saved } = await freshStore([{ value: { goInbox: 'mod+j', goReview: 'mod+r' } }]);
    await act(async () => {
      await store.getState().load();
    });

    await act(async () => {
      await store.getState().reset('goInbox');
    });

    expect(store.getState().bindings.goInbox).toBe(DEFAULT_BINDINGS.goInbox);
    expect(store.getState().bindings.goReview).toBe('mod+r');
    expect(saved.at(-1)?.value).toEqual({ goReview: 'mod+r' });
  });

  it('returns everything to the defaults', async () => {
    const { store, saved } = await freshStore([{ value: { goInbox: 'mod+j', goReview: 'mod+r' } }]);
    await act(async () => {
      await store.getState().load();
    });

    await act(async () => {
      await store.getState().resetAll();
    });

    expect(store.getState().bindings).toEqual(DEFAULT_BINDINGS);
    expect(store.getState().overrides).toEqual({});
    expect(saved.at(-1)?.value).toEqual({});
  });

  it('does not fail when the reset cannot be saved', async () => {
    const { store } = await freshStore([{ value: { goInbox: 'mod+j' } }]);
    await act(async () => {
      await store.getState().load();
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    await act(async () => {
      await store.getState().resetAll();
    });

    expect(store.getState().bindings).toEqual(DEFAULT_BINDINGS);
  });
});
