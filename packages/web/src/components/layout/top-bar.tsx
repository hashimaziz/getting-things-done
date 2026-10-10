/**
 * The top bar.
 *
 * Deliberately thin. It holds the theme toggle and the keyboard-shortcut hints. A
 * search box goes in here in a later commit, once the command palette exists, so
 * that there is one search entry point rather than a top-bar search that jumps
 * somewhere and a palette that does something else.
 */

import { Moon, PanelLeft, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui';
import { useHealth } from '@/lib/hooks';
import { useTheme } from '@/lib/theme-provider';
import { cn } from '@/lib/cn';
import { detectPlatform, formatBinding, DEFAULT_BINDINGS } from '@/shortcuts/registry';

export function TopBar({
  onToggleSidebar,
  sidebarOpen,
  sidebarToggleable,
  onOpenPalette,
}: {
  onToggleSidebar: () => void;
  /** Whether the drawer is open, so the button can say so and the drawer can be found. */
  sidebarOpen: boolean;
  /** False on a wide screen, where the sidebar is permanent and there is nothing to open. */
  sidebarToggleable: boolean;
  onOpenPalette: () => void;
}) {
  const { theme, toggle } = useTheme();
  const { data: health } = useHealth();

  // Computed from the same parser the handler uses, so the key shown here is the
  // key that will actually work.
  const paletteHint =
    formatBinding(DEFAULT_BINDINGS.commandPalette ?? 'mod+k', detectPlatform()) ?? 'mod+k';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      {/*
        `aria-expanded` and `aria-controls` rather than a label that swaps between
        "Show" and "Hide": the control is one button that does both, and saying which
        one it currently is what a screen reader user needs to decide whether to press
        it.
      */}
      {sidebarToggleable ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
        >
          <PanelLeft />
        </Button>
      ) : null}

      {/*
        Overdue is the one number worth surfacing globally. It is the only state that
        means something is already wrong, and burying it inside a list is how it
        stays there.
      */}
      {health && health.overdue > 0 ? (
        <span className="container-chip bg-destructive/10 text-destructive">
          {health.overdue} overdue
        </span>
      ) : null}

      <div className="flex-1" />

      <Button variant="outline" size="sm" onClick={onOpenPalette} className="gap-2">
        <Search />
        <span className="hidden sm:inline">Search</span>
        <kbd
          className={cn(
            'ml-2 rounded border bg-muted px-1 font-mono text-[0.625rem]',
            'text-muted-foreground',
          )}
        >
          {paletteHint}
        </kbd>
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggle}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </header>
  );
}
