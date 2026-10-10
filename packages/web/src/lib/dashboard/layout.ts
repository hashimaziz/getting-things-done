/**
 * Dashboard layouts.
 *
 * A grid of fixed cells rather than free-form pixels. Sizing by pixels means every
 * widget needs its own responsive rules, every layout breaks at one window width, and
 * two dashboards that look the same stop matching. Cells make "half width" a value
 * instead of a rendering decision, and make a layout mean the same thing on a laptop
 * and a large monitor.
 *
 * Layouts are normalised on the way in and out. A layout read from the database is
 * edited into a valid grid before it is rendered and edited back into a canonical form
 * before it is saved, so a layout saved by an older version, or by hand, cannot wedge
 * the dashboard.
 */

import { findWidget, type WidgetDefinition } from './registry';

export const COLUMNS = 12;
export const ROW_HEIGHT = 72;

/** The smallest a widget can be. Below this, nothing inside it is readable. */
export const MIN_SIZE = { width: 1, height: 1 };
export const MAX_SIZE = { width: COLUMNS, height: 12 };

export interface GridWidget {
  id: string;
  type: string;
  /** Per-dashboard override of the widget's own title. */
  title: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, unknown>;
}

export interface GridLayout {
  widgets: GridWidget[];
}

/** Clamps a number into a range, tolerating nonsense from a hand-edited database. */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function defaultSizeFor(type: string): { width: number; height: number } {
  const definition: WidgetDefinition | undefined = findWidget(type);
  return definition?.defaultSize ?? { width: 2, height: 1 };
}

/**
 * Brings a stored layout into a renderable one.
 *
 * Every field is clamped, unknown widget types are dropped, and positions are settled so
 * two widgets can never claim the same cell. A layout that overlaps renders as a mess;
 * a layout that is silently corrected renders as the last good version of itself.
 */
export function normaliseLayout(raw: unknown): GridLayout {
  const widgets: GridWidget[] = [];
  const occupied = new Set<string>();

  const source = Array.isArray(raw) ? raw : [];
  // Sorted by position so correction is deterministic: the same stored layout always
  // produces the same arrangement, rather than depending on iteration order.
  const entries = [...source].sort(
    (a, b) => (a?.y ?? 0) - (b?.y ?? 0) || (a?.x ?? 0) - (b?.x ?? 0),
  );

  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Partial<GridWidget>;
    const type = typeof candidate.type === 'string' ? candidate.type : '';

    // A widget type this build does not know — a layout saved by a newer version, or a
    // typo — is dropped rather than rendered as an empty hole that cannot be removed.
    if (findWidget(type) === undefined) {
      continue;
    }

    const fallback = defaultSizeFor(type);
    const width = clamp(
      candidate.width,
      MIN_SIZE.width,
      Math.min(MAX_SIZE.width, COLUMNS),
      fallback.width,
    );
    const height = clamp(candidate.height, MIN_SIZE.height, MAX_SIZE.height, fallback.height);
    const wantedX = clamp(candidate.x, 0, Math.max(0, COLUMNS - width), 0);
    const wantedY = clamp(candidate.y, 0, 1_000, index);

    const { x, y } = firstFreeSpot(occupied, wantedX, wantedY, width, height);
    occupy(occupied, x, y, width, height);

    widgets.push({
      id: typeof candidate.id === 'string' && candidate.id !== '' ? candidate.id : `w${index}`,
      type,
      title: typeof candidate.title === 'string' ? candidate.title : null,
      x,
      y,
      width,
      height,
      props:
        typeof candidate.props === 'object' && candidate.props !== null
          ? (candidate.props as Record<string, unknown>)
          : {},
    });
  }

  return { widgets };
}

function cellsFor(x: number, y: number, width: number, height: number): string[] {
  const cells: string[] = [];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      cells.push(`${column},${row}`);
    }
  }
  return cells;
}

function occupy(occupied: Set<string>, x: number, y: number, width: number, height: number): void {
  for (const cell of cellsFor(x, y, width, height)) {
    occupied.add(cell);
  }
}

function isFree(
  occupied: Set<string>,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return cellsFor(x, y, width, height).every((cell) => !occupied.has(cell));
}

/**
 * The first free spot at or after a requested position, searching right then down.
 *
 * A widget dragged onto occupied space is placed nearby rather than refused: the person
 * is mid-drag and will see where it landed. Silently dropping the move would leave them
 * dragging a widget that is not there.
 */
export function firstFreeSpot(
  occupied: Set<string>,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  for (let candidateY = y; candidateY < y + 200; candidateY += 1) {
    for (let candidateX = 0; candidateX <= COLUMNS - width; candidateX += 1) {
      if (isFree(occupied, candidateX, candidateY, width, height)) {
        return { x: candidateX, y: candidateY };
      }
    }
  }
  // The grid is full at this size. Returned as asked; the caller shows the result and
  // the next widget goes below it.
  return { x, y };
}

export interface MoveResult {
  widgets: GridWidget[];
  /** False when the move was refused, so the caller can put the widget back. */
  applied: boolean;
}

/**
 * Moves a widget, pushing overlapping widgets down rather than refusing the move.
 *
 * Pushing is the behaviour that makes a grid feel like a grid. Refusing to drop a widget
 * onto occupied space means rearranging a dashboard is a puzzle; pushing means it is an
 * edit. Refused only when the widget would fall entirely outside the grid, which is a
 * drag that went wrong rather than a legitimate placement.
 */
export function moveWidget(
  layout: GridLayout,
  id: string,
  target: { x: number; y: number },
): MoveResult {
  const moving = layout.widgets.find((widget) => widget.id === id);
  if (!moving) {
    return { widgets: layout.widgets, applied: false };
  }

  const x = clamp(target.x, 0, Math.max(0, COLUMNS - moving.width), moving.x);
  const y = clamp(target.y, 0, 1_000, moving.y);

  const others = layout.widgets.filter((widget) => widget.id !== id);
  const moved: GridWidget = { ...moving, x, y };

  return { widgets: pushDown(others, moved), applied: true };
}

export function resizeWidget(
  layout: GridLayout,
  id: string,
  size: { width: number; height: number },
): MoveResult {
  const target = layout.widgets.find((widget) => widget.id === id);
  if (!target) {
    return { widgets: layout.widgets, applied: false };
  }

  const width = clamp(size.width, MIN_SIZE.width, Math.min(MAX_SIZE.width, COLUMNS), target.width);
  const height = clamp(size.height, MIN_SIZE.height, MAX_SIZE.height, target.height);

  const resized: GridWidget = { ...target, width, height };
  return {
    widgets: pushDown(
      layout.widgets.filter((widget) => widget.id !== id),
      resized,
    ),
    applied: true,
  };
}

/**
 * Returns `others` with anything overlapping `settled` pushed down, including the
 * settled widget itself.
 *
 * The settled widget is part of the result rather than assumed to still be in place,
 * because the caller has just taken it *out* of `others` to move it. Returning only the
 * pushed widgets would return a layout with the moved widget missing — which is what it
 * did, and what the first version of the test caught.
 *
 * One pass, repeatedly, because moving one widget down can put it on top of another
 * that has already been settled. The loop terminates because every move increases `y`,
 * and `y` is bounded.
 */
export function pushDown(others: GridWidget[], settled: GridWidget): GridWidget[] {
  /*
   * Copied element by element, not just as an array.
   *
   * `[...others]` copies the list and keeps the same objects, so the `widget.y += 1`
   * below rewrote the caller's widgets in place. That was survivable while this ran
   * only when somebody clicked something: React compared the same object references,
   * saw no change, and never re-rendered.
   *
   * It stopped being survivable when the arrange screen started calling it *during
   * render*, to decide which arrow buttons to disable. Every render rewrote the
   * layout it was reading, so the arrows moved widgets nobody had pressed and the
   * grid drifted apart on its own.
   */
  const widgets = others.map((widget) => ({ ...widget }));
  const occupied = new Set<string>();
  occupy(occupied, settled.x, settled.y, settled.width, settled.height);

  let moved = true;
  while (moved) {
    moved = false;
    for (const widget of widgets) {
      if (
        !overlaps(widget, settled) &&
        !widgets.some((other) => other.id !== widget.id && overlaps(widget, other))
      ) {
        continue;
      }
      if (!overlapsAny(widget, occupied)) {
        continue;
      }
      widget.y += 1;
      occupy(occupied, widget.x, widget.y, widget.width, widget.height);
      moved = true;
    }
  }

  // The settled widget first, so a layout read back keeps its original order rather
  // than putting the widget that was just dragged to the end.
  return [settled, ...widgets];
}

function overlaps(a: GridWidget, b: GridWidget): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function overlapsAny(widget: GridWidget, occupied: Set<string>): boolean {
  return cellsFor(widget.x, widget.y, widget.width, widget.height).some((cell) =>
    occupied.has(cell),
  );
}

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Moves a widget one cell, swapping with whatever is there.
 *
 * Different from {@link moveWidget} on purpose, and the difference is the whole reason
 * the arrow buttons felt broken. A drag is a placement and pushing neighbours down is the
 * right answer: the person can see where it is going. An arrow press is a nudge — "put
 * it over there" — and pushing instead makes every press shove a neighbour onto the row
 * below and leave a hole behind, so pressing the arrow five times moves one widget one
 * cell and rearranges half the dashboard.
 *
 * So an arrow swaps when the target cell is taken, and moves when it is not. Nothing is
 * ever displaced by a press of an arrow, which is what makes repeated presses land where
 * the person expects.
 */
export function moveWidgetBy(layout: GridLayout, id: string, direction: MoveDirection): MoveResult {
  const moving = layout.widgets.find((widget) => widget.id === id);
  if (!moving) {
    return { widgets: layout.widgets, applied: false };
  }

  /*
   * The cell just past the edge this widget is moving toward, which is the cell the
   * person is pointing at. Using the top-left corner instead meant a widget two cells
   * wide nudged into a cell it already covered, found no neighbour, and overlapped
   * the one it was supposed to have swapped with.
   */
  const target = {
    left: { x: moving.x - 1, y: moving.y },
    right: { x: moving.x + moving.width, y: moving.y },
    up: { x: moving.x, y: moving.y - 1 },
    down: { x: moving.x, y: moving.y + moving.height },
  }[direction];

  if (target.x < 0 || target.y < 0) {
    // Against the edge of the grid. Refused rather than clamped, so the button can be
    // disabled instead of appearing to do nothing when it is pressed.
    return { widgets: layout.widgets, applied: false };
  }

  const neighbour = layout.widgets.find(
    (widget) => widget.id !== id && covers(widget, target.x, target.y),
  );

  if (!neighbour) {
    const nudged = {
      ...moving,
      x: Math.min(
        moving.x + (direction === 'left' ? -1 : direction === 'right' ? 1 : 0),
        COLUMNS - moving.width,
      ),
      y: Math.max(0, moving.y + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0)),
    };
    if (nudged.x === moving.x && nudged.y === moving.y) {
      return { widgets: layout.widgets, applied: false };
    }
    return { widgets: settle(layout.widgets, nudged), applied: true };
  }

  /*
   * A swap moves each widget along the axis being nudged and leaves the other
   * coordinate alone, so two widgets of different heights still exchange places rather
   * than being resized into each other.
   */
  const horizontal = direction === 'left' || direction === 'right';
  const placed: GridWidget = {
    ...moving,
    ...(horizontal ? { x: neighbour.x } : { y: neighbour.y }),
  };
  const displaced: GridWidget = {
    ...neighbour,
    ...(horizontal ? { x: moving.x } : { y: moving.y }),
  };

  const exchanged = layout.widgets.map((widget) => {
    if (widget.id === placed.id) return placed;
    if (widget.id === displaced.id) return displaced;
    return widget;
  });

  return { widgets: settle(exchanged, placed), applied: true };
}

/**
 * Guarantees nothing overlaps, with `focus` kept where it was just put.
 *
 * A swap can land two differently-sized widgets on the same cells, and the one that
 * was moved is the one the person meant to be there. So it stays, and anything it now
 * sits on is pushed down.
 */
function settle(widgets: GridWidget[], focus: GridWidget): GridWidget[] {
  return pushDown(
    widgets.filter((widget) => widget.id !== focus.id),
    focus,
  ).map((widget) => (widget.id === focus.id ? focus : widget));
}

/** Whether a widget covers the given cell. */
function covers(widget: GridWidget, x: number, y: number): boolean {
  return (
    x >= widget.x && x < widget.x + widget.width && y >= widget.y && y < widget.y + widget.height
  );
}

export function removeWidget(layout: GridLayout, id: string): GridLayout {
  return { widgets: layout.widgets.filter((widget) => widget.id !== id) };
}

export function addWidget(layout: GridLayout, type: string, id: string): GridLayout {
  const size = defaultSizeFor(type);
  const occupied = new Set<string>();
  for (const widget of layout.widgets) {
    occupy(occupied, widget.x, widget.y, widget.width, widget.height);
  }

  const { x, y } = firstFreeSpot(occupied, 0, 0, size.width, size.height);

  return {
    widgets: [...layout.widgets, { id, type, title: null, x, y, ...size, props: {} }],
  };
}

export function renameWidget(layout: GridLayout, id: string, title: string | null): GridLayout {
  return {
    widgets: layout.widgets.map((widget) =>
      widget.id === id ? { ...widget, title: title?.trim() === '' ? null : title } : widget,
    ),
  };
}

/** The height of the grid, in rows. */
export function gridHeight(layout: GridLayout): number {
  return layout.widgets.reduce((tallest, widget) => Math.max(tallest, widget.y + widget.height), 1);
}

/**
 * The layout a brand-new dashboard starts with.
 *
 * Ordered by how much a person needs it when they first arrive: what is unprocessed,
 * what is late, then what they might do next. A new dashboard that opens on a chart is a
 * dashboard that answers a question nobody asked yet.
 */
export function defaultLayout(): GridLayout {
  return normaliseLayout([
    { id: 'health', type: 'health.summary', x: 0, y: 0, width: 4, height: 2 },
    { id: 'inbox', type: 'inbox.backlog', x: 4, y: 0, width: 2, height: 1 },
    { id: 'overdue', type: 'overdue.count', x: 6, y: 0, width: 2, height: 1 },
    { id: 'waiting', type: 'waiting.count', x: 8, y: 0, width: 2, height: 1 },
    { id: 'next', type: 'recommendations.next', x: 10, y: 0, width: 2, height: 2 },
    { id: 'throughput', type: 'throughput.chart', x: 0, y: 2, width: 8, height: 3 },
    { id: 'waitingList', type: 'waiting.list', x: 8, y: 2, width: 4, height: 3 },
  ]);
}

/** CSS for one widget, derived from its grid position. */
export function widgetStyle(widget: GridWidget): { gridColumn: string; gridRow: string } {
  return {
    gridColumn: `${widget.x + 1} / span ${widget.width}`,
    gridRow: `${widget.y + 1} / span ${widget.height}`,
  };
}
