import { describe, expect, it } from 'vitest';
import { CONTAINERS } from '@gtd/core';
import { ALL_NAV_ITEMS, NAV_SECTIONS, findNavItem, routeForContainer } from './navigation';

describe('navigation coverage', () => {
  /*
   * This test is the whole reason the web package re-declares core's container
   * list instead of importing it. It cannot import it: core is Node-targeted, and
   * the browser bundle must not pull in `rrule` and `date-fns` for an array of
   * strings. So the two lists can drift, and this fails the moment a container is
   * added to core and forgotten here.
   */
  const navigableContainers = new Set(
    ALL_NAV_ITEMS.filter((item) => item.to.startsWith('/list/')).map((item) =>
      item.to.slice('/list/'.length),
    ),
  );

  it('covers every container core defines', () => {
    // `done` is the one container without a /list route: completed items are
    // browsed in the archive, which has facets, an activity feed and daily counts
    // that a plain list does not have.
    const expected = CONTAINERS.filter((container) => container !== 'done');
    expect([...navigableContainers].sort()).toEqual([...expected].sort());
  });

  it('routes nowhere that core does not define', () => {
    for (const container of navigableContainers) {
      expect(CONTAINERS).toContain(container);
    }
  });

  it('routes every container somewhere, including the ones without a nav row', () => {
    // The sidebar is not the only way to reach a container. Anything that links
    // directly, such as a dashboard tile counting overdue items, must have a route
    // to send the user to.
    for (const container of CONTAINERS) {
      expect(routeForContainer(container)).toMatch(/^\//);
    }
    expect(routeForContainer('inbox')).toBe('/list/inbox');
    expect(routeForContainer('done')).toBe('/archive');
  });

  it('routes a container it does not know to a plain list, not to a wrong page', () => {
    // A typo in a container name should produce a 404 from the server rather than
    // silently opening the inbox, which is how a data bug becomes a data loss.
    expect(routeForContainer('nonsense')).toBe('/list/nonsense');
  });

  it('links to inbox, next actions, calendar and waiting in that order', () => {
    const paths = ALL_NAV_ITEMS.map((item) => item.to);
    expect(paths.indexOf('/list/inbox')).toBeLessThan(paths.indexOf('/list/next_action'));
    expect(paths.indexOf('/list/next_action')).toBeLessThan(paths.indexOf('/list/calendar'));
    expect(paths.indexOf('/list/calendar')).toBeLessThan(paths.indexOf('/list/waiting'));
  });
});

describe('navigation structure', () => {
  it('has no duplicate destinations', () => {
    const paths = ALL_NAV_ITEMS.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('marks every prefixing destination as requiring an exact match', () => {
    // `/settings` and `/settings/fields` both highlighted at once is a bug a user
    // sees as two active rows. The prefixing row has to opt out of prefix
    // matching, and it is the only thing allowed to.
    for (const item of ALL_NAV_ITEMS) {
      const hasChildren = ALL_NAV_ITEMS.some(
        (other) => other.to !== item.to && other.to.startsWith(`${item.to}/`),
      );
      expect({ path: item.to, hasChildren, endMatch: item.endMatch ?? false }).toEqual({
        path: item.to,
        hasChildren,
        endMatch: hasChildren,
      });
    }
  });

  it('gives every section a unique id', () => {
    const ids = NAV_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no empty section', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });
});

describe('findNavItem', () => {
  it('matches a nested path to its section', () => {
    expect(findNavItem('/list/inbox')?.label).toBe('Inbox');
  });

  it('returns undefined for an unknown path', () => {
    expect(findNavItem('/nowhere')).toBeUndefined();
  });
});
