/**
 * The application shell.
 *
 * A sidebar of containers, a content area, and nothing else. Everything else is a
 * route: the shell deliberately has no global "current item" state, because a
 * modal editor that outlives navigation is how you end up editing the wrong item.
 */

import { useDocumentTitle } from '@/lib/document-title';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { findNavItem } from '@/lib/navigation';
import { useMediaQuery, WIDE_SCREEN_QUERY } from '@/lib/media-query';
import { CommandPalette, useCommandPalette } from '@/components/command-palette';
import { useLoadShortcuts, useShellShortcuts } from '@/components/use-shell-shortcuts';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

/** Watches navigation to keep the document title in step with the route. */
function RouteTitle() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  useDocumentTitle(item?.label);
  return null;
}

export function AppShell() {
  /*
   * Two sidebars, not one that resizes.
   *
   * Wide: a permanent column, no toggle, because navigation that has to be summoned
   * on a screen with room for it is worse than useless. Narrow: a drawer over the
   * content, with a scrim, Escape, and closing on navigation.
   *
   * The earlier version hid the sidebar behind the toggle at every width, so a desktop
   * user lost navigation entirely and could only get it back through the one control
   * the open sidebar covered.
   */
  const isWide = useMediaQuery(WIDE_SCREEN_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = (): void => setDrawerOpen(false);
  const palette = useCommandPalette();

  /*
   * Escape closes the drawer.
   *
   * A drawer that can only be dismissed by clicking the one control it covers is a
   * trap: the toggle sits in the top bar, and the open sidebar is painted over it at
   * a higher layer, so the way out is under the thing you opened. Escape is what
   * people reach for, and it costs one listener.
   *
   * Registered only while it is open, so the shell has no global key handler of its
   * own for the other 99% of the time.
   */
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  /*
   * Widening the window while the drawer is open would leave it open over the layout
   * that has a permanent sidebar, so the same sidebar is drawn twice. Closing it on
   * the way across is the whole fix, and it is a state change rather than an effect
   * that reads and compares.
   */
  const [wasWide, setWasWide] = useState(isWide);
  if (isWide !== wasWide) {
    // Adjusted during render, which is React's supported way to react to a changed
    // input: the component re-renders before anything is committed, so no user ever
    // sees the double sidebar this exists to prevent.
    setWasWide(isWide);
    if (isWide) {
      setDrawerOpen(false);
    }
  }

  const bindings = useLoadShortcuts();
  useShellShortcuts(bindings, palette.toggle);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <RouteTitle />
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      {isWide ? <Sidebar /> : null}

      {/*
        A drawer, not a panel: painted over the content it stands in for and dismissed
        by the scrim, by Escape, by the toggle, or by following a link. The scrim is
        what makes "tap away to close" real — without it there is nowhere away to tap.
      */}
      {!isWide && drawerOpen ? (
        <>
          <div
            className="absolute inset-0 z-30 bg-foreground/20"
            onClick={closeDrawer}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 z-40 flex shadow-lg">
            <Sidebar onNavigate={closeDrawer} />
          </div>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onToggleSidebar={() => setDrawerOpen((open) => !open)}
          sidebarOpen={drawerOpen}
          sidebarToggleable={!isWide}
          onOpenPalette={palette.toggle}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Standard page padding and heading. Every screen uses it, so screens agree. */
export function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: React.ReactNode | undefined;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
