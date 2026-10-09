/**
 * Keyboard shortcuts.
 *
 * A GTD app is used with the hands, and typing a shortcut is faster than finding a
 * button. But a shortcut that fires while you are typing a title is worse than no
 * shortcut at all, and a shortcut that means two things is worse than either. Both
 * of those are structural rather than stylistic, so they are handled here, in a
 * pure module, and asserted here rather than discovered in use.
 *
 * Three rules, and each exists because of something that goes wrong without it:
 *
 * - Single-key shortcuts do not fire inside a text field. Otherwise "n" for new item
 *   eats a third of every title someone types.
 * - No two actions may share a binding. The second one registered would simply
 *   never run, which is the worst possible failure: it looks broken, and the cause
 *   is invisible.
 * - Bindings are stored as written ("mod+k") and resolved per platform, so a
 *   shortcut configured on one machine still means the right thing on another.
 */

export type Platform = 'mac' | 'other';

export interface ShortcutAction {
  id: string;
  label: string;
  /** Shown in the shortcut editor, so an action is findable by what it does. */
  description: string;
  group: 'Navigation' | 'Capture' | 'System';
  /**
   * The binding as written, using `mod` for Command on a Mac and Control elsewhere.
   * Single letters are lower case and case is never significant.
   */
  defaultBinding: string;
  /** Shown in the palette. */
  paletteHint?: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: 'commandPalette',
    label: 'Command palette',
    description: 'Search every destination and action',
    group: 'System',
    defaultBinding: 'mod+k',
    paletteHint: 'Search',
  },
  {
    id: 'quickCapture',
    label: 'Capture something',
    description: 'Put a thought in the inbox without deciding where it goes',
    group: 'Capture',
    defaultBinding: 'c',
  },
  {
    id: 'newItem',
    label: 'New item',
    description: 'Create an item in a category of your choice',
    group: 'Capture',
    defaultBinding: 'n',
  },
  {
    id: 'goInbox',
    label: 'Go to inbox',
    description: 'Open the inbox',
    group: 'Navigation',
    defaultBinding: 'i',
  },
  {
    id: 'goNextActions',
    label: 'Go to next actions',
    description: 'Open the next actions list',
    group: 'Navigation',
    defaultBinding: 'a',
  },
  {
    id: 'goCalendar',
    label: 'Go to calendar',
    description: 'Open the calendar',
    group: 'Navigation',
    defaultBinding: 'd',
  },
  {
    id: 'goReview',
    label: 'Go to weekly review',
    description: 'Start the weekly review',
    group: 'Navigation',
    defaultBinding: 'r',
  },
  {
    id: 'toggleTheme',
    label: 'Toggle light and dark',
    description: 'Switch the theme',
    group: 'System',
    defaultBinding: 't',
  },
];

export const DEFAULT_BINDINGS: Record<string, string> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((action) => [action.id, action.defaultBinding]),
);

const MODIFIER_ORDER = ['mod', 'ctrl', 'alt', 'shift'] as const;

export interface ParsedBinding {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/**
 * Parses a written binding.
 *
 * Returns null for anything unusable rather than throwing: bindings come from a
 * settings table that a person or a script can edit, and a bad row there must not
 * be able to break the app on start.
 */
export function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (parts.length === 0) {
    return null;
  }

  const parsed: ParsedBinding = { mod: false, ctrl: false, alt: false, shift: false, key: '' };

  for (const part of parts) {
    if (part === 'mod') {
      parsed.mod = true;
    } else if (part === 'ctrl') {
      parsed.ctrl = true;
    } else if (part === 'alt') {
      parsed.alt = true;
    } else if (part === 'shift') {
      parsed.shift = true;
    } else if (parsed.key === '') {
      parsed.key = part;
    } else {
      // Two non-modifier keys cannot be held at once as a single shortcut.
      return null;
    }
  }

  if (parsed.key === '') {
    return null;
  }

  if (!isUsableKey(parsed.key)) {
    return null;
  }

  return parsed;
}

const NAMED_KEYS = new Set([
  'enter',
  'escape',
  'space',
  'tab',
  'backspace',
  'delete',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
]);

function isUsableKey(key: string): boolean {
  if (NAMED_KEYS.has(key)) {
    return true;
  }
  // A single character, or a digit.
  return [...key].length === 1;
}

/** The modifiers a binding uses, for a human. `mod` resolved to a real name. */
function describeModifiers(binding: ParsedBinding, platform: Platform): string[] {
  const labels: string[] = [];
  if (binding.mod) {
    labels.push(platform === 'mac' ? '⌘' : 'Ctrl');
  }
  if (binding.ctrl) {
    labels.push(platform === 'mac' ? '⌃' : 'Ctrl');
  }
  if (binding.alt) {
    labels.push(platform === 'mac' ? '⌥' : 'Alt');
  }
  if (binding.shift) {
    labels.push(platform === 'mac' ? '⇧' : 'Shift');
  }
  return labels;
}

const KEY_LABELS: Record<string, string> = {
  enter: '↵',
  escape: 'Esc',
  space: 'Space',
  tab: 'Tab',
  backspace: '⌫',
  delete: 'Del',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

/**
 * How a binding should be shown: `⌘K` on a Mac, `Ctrl+K` elsewhere.
 *
 * Shown rather than executed, and the two are computed from the same parse so what
 * the user reads in the editor is what will fire. A shortcut list that lies about
 * its own bindings is worse than no list.
 */
export function formatBinding(binding: string, platform: Platform): string | null {
  const parsed = parseBinding(binding);
  if (!parsed) {
    return null;
  }

  const key = KEY_LABELS[parsed.key] ?? parsed.key.toUpperCase();
  const modifierLabels = describeModifiers(parsed, platform);
  const joiner = platform === 'mac' ? '' : '+';
  return [...modifierLabels, key].join(joiner);
}

/** The event shape the matcher needs, kept structural so tests need no DOM event. */
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Where the keystroke landed, used to suppress bare keys while typing. */
  target?: unknown;
}

/**
 * Whether an event matches a binding on this platform.
 *
 * `mod` means Command on a Mac and Control elsewhere. Resolving it here rather than
 * at configuration time means a shortcut set on a Mac and synced to a Linux machine
 * still means what its author intended.
 */
export function matchesBinding(
  binding: string,
  event: KeyEventLike,
  platform: Platform = detectPlatform(),
): boolean {
  const parsed = parseBinding(binding);
  if (!parsed) {
    return false;
  }

  /*
   * Off a Mac, `mod` *is* Control, and Control is also spelled `ctrl`. Treating
   * them as two separate modifiers would mean "Mod+K" and "Ctrl+K" could not both
   * match the same physical keystroke, and one of them would never fire at all. On
   * a Mac they are genuinely different keys, so both are matched exactly.
   */
  const hasPrimaryModifier = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const wantsPrimaryModifier = parsed.mod || (platform !== 'mac' && parsed.ctrl);

  const wantsSecondaryCtrl = platform === 'mac' && parsed.ctrl;
  const hasSecondaryCtrl = platform === 'mac' && event.ctrlKey;

  if (wantsPrimaryModifier !== hasPrimaryModifier) {
    return false;
  }
  if (wantsSecondaryCtrl !== hasSecondaryCtrl) {
    return false;
  }
  if (parsed.alt !== event.altKey) {
    return false;
  }
  if (parsed.shift !== event.shiftKey) {
    return false;
  }

  const eventKey = normaliseEventKey(event.key);
  if (eventKey === '') {
    return false;
  }

  return eventKey === parsed.key;
}

/**
 * The lowercase name of the key that was pressed.
 *
 * Digits and letters arrive differently depending on layout and modifiers, and
 * `;` is its own named key in some browsers. Comparing names rather than
 * characters is what makes a shortcut work on a layout it was not written on.
 */
export function normaliseEventKey(key: string): string {
  const lower = key.toLowerCase();
  if (/^[a-z0-9]$/.test(lower)) {
    return lower;
  }
  switch (lower) {
    case 'arrowup':
      return 'up';
    case 'arrowdown':
      return 'down';
    case 'arrowleft':
      return 'left';
    case 'arrowright':
      return 'right';
    case 'esc':
      return 'escape';
    case 'return':
      return 'enter';
    case ' ':
      return 'space';
    case 'backspace':
      return 'backspace';
    case 'delete':
      return 'delete';
    case 'tab':
      return 'tab';
    default:
      return lower;
  }
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return 'other';
  }
  // `userAgentData` where available, since the legacy string is deprecated.
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (typeof platform === 'string') {
    return platform.toLowerCase().includes('mac') ? 'mac' : 'other';
  }
  return /mac|iphone|ipad/i.test(navigator.userAgent ?? '') ? 'mac' : 'other';
}

/**
 * Whether a shortcut should be suppressed because the user is typing.
 *
 * This is the rule that stops "n" from eating a third of every title. It checks
 * editable elements rather than counting modifiers, because the shortcuts that cause
 * the damage are exactly the bare letters.
 */
export function isTypingTarget(
  target: {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  } | null,
): boolean {
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = (target.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }
  // A div standing in for a rich text field still swallows keystrokes.
  return target.getAttribute?.('role') === 'textbox';
}

export interface ShortcutConflict {
  binding: string;
  actionIds: string[];
}

/**
 * Bindings claimed by more than one action.
 *
 * Reported rather than silently resolved. Picking a winner would mean that saving a
 * custom binding could quietly break an unrelated action, which is how a shortcut
 * configuration becomes impossible to reason about.
 */
export function findConflicts(
  bindings: Record<string, string>,
  platform: Platform = detectPlatform(),
): ShortcutConflict[] {
  const byBinding = new Map<string, string[]>();

  for (const [actionId, binding] of Object.entries(bindings)) {
    // An unparseable binding matches nothing, so it cannot conflict.
    if (parseBinding(binding) === null) {
      continue;
    }
    // Compared with the platform passed in, not the detected one: on a Mac,
    // "Mod+K" and "Ctrl+K" are different shortcuts because Command and Control are
    // different keys.
    const key = normaliseForComparison(binding, platform);
    const ids = byBinding.get(key) ?? [];
    ids.push(actionId);
    byBinding.set(key, ids);
  }

  return [...byBinding.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([binding, actionIds]) => ({ binding, actionIds }));
}

/**
 * The comparison form of a binding.
 *
 * Modifiers are sorted and `mod` and `ctrl` are equivalent off a Mac, so "Ctrl+K"
 * and "Mod+K" are recognised as the same shortcut there. Reporting those as
 * distinct would hide a real conflict.
 */
function normaliseForComparison(binding: string, platform: Platform = detectPlatform()): string {
  const parsed = parseBinding(binding);
  if (!parsed) {
    return binding.toLowerCase();
  }
  const mods = new Set<string>();
  if (parsed.mod) {
    mods.add(platform === 'mac' ? 'mod' : 'ctrl');
  }
  if (parsed.ctrl) {
    mods.add('ctrl');
  }
  if (parsed.alt) {
    mods.add('alt');
  }
  if (parsed.shift) {
    mods.add('shift');
  }
  return [...[...MODIFIER_ORDER].filter((modifier) => mods.has(modifier)), parsed.key].join('+');
}

/**
 * Merges user overrides onto the defaults.
 *
 * An override that does not parse is dropped rather than passed on, and one for an
 * action that no longer exists is dropped too. Both happen for real when a database
 * outlives the version that wrote it, and neither should stop the app from starting.
 */
export function resolveBindings(overrides: Record<string, unknown>): Record<string, string> {
  const resolved: Record<string, string> = { ...DEFAULT_BINDINGS };

  if (typeof overrides !== 'object' || overrides === null) {
    return resolved;
  }

  for (const [actionId, binding] of Object.entries(overrides)) {
    if (!(actionId in DEFAULT_BINDINGS)) {
      continue;
    }
    if (typeof binding !== 'string') {
      continue;
    }
    if (parseBinding(binding) === null) {
      continue;
    }
    resolved[actionId] = binding.toLowerCase().trim();
  }

  return resolved;
}

/** Whether a binding is safe to save: it parses, and nothing else already has it. */
export function canSaveBinding(
  candidate: string,
  bindings: Record<string, string>,
  actionId: string,
  platform: Platform = detectPlatform(),
): { ok: true } | { ok: false; reason: string } {
  if (parseBinding(candidate) === null) {
    return { ok: false, reason: 'That is not a usable shortcut.' };
  }

  const normalised = normaliseForComparison(candidate, platform);
  for (const [otherId, binding] of Object.entries(bindings)) {
    if (otherId === actionId) {
      continue;
    }
    if (normaliseForComparison(binding, platform) === normalised) {
      return { ok: false, reason: `Already used by "${otherId}".` };
    }
  }

  return { ok: true };
}

/** Whether a shortcut needs the typing-suppression rule. */
export function isBareKey(binding: string): boolean {
  const parsed = parseBinding(binding);
  return parsed !== null && !parsed.mod && !parsed.ctrl && !parsed.alt && !parsed.shift;
}

/** The action with a given id, if it exists. */
export function findAction(actionId: string): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find((action) => action.id === actionId);
}
