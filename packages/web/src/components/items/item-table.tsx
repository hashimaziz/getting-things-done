/**
 * The item table.
 *
 * A table rather than a card list, because a list of tasks is scanned by comparing
 * columns and a table is the only layout where comparing columns is possible. Cards
 * are for the single-item view, where there is nothing to compare against.
 *
 * The header is a real table header: `aria-sort` is set, the buttons are buttons,
 * and shift-click adds a secondary sort. Screen reader and keyboard users get the
 * same capability as a mouse user, which is the minimum for a screen used every day.
 */

import { cn } from '@/lib/cn';
import { formatCellValue, cellValue, deadlineUrgency, formatDate } from '@/lib/item-list/format';
import type { ColumnSpec } from '@/lib/item-list/columns';
import type { FieldDefinition, Item } from '@/lib/types';

export interface ItemTableProps {
  items: Item[];
  columns: ColumnSpec[];
  definitions: FieldDefinition[];
  today: string;
  sort: Array<{ field: string; direction: 'asc' | 'desc' }>;
  labels: {
    projects?: Record<string, string>;
    people?: Record<string, string>;
    contexts?: Record<string, string>;
  };
  onSort: (field: string, additive: boolean) => void;
  onOpen: (item: Item) => void;
  /** Rendered when there are no items. Given the container, so the copy can fit. */
  emptyState?: React.ReactNode;
}

export function ItemTable({
  items,
  columns,
  definitions,
  today,
  sort,
  labels,
  onSort,
  onOpen,
  emptyState,
}: ItemTableProps) {
  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const sortIndex = new Map(sort.map((rule, index) => [rule.field, { rule, index }]));

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b">
          {columns.map((column) => {
            const entry = sortIndex.get(column.key);
            const position = entry?.index ?? -1;

            return (
              <th
                key={column.key}
                scope="col"
                // Only the primary sort is announced as the sort. A secondary column
                // would otherwise claim to be the sort and mislead anyone relying on
                // the announcement.
                aria-sort={
                  entry === undefined || position !== 0
                    ? 'none'
                    : entry.rule.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                }
                className={cn(
                  'px-2 py-1.5 text-left font-medium text-muted-foreground',
                  column.align === 'right' && 'text-right',
                )}
              >
                <button
                  type="button"
                  onClick={(event) => onSort(column.key, event.shiftKey)}
                  title={`Sort by ${column.label}. Hold shift to add a second sort.`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  {column.label}
                  {entry === undefined ? null : (
                    <span aria-hidden className="text-[0.625rem]">
                      {entry.rule.direction === 'asc' ? '▲' : '▼'}
                      {position > 0 ? <sub>{position + 1}</sub> : null}
                    </span>
                  )}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>

      <tbody>
        {items.map((item) => (
          <tr
            key={item.id}
            className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
            onClick={() => onOpen(item)}
          >
            {columns.map((column) => (
              <Cell
                key={column.key}
                item={item}
                column={column}
                definitions={definitions}
                today={today}
                labels={labels}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cell({
  item,
  column,
  definitions,
  today,
  labels,
}: {
  item: Item;
  column: ColumnSpec;
  definitions: FieldDefinition[];
  today: string;
  labels: ItemTableProps['labels'];
}) {
  const definition = definitions.find((entry) => entry.key === column.key);

  // Titles get the item's own state: an overdue deadline on a done item is history,
  // not a warning.
  if (column.key === 'title') {
    return (
      <td className="px-2 py-1.5">
        <span className="flex items-center gap-2">
          <span className="truncate">{item.title}</span>
          {item.recurrenceId !== null ? (
            <span aria-hidden title="Repeats" className="text-[0.625rem] text-muted-foreground">
              ↻
            </span>
          ) : null}
          {item.isTemplate ? (
            <span className="container-chip bg-muted text-muted-foreground">template</span>
          ) : null}
        </span>
      </td>
    );
  }

  const urgency = column.key === 'deadlineOn' ? deadlineUrgency(item.deadlineOn, today) : 'none';
  const text =
    column.key === 'deadlineOn' && item.deadlineOn
      ? formatDate(item.deadlineOn)
      : formatCellValue(cellValue(item, column.key), definition, labels);

  return (
    <td
      className={cn(
        'px-2 py-1.5',
        column.align === 'right' && 'text-right tabular-nums',
        urgency === 'overdue' && 'font-medium text-destructive',
        urgency === 'today' && 'text-[var(--warning)]',
        text === '' && 'text-muted-foreground',
      )}
    >
      {text === '' ? <span aria-hidden>—</span> : text}
    </td>
  );
}
