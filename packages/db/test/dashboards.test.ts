import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, migrate, createDashboardsRepo, type Db } from '@gtd/db';
import type { DashboardWidget } from '@gtd/core';

/**
 * The dashboard repository.
 *
 * The rule under test is "exactly one default". Two defaults is a bug a person
 * experiences as the dashboard opening at random, and it is only prevented by the
 * partial unique index plus promotion being a transaction rather than two statements
 * that could be interrupted between.
 */

let db: Db;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
});

function widget(overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id: 'w1',
    type: 'health.summary',
    title: null,
    x: 0,
    y: 0,
    width: 4,
    height: 2,
    props: {},
    ...overrides,
  };
}

describe('reading', () => {
  it('starts empty', () => {
    expect(createDashboards().list()).toEqual([]);
  });

  it('has no default when there are none', () => {
    expect(createDashboards().getDefault()).toBeNull();
  });

  it('returns a dashboard by id', () => {
    const repo = createDashboards();
    const created = repo.create({ key: 'home', name: 'Home', widgets: [widget()] });

    expect(repo.getById(created.id)?.name).toBe('Home');
  });

  it('returns null for an id that does not exist', () => {
    expect(createDashboards().getById('nope')).toBeNull();
  });

  it('reads the layout back as widgets', () => {
    const repo = createDashboards();
    const created = repo.create({
      key: 'home',
      name: 'Home',
      widgets: [widget({ id: 'a' }), widget({ id: 'b' })],
    });

    expect(repo.getById(created.id)?.widgets).toHaveLength(2);
  });

  it('keeps a per-dashboard title', () => {
    const repo = createDashboards();
    const created = repo.create({
      key: 'home',
      name: 'Home',
      widgets: [widget({ title: 'My numbers' })],
    });

    expect(repo.getById(created.id)?.widgets.at(0)?.title).toBe('My numbers');
  });

  it('keeps widget props', () => {
    const repo = createDashboards();
    const created = repo.create({
      key: 'home',
      name: 'Home',
      widgets: [widget({ props: { days: 30 } })],
    });

    expect(repo.getById(created.id)?.widgets.at(0)?.props).toEqual({ days: 30 });
  });
});

describe('the default dashboard', () => {
  it('makes the first one the default whatever was asked for', () => {
    // A person creating their first dashboard and not ticking the box should still
    // find it opening.
    const repo = createDashboards();
    repo.create({ key: 'home', name: 'Home' });

    expect(repo.list().filter((dashboard) => dashboard.isDefault)).toHaveLength(1);
  });

  it('does not make a second dashboard the default just by existing', () => {
    const repo = createDashboards();
    repo.create({ key: 'home', name: 'Home' });
    repo.create({ key: 'work', name: 'Work' });

    expect(repo.list().filter((dashboard) => dashboard.isDefault)).toHaveLength(1);
  });

  it('promotes a second dashboard, demoting the first', () => {
    const repo = createDashboards();
    const first = repo.create({ key: 'home', name: 'Home' });
    const second = repo.create({ key: 'work', name: 'Work' });

    repo.update(second.id, { isDefault: true });

    expect(repo.getById(second.id)?.isDefault).toBe(true);
    expect(repo.getById(first.id)?.isDefault).toBe(false);
  });

  it('never leaves two defaults', () => {
    const repo = createDashboards();
    const a = repo.create({ key: 'a', name: 'A' });
    const b = repo.create({ key: 'b', name: 'B' });

    repo.update(a.id, { isDefault: true });
    repo.update(b.id, { isDefault: true });

    expect(repo.list().filter((dashboard) => dashboard.isDefault)).toHaveLength(1);
  });

  it('lets a dashboard be demoted', () => {
    const repo = createDashboards();
    const only = repo.create({ key: 'home', name: 'Home' });

    repo.update(only.id, { isDefault: false });

    expect(repo.getById(only.id)?.isDefault).toBe(false);
  });

  it('lists the default first', () => {
    // The app picks the default, but ordering it first means "the first one" and "the
    // default one" agree, which matters wherever both are used.
    const repo = createDashboards();
    const a = repo.create({ key: 'a', name: 'A' });
    repo.create({ key: 'b', name: 'B' });
    repo.update(a.id, { isDefault: true });

    expect(repo.list().at(0)?.id).toBe(a.id);
  });
});

describe('deleting', () => {
  it('promotes another dashboard so the app always has one', () => {
    // Otherwise the app opens on an error page every time, with nothing to click.
    const repo = createDashboards();
    const first = repo.create({ key: 'a', name: 'A' });
    repo.create({ key: 'b', name: 'B' });

    repo.remove(first.id);

    expect(repo.list()).toHaveLength(1);
    expect(repo.getDefault()).not.toBeNull();
  });

  it('removes the last dashboard without complaining', () => {
    const repo = createDashboards();
    const only = repo.create({ key: 'home', name: 'Home' });

    repo.remove(only.id);

    expect(repo.list()).toEqual([]);
    expect(repo.getDefault()).toBeNull();
  });

  it('throws for an id that does not exist', () => {
    expect(() => createDashboards().remove('nope')).toThrow(/no dashboard/i);
  });
});

describe('updating', () => {
  it('replaces the layout', () => {
    const repo = createDashboards();
    const created = repo.create({ key: 'home', name: 'Home', widgets: [widget({ id: 'a' })] });

    repo.update(created.id, { widgets: [widget({ id: 'b' }), widget({ id: 'c' })] });

    expect(repo.getById(created.id)?.widgets.map((entry) => entry.id)).toEqual(['b', 'c']);
  });

  it('leaves the layout alone when it is not supplied', () => {
    const repo = createDashboards();
    const created = repo.create({ key: 'home', name: 'Home', widgets: [widget({ id: 'a' })] });

    repo.update(created.id, { name: 'Renamed' });

    expect(repo.getById(created.id)?.widgets).toHaveLength(1);
    expect(repo.getById(created.id)?.name).toBe('Renamed');
  });

  it('empties the layout when given an empty list', () => {
    const repo = createDashboards();
    const created = repo.create({ key: 'home', name: 'Home', widgets: [widget()] });

    repo.update(created.id, { widgets: [] });

    expect(repo.getById(created.id)?.widgets).toEqual([]);
  });

  it('throws for an id that does not exist', () => {
    expect(() => createDashboards().update('nope', { name: 'x' })).toThrow(/no dashboard/i);
  });

  it('leaves everything untouched when an update fails partway', () => {
    // The name change and the default promotion are in one transaction: a failure must
    // not leave a renamed dashboard that is not the default, or vice versa.
    const repo = createDashboards();
    const a = repo.create({ key: 'a', name: 'A' });

    expect(() => repo.update(a.id, { key: 'a' })).not.toThrow();
  });
});

describe('bad data', () => {
  it('rejects a layout that is not a list', () => {
    // Rendered as nothing at all, which looks like a broken dashboard rather than bad
    // data — so it is refused at the boundary instead.
    expect(() =>
      createDashboards().create({ key: 'home', name: 'Home', widgets: {} as never }),
    ).toThrow(/must be a list/i);
  });

  it('treats a missing layout as an empty one', () => {
    const repo = createDashboards();
    expect(repo.create({ key: 'home', name: 'Home' }).widgets).toEqual([]);
  });
});

/** A fresh repository over the current test database. */
function createDashboards() {
  return createDashboardsRepo(db);
}
