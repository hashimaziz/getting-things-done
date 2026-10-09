/**
 * Navigation structure.
 *
 * The labels and order mirror core's `CONTAINER_SPECS`, but are declared here
 * instead of imported: core is Node-targeted and pulling it into the browser
 * bundle would drag `date-fns` and `rrule` in with it, for a list of strings. The
 * cost of that split is drift, so there is a test asserting this covers every
 * container core defines, which fails loudly if a container is added and this
 * file is not updated.
 */

import type { ContainerSpec } from './types';

export interface NavItem {
  /** The path this item navigates to. */
  to: string;
  label: string;
  /** Shown as a hint on the right of the row. */
  hint?: string;
  /** Lucide icon name, resolved by the sidebar. */
  icon: string;
  /**
   * Require an exact path match for the active state.
   *
   * Needed where one destination is a prefix of another: `/settings` is the parent
   * of `/settings/categories`, and without this both rows highlight at once. Only
   * the prefixing destination needs it, and only it may set it.
   */
  endMatch?: boolean;
  /** Present on the items that need the most attention first. */
  emphasis?: 'primary' | 'secondary';
}

export interface NavSection {
  id: string;
  label: string | null;
  items: NavItem[];
}

/**
 * The working lists, in Allen's order: what is unprocessed, what is actionable now,
 * what is fixed in time, what is not yours to do, and last the two places where
 * nothing is due. Someday and reference are not action containers, and the
 * distinction matters: a someday item is a decision already made, while a next
 * action is a decision still to be made each time you look at it.
 */
export const CONTAINER_NAV: ContainerSpec[] = [
  {
    container: 'inbox',
    label: 'Inbox',
    description: 'Captured, not yet clarified.',
    isActionContainer: false,
    isTransient: true,
    reviewCadence: 'daily',
  },
  {
    container: 'next_action',
    label: 'Next Actions',
    description: 'What to do as soon as possible.',
    isActionContainer: true,
    isTransient: false,
    reviewCadence: 'daily',
  },
  {
    container: 'calendar',
    label: 'Calendar',
    description: 'Hard commitments bound to a date and time.',
    isActionContainer: true,
    isTransient: false,
    reviewCadence: 'daily',
  },
  {
    container: 'waiting',
    label: 'Waiting For',
    description: 'Delegated, with a date to follow up.',
    isActionContainer: true,
    isTransient: false,
    reviewCadence: 'weekly',
  },
  {
    container: 'someday',
    label: 'Someday / Maybe',
    description: 'Genuinely worth doing, but not now.',
    isActionContainer: false,
    isTransient: false,
    reviewCadence: 'monthly',
  },
  {
    container: 'reference',
    label: 'Reference',
    description: 'Material to consult, with nothing to do.',
    isActionContainer: false,
    isTransient: false,
    reviewCadence: 'rarely',
  },
];

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'engage',
    label: null,
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', emphasis: 'secondary' },
      { to: '/capture', label: 'Capture', icon: 'Inbox', hint: 'C', emphasis: 'secondary' },
      { to: '/clarify', label: 'Clarify', icon: 'ListChecks', emphasis: 'secondary' },
      ...CONTAINER_NAV.map<NavItem>((spec) => ({
        to: `/list/${spec.container}`,
        label: spec.label,
        icon: spec.container,
        ...(spec.isActionContainer ? { emphasis: 'primary' as const } : {}),
      })),
    ],
  },
  {
    id: 'reflect',
    label: 'Reflect',
    items: [
      {
        to: '/review',
        label: 'Weekly Review',
        icon: 'ClipboardCheck',
        hint: 'R',
        emphasis: 'secondary',
      },
      { to: '/archive', label: 'Archive', icon: 'Archive' },
      { to: '/list/trash', label: 'Trash', icon: 'Trash2' },
      { to: '/projects', label: 'Projects', icon: 'FolderKanban' },
    ],
  },
  {
    id: 'administer',
    label: 'Administer',
    items: [
      { to: '/settings/categories', label: 'Categories', icon: 'Shapes' },
      { to: '/settings/fields', label: 'Fields', icon: 'SlidersHorizontal' },
      { to: '/settings/reference', label: 'Reference Data', icon: 'Contact' },
      { to: '/settings/templates', label: 'Checklist Templates', icon: 'ListChecks' },
      { to: '/settings/dashboards', label: 'Dashboards', icon: 'PanelsTopLeft' },
      { to: '/settings/shortcuts', label: 'Shortcuts', icon: 'Keyboard' },
      { to: '/settings', label: 'Settings', icon: 'Settings', endMatch: true },
    ],
  },
];

/** Flattened, used by the command palette so it can search every destination. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/**
 * Containers with no navigation row of their own, and where they are handled
 * instead.
 *
 * `done` is deliberately absent: completed items are browsed in the archive, which
 * has its own facets, activity feed and daily counts. Giving it a plain list would
 * be a worse version of the same data.
 */
export const CONTAINERS_WITHOUT_NAV: Record<string, string> = {
  done: '/archive',
};

/** Every container core defines, mapped to the route that lists it. */
export function routeForContainer(container: string): string {
  if (CONTAINERS_WITHOUT_NAV[container] !== undefined) {
    return CONTAINERS_WITHOUT_NAV[container];
  }
  return `/list/${container}`;
}

/** The label core uses for a container, falling back to the raw name. */
export function containerLabel(container: string): string {
  return CONTAINER_NAV.find((spec) => spec.container === container)?.label ?? container;
}

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => pathname.startsWith(item.to));
}
