/**
 * The application shell.
 *
 * A sidebar of containers, a content area, and nothing else. Everything else is a
 * route: the shell deliberately has no global "current item" state, because a
 * modal editor that outlives navigation is how you end up editing the wrong item.
 */

import { useDocumentTitle } from '@/lib/document-title';
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { findNavItem } from '@/lib/navigation';
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
  // Mobile: the sidebar is hidden behind a toggle. Desktop it is always present.
  // This is state in the shell rather than a media query in CSS because the toggle
  // button lives in the top bar and has to know whether it is closing an open
  // sidebar.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const palette = useCommandPalette();

  const bindings = useLoadShortcuts();
  useShellShortcuts(bindings, palette.toggle);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <RouteTitle />
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      <div className={sidebarOpen ? 'absolute inset-y-0 left-0 z-30' : 'hidden'}>
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
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
  description?: string;
  actions?: React.ReactNode;
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
