import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  addWidget,
  defaultLayout,
  gridHeight,
  moveWidget,
  normaliseLayout,
  removeWidget,
  renameWidget,
  resizeWidget,
  widgetStyle,
  type GridLayout,
  type GridWidget,
} from './layout';
import { WIDGETS, findWidget, requiredSources, widgetTitle } from './registry';

/**
 * Grid layouts.
 *
 * A layout read from the database is edited into a valid grid before it renders, because
 * a layout that overlaps renders as a mess and a layout that is silently corrected
 * renders as the last good version of itself. The tests concentrate on the corrections:
 * the hand-edited row, the widget type from a newer build, and the two widgets claiming
 * the same cells.
 */

function widget(overrides: Record<string, unknown> = {}) {
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

/** Every cell any widget occupies, used to assert that nothing overlaps. */
function cellsOf(layout: GridLayout | GridWidget[]): string[] {
  const widgets = Array.isArray(layout) ? layout : layout.widgets;
  const cells: string[] = [];
  for (const entry of widgets) {
    for (let row = entry.y; row < entry.y + entry.height; row += 1) {
      for (let column = entry.x; column < entry.x + entry.width; column += 1) {
        cells.push(`${column},${row}`);
      }
    }
  }
  return cells;
}

describe('normalising', () => {
  it('accepts a valid layout unchanged', () => {
    const layout = normaliseLayout([
      widget({ id: 'a', x: 0, y: 0 }),
      widget({ id: 'b', x: 4, y: 0 }),
    ]);

    expect(layout.widgets.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('turns nonsense into an empty layout rather than crashing', () => {
    expect(normaliseLayout(null).widgets).toEqual([]);
    expect(normaliseLayout('nope').widgets).toEqual([]);
    expect(normaliseLayout([null, 3, 'x']).widgets).toEqual([]);
  });

  /*
   * A widget type this build does not know — a layout saved by a newer version, or a
   * typo — would render as a hole in the dashboard that cannot be removed, because the
   * remove button is the widget. Dropping it is the only recoverable option.
   */
  it('drops a widget type this build does not know', () => {
    const layout = normaliseLayout([widget({ type: 'a.widget.from.the.future' })]);

    expect(layout.widgets).toEqual([]);
  });

  it('clamps a widget that runs off the grid', () => {
    const layout = normaliseLayout([widget({ x: 20, width: 8 })]);

    expect(layout.widgets.at(0)?.x).toBeLessThanOrEqual(COLUMNS - 8);
  });

  it('clamps a widget with a nonsense size', () => {
    const layout = normaliseLayout([widget({ width: -4, height: 0 })]);

    expect(layout.widgets.at(0)?.width).toBeGreaterThanOrEqual(1);
    expect(layout.widgets.at(0)?.height).toBeGreaterThanOrEqual(1);
  });

  it('gives a widget with no id one', () => {
    const layout = normaliseLayout([{ type: 'health.summary', x: 0, y: 0, width: 2, height: 1 }]);

    expect(layout.widgets.at(0)?.id).toBeTruthy();
  });

  it('settles two widgets that claim the same cells', () => {
    const layout = normaliseLayout([
      widget({ id: 'a', x: 0, y: 0, width: 4, height: 2 }),
      widget({ id: 'b', x: 0, y: 0, width: 4, height: 2 }),
    ]);

    expect(new Set(cellsOf(layout)).size).toBe(cellsOf(layout).length);
  });

  it('produces the same result every time for the same input', () => {
    // Correcting a layout in iteration order rather than position order would make a
    // stored layout render differently from one render to the next.
    const input = [
      widget({ id: 'a', x: 0, y: 2 }),
      widget({ id: 'b', x: 0, y: 0 }),
      widget({ id: 'c', x: 0, y: 1 }),
    ];

    expect(normaliseLayout(input)).toEqual(normaliseLayout([...input].reverse()));
  });

  it('defaults props to an object', () => {
    const layout = normaliseLayout([widget({ props: undefined })]);

    expect(layout.widgets.at(0)?.props).toEqual({});
  });
});

describe('moving', () => {
  const layout = normaliseLayout([
    widget({ id: 'a', type: 'health.summary', x: 0, y: 0, width: 4, height: 2 }),
    widget({ id: 'b', type: 'inbox.backlog', x: 4, y: 0, width: 2, height: 1 }),
  ]);

  it('moves a widget to a free space', () => {
    const moved = moveWidget(layout, 'b', { x: 0, y: 2 });

    expect(moved.widgets.find((entry) => entry.id === 'b')?.x).toBe(0);
    expect(moved.applied).toBe(true);
  });

  /*
   * Pushing is what makes a grid feel like a grid. Refusing to drop a widget onto
   * occupied space means rearranging a dashboard is a puzzle; pushing means it is an
   * edit, and the person is mid-drag and can see where it landed.
   */
  it('keeps every widget after a move', () => {
    // The moved widget is taken out of the layout to be repositioned, so a careless
    // implementation returns the layout without it — which is how a dashboard loses a
    // widget the first time somebody drags it.
    const moved = moveWidget(layout, 'a', { x: 6, y: 0 });

    expect(moved.widgets.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('pushes the widget it lands on downward rather than refusing the move', () => {
    // Dropping "b" onto "a"'s space moves "a" out of the way. Refusing instead would
    // mean rearranging a dashboard is a puzzle rather than an edit.
    const moved = moveWidget(layout, 'b', { x: 0, y: 0 });

    expect(moved.widgets.find((entry) => entry.id === 'b')?.y).toBe(0);
    expect(moved.widgets.find((entry) => entry.id === 'a')?.y).toBeGreaterThan(0);
  });

  it('leaves no overlap after a move onto occupied space', () => {
    const moved = moveWidget(layout, 'b', { x: 0, y: 0 });
    const cells = cellsOf(moved.widgets);

    expect(new Set(cells).size).toBe(cells.length);
  });

  it('clamps a move past the right edge', () => {
    const moved = moveWidget(layout, 'a', { x: 99, y: 0 });

    expect(moved.widgets.find((entry) => entry.id === 'a')?.x).toBeLessThanOrEqual(COLUMNS - 4);
  });

  it('refuses a move of a widget that is not there', () => {
    const moved = moveWidget(layout, 'nope', { x: 0, y: 0 });

    expect(moved.applied).toBe(false);
    expect(moved.widgets).toBe(layout.widgets);
  });
});

describe('resizing', () => {
  const layout = normaliseLayout([widget({ id: 'a', x: 0, y: 0, width: 4, height: 2 })]);

  it('resizes', () => {
    const resized = resizeWidget(layout, 'a', { width: 8, height: 3 });

    expect(resized.widgets.at(0)).toMatchObject({ width: 8, height: 3 });
  });

  it('refuses a width of zero', () => {
    // A zero-width widget renders as nothing and cannot be selected to be fixed.
    const resized = resizeWidget(layout, 'a', { width: 0, height: 0 });

    expect(resized.widgets.at(0)?.width).toBeGreaterThanOrEqual(1);
    expect(resized.widgets.at(0)?.height).toBeGreaterThanOrEqual(1);
  });

  it('refuses a widget that does not exist', () => {
    expect(resizeWidget(layout, 'nope', { width: 2, height: 2 }).applied).toBe(false);
  });

  it('leaves no overlap after growing into a neighbour', () => {
    const two = normaliseLayout([
      widget({ id: 'a', x: 0, y: 0, width: 2, height: 2 }),
      widget({ id: 'b', type: 'overdue.count', x: 2, y: 0, width: 2, height: 2 }),
    ]);

    const grown = resizeWidget(two, 'a', { width: 6, height: 2 });
    const cells = cellsOf(grown.widgets);

    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('adding and removing', () => {
  it('adds a widget in free space', () => {
    const added = addWidget(
      normaliseLayout([widget({ id: 'a', x: 0, y: 0, width: 4, height: 2 })]),
      'inbox.backlog',
      'new',
    );

    expect(added.widgets.at(-1)?.id).toBe('new');
    expect(new Set(cellsOf(added)).size).toBe(cellsOf(added).length);
  });

  it('uses the default size of the widget type', () => {
    const added = addWidget(normaliseLayout([]), 'throughput.chart', 'new');

    expect(added.widgets.at(0)).toMatchObject({ width: 6, height: 3 });
  });

  it('removes a widget', () => {
    const removed = removeWidget(normaliseLayout([widget({ id: 'a' })]), 'a');

    expect(removed.widgets).toEqual([]);
  });

  it('ignores a removal of something that is not there', () => {
    const layout = normaliseLayout([widget({ id: 'a' })]);

    expect(removeWidget(layout, 'nope').widgets).toHaveLength(1);
  });
});

describe('renaming', () => {
  it('gives a widget a title of its own', () => {
    // The point of per-dashboard titles: the same widget is called "Overdue" on one
    // dashboard and "Late" on another, because the person arranged both.
    const renamed = renameWidget(
      normaliseLayout([widget({ id: 'a', type: 'overdue.count' })]),
      'a',
      'Late',
    );

    expect(widgetTitle(renamed.widgets[0] as { type: string; title: string | null })).toBe('Late');
  });

  it('clears a title back to the widget name', () => {
    const layout = normaliseLayout([widget({ id: 'a', type: 'overdue.count', title: 'Late' })]);
    const renamed = renameWidget(layout, 'a', '   ');

    expect(renamed.widgets.at(0)?.title).toBeNull();
    expect(widgetTitle(renamed.widgets[0] as { type: string; title: string | null })).toBe(
      'Overdue',
    );
  });

  it('ignores a rename of a widget that is not there', () => {
    const layout = normaliseLayout([widget({ id: 'a' })]);

    expect(renameWidget(layout, 'nope', 'x').widgets).toHaveLength(1);
  });
});

describe('titles', () => {
  it('uses a per-dashboard title when there is one', () => {
    expect(widgetTitle({ type: 'health.summary', title: 'My numbers' })).toBe('My numbers');
  });

  it('falls back to the widget name for an empty title', () => {
    // A blank header looks like a rendering bug rather than a person having cleared it.
    expect(widgetTitle({ type: 'health.summary', title: '   ' })).toBe('System health');
  });

  it('falls back for a null title', () => {
    expect(widgetTitle({ type: 'health.summary', title: null })).toBe('System health');
  });

  it('falls back for a type it does not know', () => {
    expect(widgetTitle({ type: 'mystery', title: null })).toBe('mystery');
  });
});

describe('the default layout', () => {
  it('starts with the inbox and what is late', () => {
    // A new dashboard that opens on a chart answers a question nobody asked yet.
    const types = defaultLayout().widgets.map((entry) => entry.type);

    expect(types[0]).toBe('health.summary');
    expect(types).toContain('inbox.backlog');
    expect(types).toContain('overdue.count');
  });

  it('has no overlapping widgets', () => {
    const cells = cellsOf(defaultLayout());

    expect(new Set(cells).size).toBe(cells.length);
  });

  it('normalises to itself', () => {
    expect(normaliseLayout(defaultLayout().widgets)).toEqual(defaultLayout());
  });
});

describe('fetching only what is on screen', () => {
  it('collects the sources the widgets need', () => {
    const sources = requiredSources([{ type: 'inbox.backlog' }, { type: 'throughput.chart' }]);

    expect(sources).toContain('health');
    expect(sources).toContain('throughput');
  });

  it('deduplicates a source two widgets share', () => {
    // Ten widgets wanting health make one request, not ten.
    const sources = requiredSources([{ type: 'health.summary' }, { type: 'inbox.backlog' }]);

    expect(sources.filter((source) => source === 'health')).toHaveLength(1);
  });

  it('is empty for widgets that need nothing', () => {
    expect(requiredSources([{ type: 'quote.method' }])).toEqual([]);
  });

  it('ignores a widget type it does not know', () => {
    expect(requiredSources([{ type: 'from.the.future' }])).toEqual([]);
  });
});

describe('the registry', () => {
  it('gives every widget a type and a title', () => {
    for (const widget of WIDGETS) {
      expect(widget.type, widget.type).toBeTruthy();
      expect(widget.title.length, widget.type).toBeGreaterThan(0);
    }
  });

  it('has no duplicate types', () => {
    const types = WIDGETS.map((widget) => widget.type);

    expect(new Set(types).size).toBe(types.length);
  });

  it('gives every widget a default size that fits the grid', () => {
    for (const widget of WIDGETS) {
      expect(widget.defaultSize.width, widget.type).toBeLessThanOrEqual(COLUMNS);
      expect(widget.defaultSize.height, widget.type).toBeGreaterThanOrEqual(1);
    }
  });

  it('finds a widget by type', () => {
    expect(findWidget('inbox.backlog')?.title).toBe('Inbox backlog');
    expect(findWidget('nope')).toBeUndefined();
  });
});

describe('grid height and style', () => {
  it('measures the tallest widget', () => {
    const layout = normaliseLayout([
      widget({ id: 'a', y: 0, height: 2 }),
      widget({ id: 'b', type: 'overdue.count', x: 0, y: 4, height: 3 }),
    ]);

    expect(gridHeight(layout)).toBe(7);
  });

  it('is at least one row for an empty layout', () => {
    expect(gridHeight({ widgets: [] })).toBe(1);
  });

  it('converts a position into CSS grid coordinates', () => {
    // One-based, because CSS grid columns start at 1 and an off-by-one here shifts every
    // widget by a whole column.
    expect(
      widgetStyle({ id: 'a', type: 'x', title: null, x: 0, y: 0, width: 4, height: 2, props: {} }),
    ).toEqual({
      gridColumn: '1 / span 4',
      gridRow: '1 / span 2',
    });
  });
});
