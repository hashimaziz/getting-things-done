/**
 * The sidebar.
 *
 * Container order is the working order, not an alphabetical one: inbox first
 * because it is the thing that rots, then next actions, then the calendar, then
 * waiting. Counts come from the health metrics rather than from four separate
 * count queries, because four counts that arrive at different times produce a
 * sidebar that briefly lies about how much work is waiting.
 */

import {
  Archive,
  ClipboardCheck,
  Contact,
  FolderKanban,
  Inbox,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  PanelsTopLeft,
  Trash2,
  Settings,
  Shapes,
  SlidersHorizontal,
  CalendarDays,
  Clock,
  Repeat,
  Star,
  ArchiveIcon,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router';
import { useHealth } from '@/lib/hooks';
import { NAV_SECTIONS } from '@/lib/navigation';
import { cn } from '@/lib/cn';

/**
 * Icons are mapped explicitly rather than looked up by string at runtime, so that
 * deleting a navigation entry breaks the build instead of shipping a blank row.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Inbox,
  Shapes,
  SlidersHorizontal,
  Contact,
  ListChecks,
  PanelsTopLeft,
  Trash2,
  Keyboard,
  Settings,
  ClipboardCheck,
  Archive,
  FolderKanban,
  next_action: Star,
  calendar: CalendarDays,
  waiting: Clock,
  someday: Repeat,
  reference: ArchiveIcon,
  trash: Trash2,
};

/**
 * @param onNavigate Called after a link is followed. On a narrow screen the sidebar
 * covers the content it navigates to, so leaving it open hides the screen the user
 * just asked for.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: health } = useHealth();

  const countFor = (container: string): number | null => {
    if (!health) {
      return null;
    }
    switch (container) {
      case 'inbox':
        return health.inboxBacklog;
      case 'waiting':
        return health.waiting;
      case 'someday':
        return health.someday;
      default:
        return null;
    }
  };

  return (
    <nav
      id="app-sidebar"
      aria-label="Main"
      className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r bg-card px-2 py-3"
    >
      <div className="px-2 pb-3 text-sm font-semibold tracking-tight">GTD</div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.id} className="mb-3">
          {section.label ? (
            <div className="px-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
          ) : null}

          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon];
              const count = countFor(item.icon);

              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.endMatch ?? false}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        isActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-foreground/80',
                        item.emphasis === 'primary' && 'font-medium text-foreground',
                      )
                    }
                  >
                    {Icon ? <Icon aria-hidden className="size-4 shrink-0 opacity-80" /> : null}
                    <span className="flex-1 truncate">{item.label}</span>
                    {count !== null && count > 0 ? (
                      <span className="rounded-full bg-muted px-1.5 text-[0.6875rem] tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
