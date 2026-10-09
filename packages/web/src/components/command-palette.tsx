/**
 * The command palette.
 *
 * One search box for every destination and action in the app. It exists because a
 * navigation tree is the right answer for someone learning the app and the wrong
 * answer for someone using it forty times a day, and there is no way to tell which
 * one is looking at it.
 *
 * Destinations come from the navigation table, so a new screen is searchable by
 * existing there rather than by being remembered here. Actions come from the
 * shortcut registry, so the palette and the keyboard cannot disagree about what
 * exists.
 */

import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { ALL_NAV_ITEMS } from '@/lib/navigation';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme-provider';
import {
  SHORTCUT_ACTIONS,
  detectPlatform,
  formatBinding,
  type ShortcutAction,
} from '@/shortcuts/registry';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words the search should match, so "gtd" finds the right row. */
  keywords: string[];
  group: string;
  hint?: string;
  run: () => void;
}

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the shortcut editor, which the palette advertises but cannot act on itself. */
  onEditShortcuts?: () => void;
}

export function CommandPalette({ open, onOpenChange, onEditShortcuts }: PaletteProps) {
  const navigate = useNavigate();
  const { toggle: toggleTheme } = useTheme();
  const platform = detectPlatform();

  // Declared as a plain array and returned, rather than annotated inline: with
  // `exactOptionalPropertyTypes`, a hint computed as `string | undefined` is not
  // assignable to an optional `string` unless the key is genuinely absent.
  const commands = useMemo<PaletteCommand[]>(() => {
    const destinations: PaletteCommand[] = ALL_NAV_ITEMS.map((item) => ({
      id: `go:${item.to}`,
      label: item.label,
      keywords: [item.to.replace('/list/', '').replace('/', ' '), 'go to', 'open'],
      group: 'Go to',
      ...(item.hint === undefined ? {} : { hint: item.hint.toUpperCase() }),
      run: () => navigate(item.to),
    }));

    const actions: PaletteCommand[] = SHORTCUT_ACTIONS.filter(
      // The palette itself is already open; offering to open it is noise.
      (action) => action.id !== 'commandPalette',
    ).map((action) => ({
      id: `action:${action.id}`,
      label: action.label,
      keywords: [action.description, action.group],
      group: 'Actions',
      ...(formatBinding(action.defaultBinding, platform) === null
        ? {}
        : { hint: formatBinding(action.defaultBinding, platform) as string }),
      run: () => runAction(action, navigate, toggleTheme),
    }));

    return [
      ...destinations,
      ...actions,
      {
        id: 'setup:shortcuts',
        label: 'Edit keyboard shortcuts',
        keywords: ['keyboard', 'shortcuts', 'keys', 'bindings'],
        group: 'Configure',
        // Deliberately has no key hint: the editor itself does not exist yet, and
        // advertising a shortcut for a screen that is not there is worse than
        // showing nothing.
        run: () => {
          onEditShortcuts?.();
        },
      },
    ];
  }, [navigate, toggleTheme, onEditShortcuts, platform]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      // cmdk renders a dialog with its own overlay and positioning.
      className={cn(
        'fixed left-1/2 top-1/4 z-50 w-full max-w-lg -translate-x-1/2',
        'overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg',
      )}
      overlayClassName="fixed inset-0 z-40 bg-black/40"
    >
      <Command.Input
        autoFocus
        placeholder="Search actions and destinations"
        className="h-11 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-80 overflow-y-auto p-1">
        <Command.Empty className="p-4 text-center text-xs text-muted-foreground">
          Nothing matches that.
        </Command.Empty>
        {['Go to', 'Actions', 'Configure'].map((group) => (
          <Command.Group
            key={group}
            heading={group}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {commands
              .filter((command) => command.group === group)
              .map((command) => (
                <Command.Item
                  key={command.id}
                  value={`${command.label} ${command.keywords.join(' ')}`}
                  onSelect={() => {
                    command.run();
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <span className="truncate">{command.label}</span>
                  {command.hint ? (
                    <kbd className="shrink-0 rounded border bg-muted px-1 font-mono text-[0.625rem] text-muted-foreground">
                      {command.hint}
                    </kbd>
                  ) : null}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}

/**
 * What each action does when run from the palette.
 *
 * Navigation is by route rather than by shortcut handler, so the palette works
 * identically whether or not the keyboard handler is installed. Keeping one
 * definition of "what new item does" in two places is how those two drift.
 */
function runAction(
  action: ShortcutAction,
  navigate: (to: string) => void,
  toggleTheme: () => void,
): void {
  switch (action.id) {
    case 'quickCapture':
      navigate('/capture');
      return;
    case 'newItem':
      navigate('/capture?new=1');
      return;
    case 'goInbox':
      navigate('/list/inbox');
      return;
    case 'goNextActions':
      navigate('/list/next_action');
      return;
    case 'goCalendar':
      navigate('/calendar');
      return;
    case 'goReview':
      navigate('/review');
      return;
    case 'toggleTheme':
      toggleTheme();
      return;
    default:
      return;
  }
}

/** Controlled wrapper, so the shell owns whether the palette is open. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, toggle: () => setOpen((value) => !value), close: () => setOpen(false) };
}
