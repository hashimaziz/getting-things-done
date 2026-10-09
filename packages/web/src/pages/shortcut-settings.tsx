/**
 * The shortcut editor.
 *
 * Rebinding is done by pressing the combination, not by typing it. Asking someone to
 * type "mod+k" invites the three spellings nobody agrees on — "cmd+k", "ctrl+k",
 * "command+k" — and each one that fails to parse becomes a shortcut that silently
 * does not work. Pressing the keys cannot be misremembered, because the press is the
 * value.
 *
 * Conflicts are refused rather than resolved. Saving a binding another action already
 * holds would mean one of them silently stops working, and no version of that is
 * debuggable from the screen you are looking at.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
} from '@/components/ui';
import { Page, PageHeader } from '@/components/layout/app-shell';
import { useDocumentTitle } from '@/lib/document-title';
import {
  SHORTCUT_ACTIONS,
  canSaveBinding,
  detectPlatform,
  findConflicts,
  formatBinding,
  parseBinding,
  type Platform,
  type ShortcutAction,
} from '@/shortcuts/registry';
import { useShortcuts } from '@/shortcuts/store';

/** Browser key names mapped onto the names the registry understands. */
const KEY_NAMES: Record<string, string> = {
  Enter: 'enter',
  Tab: 'tab',
  Escape: 'escape',
  ' ': 'space',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
};

function namedKey(key: string): string | null {
  if (KEY_NAMES[key] !== undefined) {
    return KEY_NAMES[key];
  }
  if ([...key].length === 1) {
    return key.toLowerCase();
  }
  if (/^f\d{1,2}$/i.test(key)) {
    return key.toLowerCase();
  }
  return null;
}

/**
 * Turns a keypress into a written binding.
 *
 * Command and Control both become `mod`, because off a Mac they are the same key and
 * `mod` is the part that travels. Writing `cmd` would produce a binding that silently
 * never fires on a Linux machine.
 *
 * Shift is kept only when it is the point of the shortcut, as in Shift+Tab. Recording
 * Shift+N instead of N would be accurate and useless, since Shift+N and N send the same
 * letter.
 */
export function bindingFromEvent(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  const key = namedKey(event.key);
  if (key === null) {
    return null;
  }

  const primary = event.metaKey || event.ctrlKey;
  const parts: string[] = [];
  if (primary) {
    parts.push('mod');
  }
  if (event.altKey) {
    parts.push('alt');
  }
  if (event.shiftKey && !primary && !event.altKey && key.length > 1) {
    parts.push('shift');
  }
  parts.push(key);

  const candidate = parts.join('+');
  return parseBinding(candidate) === null ? null : candidate;
}

const GROUPS = ['Navigation', 'Capture', 'System'] as const;

export function ShortcutSettings() {
  useDocumentTitle('Shortcuts');

  const { bindings, load, loaded, setBinding, reset, resetAll } = useShortcuts();
  const platform = detectPlatform();

  /** The action currently being recorded, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) {
      void load();
    }
  }, [loaded, load]);

  /**
   * Records the next keypress.
   *
   * Bound in the capture phase and stopped from propagating, because while recording,
   * a bare letter has to reach this field instead of running "new item" behind it.
   */
  useEffect(() => {
    if (editing === null) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      // Escape and Backspace mean "give up" rather than "bind the escape key".
      // Without an escape route, a mis-tap during recording is a dead end.
      if (event.key === 'Escape' || event.key === 'Backspace') {
        setEditing(null);
        setPending(null);
        setProblem(null);
        return;
      }

      const candidate = bindingFromEvent(event);
      if (candidate === null) {
        setProblem('Press a key, or a combination ending in one.');
        return;
      }

      setProblem(null);
      setPending(candidate);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [editing]);

  const save = async (actionId: string, candidate: string): Promise<void> => {
    const check = canSaveBinding(candidate, bindings, actionId, platform);
    if (!check.ok) {
      setProblem(check.reason);
      return;
    }

    if (!(await setBinding(actionId, candidate))) {
      setProblem('That shortcut is already in use.');
      return;
    }

    toast.success('Shortcut saved');
    setEditing(null);
    setPending(null);
    setProblem(null);
  };

  const conflicts = findConflicts(bindings, platform);

  return (
    <Page>
      <PageHeader
        title="Keyboard shortcuts"
        description="Press a combination to record it. Bare letters are ignored while you are typing in a field."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void resetAll();
              toast.success('Shortcuts reset to defaults');
            }}
          >
            Reset all
          </Button>
        }
      />

      {conflicts.length > 0 ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Conflicting shortcuts</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {conflicts.map((conflict) => (
              <p key={conflict.binding}>
                {conflict.binding} is claimed by {conflict.actionIds.join(' and ')}.
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {GROUPS.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {SHORTCUT_ACTIONS.filter((action) => action.group === group).map((action) => (
              <ShortcutRow
                key={action.id}
                action={action}
                binding={bindings[action.id] ?? action.defaultBinding}
                platform={platform}
                editing={editing === action.id}
                pending={editing === action.id ? pending : null}
                problem={editing === action.id ? problem : null}
                onEdit={() => {
                  setEditing(action.id);
                  setPending(null);
                  setProblem(null);
                }}
                onCancel={() => {
                  setEditing(null);
                  setPending(null);
                  setProblem(null);
                }}
                onSave={(candidate) => void save(action.id, candidate)}
                onReset={() => void reset(action.id)}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </Page>
  );
}

function ShortcutRow({
  action,
  binding,
  platform,
  editing,
  pending,
  problem,
  onEdit,
  onCancel,
  onSave,
  onReset,
}: {
  action: ShortcutAction;
  binding: string;
  platform: Platform;
  editing: boolean;
  pending: string | null;
  problem: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (candidate: string) => void;
  onReset: () => void;
}) {
  const changed = binding !== action.defaultBinding;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-2">
      <div className="min-w-0">
        <p className="text-sm">{action.label}</p>
        <p className="truncate text-xs text-muted-foreground">{action.description}</p>
        <FieldError>{editing ? problem : undefined}</FieldError>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {editing ? (
          <>
            <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs">
              {pending === null ? 'Press keys…' : (formatBinding(pending, platform) ?? pending)}
            </kbd>
            <Button size="sm" disabled={pending === null} onClick={() => onSave(pending as string)}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Badge variant={changed ? 'default' : 'secondary'} className="font-mono">
              {formatBinding(binding, platform) ?? 'unusable'}
            </Badge>
            <Button size="sm" variant="outline" onClick={onEdit}>
              Change
            </Button>
            {changed ? (
              <Button size="sm" variant="ghost" onClick={onReset}>
                Reset
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
