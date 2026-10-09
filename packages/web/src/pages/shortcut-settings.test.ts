import { describe, expect, it } from 'vitest';
import { bindingFromEvent } from './shortcut-settings';
import { isBareKey, matchesBinding } from '@/shortcuts/registry';

/**
 * Recording a shortcut from a keypress.
 *
 * The function that decides what a press means. Its judgement calls are the whole
 * design: Command and Control both become `mod`, and Shift is only kept when it is
 * the point of the shortcut.
 */

function press(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
) {
  return {
    key,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
  };
}

describe('recording', () => {
  it('records a bare letter', () => {
    expect(bindingFromEvent(press('j'))).toBe('j');
  });

  it('records a letter as lower case, since case is not significant', () => {
    expect(bindingFromEvent(press('J'))).toBe('j');
  });

  it('records command as mod', () => {
    // `mod` is the part that travels. Writing `cmd` would produce a binding that
    // silently never fires on a Linux machine.
    expect(bindingFromEvent(press('k', { meta: true }))).toBe('mod+k');
  });

  it('records control as the same thing as command', () => {
    expect(bindingFromEvent(press('k', { ctrl: true }))).toBe('mod+k');
  });

  it('records alt', () => {
    expect(bindingFromEvent(press('k', { alt: true }))).toBe('alt+k');
  });

  it('drops shift from a letter, because shift and a letter send the same key', () => {
    // Recording Shift+N instead of N would be accurate and useless: the two can
    // never be told apart at the keyboard.
    expect(bindingFromEvent(press('N', { shift: true }))).toBe('n');
  });

  it('keeps shift for a named key, where it is the point', () => {
    expect(bindingFromEvent(press('Tab', { shift: true }))).toBe('shift+tab');
  });

  it('drops shift when another modifier is already there', () => {
    expect(bindingFromEvent(press('K', { meta: true, shift: true }))).toBe('mod+k');
  });

  it('records several modifiers together', () => {
    expect(bindingFromEvent(press('k', { ctrl: true, alt: true }))).toBe('mod+alt+k');
  });

  it('maps browser key names onto the ones the registry knows', () => {
    expect(bindingFromEvent(press('ArrowUp'))).toBe('up');
    expect(bindingFromEvent(press('Enter'))).toBe('enter');
    expect(bindingFromEvent(press(' '))).toBe('space');
    expect(bindingFromEvent(press('Escape'))).toBe('escape');
    expect(bindingFromEvent(press('F5'))).toBe('f5');
  });

  it('records a digit', () => {
    expect(bindingFromEvent(press('1'))).toBe('1');
  });

  it('refuses a modifier on its own', () => {
    expect(bindingFromEvent(press('Meta', { meta: true }))).toBeNull();
    expect(bindingFromEvent(press('Shift', { shift: true }))).toBeNull();
  });

  it('refuses a key it has no name for', () => {
    expect(bindingFromEvent(press('Unidentified'))).toBeNull();
  });
});

describe('what gets recorded actually fires', () => {
  /*
   * The point of recording instead of typing: the stored binding and the press must
   * be the same thing. If recording could produce a value that does not match the
   * press that produced it, the editor would be a machine for creating dead
   * shortcuts.
   */
  /*
   * The platform is part of each case, not a detail: `mod+k` is Command-K on a Mac
   * and Control-K everywhere else, so a Command press is checked on a Mac and a
   * Control press off one. Asserting a Command press off a Mac would fail — correctly,
   * since `mod` there means Control and Command is a different key.
   */
  const presses: Array<{
    expected: string;
    event: ReturnType<typeof press>;
    platform: 'mac' | 'other';
  }> = [
    { expected: 'j', event: press('j'), platform: 'other' },
    { expected: 'mod+k', event: press('k', { meta: true }), platform: 'mac' },
    { expected: 'mod+k', event: press('k', { ctrl: true }), platform: 'other' },
    { expected: 'alt+j', event: press('j', { alt: true }), platform: 'other' },
    { expected: 'shift+tab', event: press('Tab', { shift: true }), platform: 'other' },
    { expected: 'up', event: press('ArrowUp'), platform: 'other' },
    { expected: 'f5', event: press('F5'), platform: 'other' },
  ];

  for (const { expected, event, platform } of presses) {
    it(`records "${expected}" and fires for the press that made it`, () => {
      expect(bindingFromEvent(event)).toBe(expected);

      const recorded = bindingFromEvent(event) as string;
      expect(matchesBinding(recorded, event, platform)).toBe(true);
    });
  }

  it('does not fire a recorded binding on a platform where mod means another key', () => {
    // Recorded from a Command press, so it works on a Mac. Off one, `mod` is
    // Control, and Command-K is not that shortcut. Asserting it either way would be
    // asserting the wrong thing.
    const recorded = bindingFromEvent(press('k', { meta: true })) as string;

    expect(matchesBinding(recorded, press('k', { meta: true }), 'mac')).toBe(true);
    expect(matchesBinding(recorded, press('k', { meta: true }), 'other')).toBe(false);
  });
});

describe('bare keys and typing', () => {
  it('records letters as bare keys, which is why they need the typing rule', () => {
    // Recorded bare, therefore suppressed while typing. Recording Shift+N instead
    // would have dodged that rule by lying about what was pressed.
    expect(isBareKey(bindingFromEvent(press('n')) as string)).toBe(true);
  });

  it('records modified keys as modified, so they work from a field', () => {
    expect(isBareKey(bindingFromEvent(press('k', { meta: true })) as string)).toBe(false);
  });
});
