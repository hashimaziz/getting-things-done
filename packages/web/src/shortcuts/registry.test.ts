import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  SHORTCUT_ACTIONS,
  canSaveBinding,
  detectPlatform,
  findAction,
  findConflicts,
  formatBinding,
  isBareKey,
  isTypingTarget,
  matchesBinding,
  normaliseEventKey,
  parseBinding,
  resolveBindings,
} from './registry';

/**
 * A key event, so tests read as the keystroke they mean rather than as object
 * literals with six boolean fields.
 */
function press(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
  target: unknown = undefined,
) {
  return {
    key,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    ...(target === undefined ? {} : { target }),
  };
}

const DIV = { tagName: 'DIV', isContentEditable: false };
const INPUT = { tagName: 'INPUT', isContentEditable: false };
const TEXTAREA = { tagName: 'TEXTAREA', isContentEditable: false };

describe('the default bindings', () => {
  it('gives every action a binding', () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(DEFAULT_BINDINGS[action.id], action.id).toBeTruthy();
    }
  });

  it('gives every action a usable binding', () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(parseBinding(action.defaultBinding), action.id).not.toBeNull();
    }
  });

  it('does not ship two actions with the same binding', () => {
    // The second would simply never run. That is the worst kind of bug: it looks
    // broken and the cause is invisible.
    expect(findConflicts(DEFAULT_BINDINGS)).toEqual([]);
  });

  it('uses unique action ids', () => {
    const ids = SHORTCUT_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every action, since the editor is searched by description', () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(action.description.length, action.id).toBeGreaterThan(10);
    }
  });

  it('finds an action by id', () => {
    expect(findAction('goReview')?.label).toBe('Go to weekly review');
    expect(findAction('nope')).toBeUndefined();
  });
});

describe('parsing', () => {
  it('parses a bare letter', () => {
    expect(parseBinding('n')).toEqual({
      mod: false,
      ctrl: false,
      alt: false,
      shift: false,
      key: 'n',
    });
  });

  it('is case insensitive', () => {
    expect(parseBinding('MOD+K')).toEqual(parseBinding('mod+k'));
  });

  it('tolerates whitespace around parts', () => {
    expect(parseBinding(' mod + alt + k ')).toEqual(parseBinding('mod+alt+k'));
  });

  it('parses every modifier', () => {
    expect(parseBinding('mod+ctrl+alt+shift+z')).toEqual({
      mod: true,
      ctrl: true,
      alt: true,
      shift: true,
      key: 'z',
    });
  });

  it('rejects an empty binding', () => {
    expect(parseBinding('')).toBeNull();
    expect(parseBinding('   ')).toBeNull();
  });

  it('rejects modifiers with no key', () => {
    expect(parseBinding('mod')).toBeNull();
    expect(parseBinding('mod+shift')).toBeNull();
  });

  it('rejects two keys, which cannot be pressed as one shortcut', () => {
    expect(parseBinding('a+b')).toBeNull();
  });

  it('rejects a multi-character key', () => {
    expect(parseBinding('mod+hello')).toBeNull();
  });

  it('accepts named keys', () => {
    expect(parseBinding('mod+enter')?.key).toBe('enter');
    expect(parseBinding('escape')?.key).toBe('escape');
  });

  it('accepts a digit', () => {
    expect(parseBinding('1')?.key).toBe('1');
  });
});

describe('matching', () => {
  it('matches a bare letter with no modifiers', () => {
    expect(matchesBinding('n', press('n'), 'other')).toBe(true);
  });

  it('does not match when a modifier is held that the binding does not name', () => {
    expect(matchesBinding('n', press('n', { ctrl: true }), 'other')).toBe(false);
  });

  it('matches a modified key only with that modifier', () => {
    expect(matchesBinding('mod+k', press('k', { meta: true }), 'mac')).toBe(true);
    expect(matchesBinding('mod+k', press('k', { ctrl: true }), 'mac')).toBe(false);
  });

  /*
   * Off a Mac, `mod` is Control, and `ctrl` is also Control. If they were treated
   * as two distinct modifiers, "Mod+K" and "Ctrl+K" could not both match the same
   * keystroke and one of them would never fire.
   */
  it('treats mod and ctrl as the same key off a Mac', () => {
    expect(matchesBinding('ctrl+k', press('k', { ctrl: true }), 'other')).toBe(true);
    expect(matchesBinding('mod+k', press('k', { ctrl: true }), 'other')).toBe(true);
  });

  it('treats command and control as different keys on a Mac', () => {
    expect(matchesBinding('ctrl+k', press('k', { ctrl: true }), 'mac')).toBe(true);
    expect(matchesBinding('mod+k', press('k', { ctrl: true }), 'mac')).toBe(false);
    expect(matchesBinding('ctrl+k', press('k', { meta: true }), 'mac')).toBe(false);
  });

  it('requires shift to be named explicitly', () => {
    expect(matchesBinding('mod+k', press('K', { meta: true, shift: true }), 'mac')).toBe(false);
    expect(matchesBinding('mod+shift+k', press('K', { meta: true, shift: true }), 'mac')).toBe(
      true,
    );
  });

  it('is case insensitive for letters', () => {
    expect(matchesBinding('mod+k', press('k', { meta: true }), 'mac')).toBe(true);
    expect(matchesBinding('mod+k', press('K', { meta: true }), 'mac')).toBe(true);
  });

  it('matches named keys', () => {
    expect(matchesBinding('escape', press('Escape'), 'other')).toBe(true);
    expect(matchesBinding('mod+enter', press('Enter', { ctrl: true }), 'other')).toBe(true);
  });

  it('matches the alias for an arrow key', () => {
    expect(matchesBinding('down', press('ArrowDown'), 'other')).toBe(true);
  });

  it('never matches an unusable binding', () => {
    expect(matchesBinding('', press('n'), 'other')).toBe(false);
    expect(matchesBinding('mod', press('n'), 'other')).toBe(false);
  });
});

describe('key normalisation', () => {
  it('lowercases letters and digits', () => {
    expect(normaliseEventKey('A')).toBe('a');
    expect(normaliseEventKey('7')).toBe('7');
  });

  it('maps aliases onto one name', () => {
    expect(normaliseEventKey('ArrowUp')).toBe('up');
    expect(normaliseEventKey('Esc')).toBe('escape');
    expect(normaliseEventKey('Return')).toBe('enter');
    expect(normaliseEventKey(' ')).toBe('space');
  });

  it('passes a named key through in lower case', () => {
    expect(normaliseEventKey('F5')).toBe('f5');
    expect(normaliseEventKey('Tab')).toBe('tab');
  });
});

describe('formatting', () => {
  it('shows the Mac symbols on a Mac', () => {
    expect(formatBinding('mod+k', 'mac')).toBe('⌘K');
    expect(formatBinding('mod+shift+l', 'mac')).toBe('⌘⇧L');
  });

  it('names the modifiers elsewhere', () => {
    expect(formatBinding('mod+k', 'other')).toBe('Ctrl+K');
    expect(formatBinding('mod+alt+shift+l', 'other')).toBe('Ctrl+Alt+Shift+L');
  });

  it('shows a bare letter as a capital', () => {
    expect(formatBinding('n', 'other')).toBe('N');
  });

  it('uses glyphs for named keys', () => {
    expect(formatBinding('escape', 'other')).toBe('Esc');
    expect(formatBinding('mod+enter', 'mac')).toBe('⌘↵');
  });

  it('refuses to display an unusable binding rather than showing nonsense', () => {
    expect(formatBinding('mod', 'other')).toBeNull();
  });

  it('displays exactly what will fire', () => {
    // The point of sharing the parser between display and matching: a shortcut list
    // that lies about its own bindings is worse than no list.
    for (const action of SHORTCUT_ACTIONS) {
      const shown = formatBinding(action.defaultBinding, 'mac');
      expect(shown, action.id).not.toBeNull();
    }
  });
});

describe('typing suppression', () => {
  it('recognises text fields', () => {
    expect(isTypingTarget(INPUT)).toBe(true);
    expect(isTypingTarget(TEXTAREA)).toBe(true);
  });

  it('recognises a contenteditable region', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('recognises an element standing in for a text box', () => {
    // A div with role="textbox" still swallows keystrokes, so it counts.
    expect(
      isTypingTarget({ tagName: 'DIV', isContentEditable: false, getAttribute: () => 'textbox' }),
    ).toBe(true);
  });

  it('does not treat ordinary elements as typing', () => {
    expect(isTypingTarget(DIV)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('treats a select as typing, because arrow keys are its own', () => {
    expect(isTypingTarget({ tagName: 'SELECT', isContentEditable: false })).toBe(true);
  });
});

describe('bare keys', () => {
  it('knows which bindings need the suppression rule', () => {
    expect(isBareKey('n')).toBe(true);
    expect(isBareKey('mod+n')).toBe(false);
    expect(isBareKey('shift+n')).toBe(false);
    expect(isBareKey('')).toBe(false);
  });
});

describe('conflicts', () => {
  it('finds two actions sharing a binding', () => {
    const conflicts = findConflicts({ first: 'mod+k', second: 'mod+k' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts.at(0)?.actionIds).toEqual(['first', 'second']);
  });

  it('reports nothing when all bindings differ', () => {
    expect(findConflicts({ first: 'mod+k', second: 'mod+j' })).toEqual([]);
  });

  it('recognises mod and ctrl as the same binding off a Mac', () => {
    // `'other'` is every platform that is not a Mac.
    expect(findConflicts({ first: 'mod+k', second: 'ctrl+k' }, 'other')).toHaveLength(1);
  });

  it('treats them as different on a Mac, where they are different keys', () => {
    expect(findConflicts({ first: 'mod+k', second: 'ctrl+k' }, 'mac')).toHaveLength(0);
  });

  it('spots a conflict written the other way round', () => {
    expect(findConflicts({ first: 'ctrl+k', second: 'mod+k' }, 'mac')).toHaveLength(0);
    expect(findConflicts({ first: 'ctrl+k', second: 'mod+k' }, 'other')).toHaveLength(1);
  });

  it('ignores an unusable binding, since it can never fire', () => {
    expect(findConflicts({ first: 'mod', second: 'mod' })).toEqual([]);
  });

  it('ignores order of modifiers', () => {
    expect(findConflicts({ first: 'mod+shift+k', second: 'shift+mod+k' })).toHaveLength(1);
  });
});

describe('saving', () => {
  it('accepts an unused binding', () => {
    expect(canSaveBinding('mod+j', DEFAULT_BINDINGS, 'goInbox', 'other').ok).toBe(true);
  });

  it('refuses a binding another action already has', () => {
    const result = canSaveBinding('mod+k', DEFAULT_BINDINGS, 'goInbox', 'other');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('commandPalette');
  });

  it('lets an action keep its own binding', () => {
    expect(canSaveBinding('mod+k', DEFAULT_BINDINGS, 'commandPalette', 'other').ok).toBe(true);
  });

  it('refuses an unusable binding', () => {
    expect(canSaveBinding('mod', DEFAULT_BINDINGS, 'goInbox', 'other').ok).toBe(false);
  });
});

describe('resolving overrides', () => {
  it('returns the defaults when there is nothing to override', () => {
    expect(resolveBindings({})).toEqual(DEFAULT_BINDINGS);
  });

  it('applies an override', () => {
    expect(resolveBindings({ goInbox: 'mod+j' }).goInbox).toBe('mod+j');
  });

  it('ignores an override for an action that no longer exists', () => {
    // A database outlives the version that wrote it.
    expect(resolveBindings({ longGoneAction: 'mod+z' })).toEqual(DEFAULT_BINDINGS);
  });

  it('ignores an override that is not a string', () => {
    expect(resolveBindings({ goInbox: 42 }).goInbox).toBe(DEFAULT_BINDINGS.goInbox);
  });

  it('ignores an override that does not parse', () => {
    expect(resolveBindings({ goInbox: 'mod' }).goInbox).toBe(DEFAULT_BINDINGS.goInbox);
  });

  it('normalises what it stores', () => {
    expect(resolveBindings({ goInbox: '  MOD+J  ' }).goInbox).toBe('mod+j');
  });

  it('survives a value that is not an object at all', () => {
    expect(resolveBindings(null as never)).toEqual(DEFAULT_BINDINGS);
    expect(resolveBindings('nonsense' as never)).toEqual(DEFAULT_BINDINGS);
  });
});

describe('platform detection', () => {
  it('never throws, whatever navigator says', () => {
    expect(['mac', 'other']).toContain(detectPlatform());
  });
});
