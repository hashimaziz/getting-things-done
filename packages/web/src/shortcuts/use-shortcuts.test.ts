import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resolveShortcut, useShortcuts } from './use-shortcuts';
import { DEFAULT_BINDINGS } from './registry';

/**
 * The suppression rules.
 *
 * Pure, so no DOM is needed for most of it. These are the rules that decide whether
 * a shortcut is a convenience or an annoyance, and both failure directions matter:
 * a shortcut that fires while typing destroys text, and one that never fires is
 * just a documented lie.
 */

function press(key: string, modifiers: Record<string, boolean> = {}, target: unknown = undefined) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
    ...(target === undefined ? {} : { target }),
  };
}

const DIV = { tagName: 'DIV', isContentEditable: false };
const INPUT = { tagName: 'INPUT', isContentEditable: false };
const EDITABLE = { tagName: 'DIV', isContentEditable: true };

/**
 * The platform is stated in every test that uses a modifier.
 *
 * On a Mac `Mod+K` means Command-K and off a Mac it means Control-K, so a test that
 * says "metaKey" without saying which platform it means passes on one machine and
 * fails on the other.
 */
const MAC = { platform: 'mac' } as const;

function allHandlers() {
  const handlers: Record<string, () => void> = {};
  for (const id of Object.keys(DEFAULT_BINDINGS)) {
    handlers[id] = vi.fn();
  }
  return handlers;
}

describe('resolution', () => {
  it('resolves a bare letter with no handler in the way', () => {
    expect(
      resolveShortcut(press('n'), { bindings: DEFAULT_BINDINGS, handlers: allHandlers() }),
    ).toBe('newItem');
  });

  it('resolves nothing for an unbound key', () => {
    expect(
      resolveShortcut(press('9'), { bindings: DEFAULT_BINDINGS, handlers: allHandlers() }),
    ).toBeNull();
  });

  it('ignores an action with no handler', () => {
    // An action the shell has not wired up yet should be inert, not a crash.
    const { bindings, handlers } = { bindings: DEFAULT_BINDINGS, handlers: allHandlers() };
    delete handlers.goReview;

    expect(resolveShortcut(press('r'), { bindings, handlers })).toBeNull();
  });

  it('ignores an action with no binding', () => {
    const bindings = { ...DEFAULT_BINDINGS };
    delete bindings.goReview;

    expect(resolveShortcut(press('r'), { bindings, handlers: allHandlers() })).toBeNull();
  });

  it('resolves nothing when disabled', () => {
    expect(
      resolveShortcut(press('n'), {
        bindings: DEFAULT_BINDINGS,
        handlers: allHandlers(),
        enabled: false,
      }),
    ).toBeNull();
  });

  it('honours a custom binding', () => {
    const bindings = { ...DEFAULT_BINDINGS, goInbox: 'mod+j' };

    expect(
      resolveShortcut(press('j', { metaKey: true }), {
        bindings,
        handlers: allHandlers(),
        ...MAC,
      }),
    ).toBe('goInbox');
  });
});

describe('suppression while typing', () => {
  /*
   * This is the rule that matters most in the whole file. Without it, "n" for new
   * item eats a third of every title anyone types, and the cost of the feature is
   * higher than the cost of not having it.
   */
  it('does not fire a bare key from a text input', () => {
    expect(
      resolveShortcut(press('n', {}, INPUT), {
        bindings: DEFAULT_BINDINGS,
        handlers: allHandlers(),
      }),
    ).toBeNull();
  });

  it('does not fire a bare key from a textarea', () => {
    expect(
      resolveShortcut(press('c', {}, { tagName: 'TEXTAREA', isContentEditable: false }), {
        bindings: DEFAULT_BINDINGS,
        handlers: allHandlers(),
      }),
    ).toBeNull();
  });

  it('does not fire a bare key from a contenteditable region', () => {
    expect(
      resolveShortcut(press('n', {}, EDITABLE), {
        bindings: DEFAULT_BINDINGS,
        handlers: allHandlers(),
      }),
    ).toBeNull();
  });

  it('does fire from somewhere that is not a field', () => {
    expect(
      resolveShortcut(press('n', {}, DIV), { bindings: DEFAULT_BINDINGS, handlers: allHandlers() }),
    ).toBe('newItem');
  });

  it('still fires a modified shortcut from a field', () => {
    // Nobody types Command-K into a title, and suppressing it would make the
    // palette unreachable from a search box, which is where someone might want it.
    expect(
      resolveShortcut(press('k', { metaKey: true }, INPUT), {
        bindings: DEFAULT_BINDINGS,
        handlers: allHandlers(),
        ...MAC,
      }),
    ).toBe('commandPalette');
  });

  it('still fires a shifted bare key from a field, since shift is named', () => {
    const bindings = { ...DEFAULT_BINDINGS, goInbox: 'shift+i' };

    expect(
      resolveShortcut(press('I', { shiftKey: true }, INPUT), {
        bindings,
        handlers: allHandlers(),
        ...MAC,
      }),
    ).toBe('goInbox');
  });

  it('does not fire from a select, whose arrow keys are its own', () => {
    expect(
      resolveShortcut(press('n', {}, { tagName: 'SELECT', isContentEditable: false }), {
        bindings: DEFAULT_BINDINGS,
        handlers: allHandlers(),
      }),
    ).toBeNull();
  });
});

describe('the installed listener', () => {
  /** Mounts the hook and returns a function that dispatches a keydown. */
  function mount(
    handlers: Record<string, () => void>,
    bindings = DEFAULT_BINDINGS,
    platform: 'mac' | 'other' = 'other',
  ) {
    renderHook(() => useShortcuts({ bindings, handlers, platform }));

    return (init: KeyboardEventInit & { target?: unknown }) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      const target = init.target as HTMLElement | undefined;
      (target ?? window).dispatchEvent(event);
      return event;
    };
  }

  it('runs the handler when a shortcut is pressed', () => {
    const handler = vi.fn();
    const pressKey = mount({ newItem: handler });

    pressKey({ key: 'n' });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('prevents the browser default, so Cmd+K does not open the address bar', () => {
    // Without this, the palette opens and the tab's search bar opens with it.
    const pressKey = mount({ commandPalette: vi.fn() }, DEFAULT_BINDINGS, 'mac');

    const event = pressKey({ key: 'k', metaKey: true });

    expect(event.defaultPrevented).toBe(true);
  });

  it('does not prevent the default for a key it does not handle', () => {
    const pressKey = mount({ newItem: vi.fn() });

    const event = pressKey({ key: 'j' });

    expect(event.defaultPrevented).toBe(false);
  });

  it('does not fire while an input has focus', () => {
    const handler = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const pressKey = mount({ newItem: handler });

    pressKey({ key: 'n', target: input });

    expect(handler).not.toHaveBeenCalled();
    input.remove();
  });

  it('stops listening once unmounted', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useShortcuts({ bindings: DEFAULT_BINDINGS, handlers: { newItem: handler } }),
    );

    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));

    expect(handler).not.toHaveBeenCalled();
  });
});
