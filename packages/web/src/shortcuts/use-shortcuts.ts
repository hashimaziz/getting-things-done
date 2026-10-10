/**
 * The global shortcut handler.
 *
 * One listener for the whole application, rather than one per shortcut. Two
 * listeners racing over the same key is how "press N, get two dialogs" happens, and
 * it is a bug that only appears when two features were built by different people in
 * different weeks.
 *
 * The lookup is a scan over the action list, which is short enough that a Map keyed
 * by resolved binding would be premature. It is written so that changing it later is
 * a local change.
 */

import { useEffect } from 'react';
import {
  SHORTCUT_ACTIONS,
  detectPlatform,
  isBareKey,
  isTypingTarget,
  matchesBinding,
  type KeyEventLike,
  type Platform,
} from './registry';

/** What {@link isTypingTarget} accepts. Structural so tests need no real element. */
type TypingTarget = Parameters<typeof isTypingTarget>[0];

export type ShortcutHandlers = Record<string, () => void>;

function toEventLike(event: KeyboardEvent): KeyEventLike {
  return {
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}

export interface ShortcutOptions {
  bindings: Record<string, string>;
  handlers: ShortcutHandlers;
  /** Disabled while a modal owns the keyboard, so Escape and letters reach it. */
  enabled?: boolean;
  /**
   * Which keyboard's Command key is "mod".
   *
   * A parameter rather than a detection buried inside the matcher, because the
   * difference is not cosmetic: on a Mac `Mod+K` is Command-K and off a Mac it is
   * Control-K. Anything testing this needs to say which one it means, and a
   * detection that silently picks one makes those tests lie on one platform.
   */
  platform?: Platform;
}

/**
 * Works out which action, if any, an event should trigger.
 *
 * Pure, and exported, because the suppression rules are the part worth testing and
 * they are much easier to test without a document.
 */
export function resolveShortcut(event: KeyEventLike, options: ShortcutOptions): string | null {
  if (options.enabled === false) {
    return null;
  }

  const platform = options.platform ?? detectPlatform();

  for (const action of SHORTCUT_ACTIONS) {
    const binding = options.bindings[action.id];
    if (binding === undefined || options.handlers[action.id] === undefined) {
      continue;
    }

    if (!matchesBinding(binding, event, platform)) {
      continue;
    }

    /*
     * Bare letters and digits are suppressed while typing. Modified shortcuts are
     * not: nobody types Command-K into a title, and suppressing them would make
     * the palette unreachable from a search field, which is exactly where someone
     * might want it.
     */
    if (isBareKey(binding) && isTypingTarget(event.target as TypingTarget | null)) {
      continue;
    }

    return action.id;
  }

  return null;
}

/**
 * Installs the handler.
 *
 * `capture` is used so a shortcut still fires while focus is somewhere that would
 * otherwise stop propagation, such as inside a list with its own key handling. The
 * exception is the typing rule above, which is checked explicitly rather than being
 * left to luck.
 */
export function useShortcuts(options: ShortcutOptions): void {
  const { bindings, handlers, enabled = true, platform } = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const actionId = resolveShortcut(
        { ...toEventLike(event), target: event.target as HTMLElement | null },
        { bindings, handlers, enabled, ...(platform === undefined ? {} : { platform }) },
      );

      if (actionId === null) {
        return;
      }

      // preventDefault before running: the browser's own handling of a modified
      // letter is usually "type nothing", but Cmd+K focuses the address bar and
      // Cmd+W closes the tab, both of which would happen after ours.
      event.preventDefault();
      handlers[actionId]?.();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [bindings, handlers, enabled, platform]);
}
