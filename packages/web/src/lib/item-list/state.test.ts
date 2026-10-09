import { describe, expect, it } from 'vitest';
import {
  addCondition,
  applySort,
  buildFilterNode,
  clampPage,
  clearConditions,
  defaultState,
  describeCondition,
  parseViewState,
  pageCount,
  primarySortDirection,
  removeCondition,
  serialiseViewState,
  type Condition,
} from './state';

/**
 * List view state.
 *
 * The state lives in the URL, which is the one place a person can edit by hand. So
 * these tests are as much about what happens to a malformed URL as about the happy
 * path: the list must render, and the bad parameter must be discarded rather than
 * carried.
 */

const inbox = defaultState('inbox');

function withConditions(...conditions: Condition[]) {
  return { ...inbox, conditions };
}

describe('defaults', () => {
  it('starts on page one', () => {
    expect(inbox.page).toBe(1);
  });

  it('sorts undated work last, because a list of tasks should read as a list of tasks', () => {
    // A column of blanks at the top is the reason people stop looking at a deadline
    // column, and the one genuinely overdue item is the reason it exists.
    expect(inbox.sort).toEqual([{ field: 'deadlineOn', direction: 'asc', nulls: 'last' }]);
  });

  it('has no conditions', () => {
    expect(inbox.conditions).toEqual([]);
  });
});

describe('parsing', () => {
  it('reads conditions from the URL', () => {
    const params = new URLSearchParams(
      'filter=' +
        encodeURIComponent(
          JSON.stringify([{ field: 'title', operator: 'contains', value: 'tax' }]),
        ),
    );

    expect(parseViewState(params, 'inbox').conditions).toEqual([
      { field: 'title', operator: 'contains', value: 'tax' },
    ]);
  });

  it('reads sort rules from the URL', () => {
    const params = new URLSearchParams(
      'sort=' + encodeURIComponent(JSON.stringify([{ field: 'title', direction: 'desc' }])),
    );

    expect(parseViewState(params, 'inbox').sort).toEqual([{ field: 'title', direction: 'desc' }]);
  });

  it('falls back to the default sort for malformed JSON', () => {
    const params = new URLSearchParams('sort=not-json');

    expect(parseViewState(params, 'inbox').sort).toEqual(inbox.sort);
  });

  it('discards a condition naming a field this build does not know', () => {
    /*
     * A filter saved by a newer version, or typed by hand, must not be able to lock
     * the list: the screen would be permanently broken with no way out except
     * editing the URL by hand.
     */
    const params = new URLSearchParams(
      'filter=' +
        encodeURIComponent(
          JSON.stringify([{ field: 'inventedField', operator: 'equals', value: 'x' }]),
        ),
    );

    expect(parseViewState(params, 'inbox').conditions).toEqual([]);
  });

  it('keeps the valid conditions and discards the invalid ones', () => {
    const params = new URLSearchParams(
      'filter=' +
        encodeURIComponent(
          JSON.stringify([
            { field: 'title', operator: 'contains', value: 'tax' },
            { field: 'nope', operator: 'equals', value: 1 },
          ]),
        ),
    );

    expect(parseViewState(params, 'inbox').conditions).toHaveLength(1);
  });

  it('rejects a malformed page rather than rendering page NaN', () => {
    expect(parseViewState(new URLSearchParams('page=abc'), 'inbox').page).toBe(1);
    expect(parseViewState(new URLSearchParams('page=-3'), 'inbox').page).toBe(1);
    expect(parseViewState(new URLSearchParams('page=0'), 'inbox').page).toBe(1);
  });

  it('accepts a valid page', () => {
    expect(parseViewState(new URLSearchParams('page=4'), 'inbox').page).toBe(4);
  });

  it('rejects a sort rule with a nonsense direction', () => {
    const params = new URLSearchParams(
      'sort=' + encodeURIComponent(JSON.stringify([{ field: 'title', direction: 'sideways' }])),
    );

    expect(parseViewState(params, 'inbox').sort).toEqual(inbox.sort);
  });
});

describe('serialising', () => {
  it('omits everything at its default, so a plain list has a clean URL', () => {
    const params = serialiseViewState(inbox, 'inbox');

    expect(params.toString()).toBe('sort=' + encodeURIComponent(JSON.stringify(inbox.sort)));
  });

  it('includes conditions when there are any', () => {
    const params = serialiseViewState(
      withConditions({ field: 'title', operator: 'contains', value: 'x' }),
      'inbox',
    );

    expect(params.get('filter')).toContain('title');
  });

  it('includes the page only when it is not the first', () => {
    expect(serialiseViewState({ ...inbox, page: 1 }, 'inbox').get('page')).toBeNull();
    expect(serialiseViewState({ ...inbox, page: 3 }, 'inbox').get('page')).toBe('3');
  });

  it('round-trips', () => {
    const state = withConditions(
      { field: 'deadlineOn', operator: 'lt', value: '2026-03-01' },
      { field: 'estimateMinutes', operator: 'lte', value: 30 },
    );
    const changed = applySort(state, 'title');

    const parsed = parseViewState(serialiseViewState(changed, 'inbox'), 'inbox');

    expect(parsed.conditions).toEqual(state.conditions);
    expect(parsed.sort).toEqual(changed.sort);
  });
});

describe('building the filter', () => {
  it('is null when nothing narrows the list', () => {
    // A null filter rather than an empty group: the server then does not have to
    // parse a tree that says nothing. Needs an unscoped view, since a container view
    // is always narrowed by its container.
    expect(buildFilterNode(defaultState(null))).toBeNull();
  });

  it('is a bare condition when the container is the only narrowing', () => {
    expect(buildFilterNode(inbox)).toEqual({
      kind: 'condition',
      field: 'container',
      operator: 'equals',
      value: 'inbox',
    });
  });

  it('combines the container and the conditions with AND', () => {
    const node = buildFilterNode(
      withConditions({ field: 'title', operator: 'contains', value: 'tax' }),
    );

    expect(node).toEqual({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'container', operator: 'equals', value: 'inbox' },
        { kind: 'condition', field: 'title', operator: 'contains', value: 'tax' },
      ],
    });
  });

  it('omits the value for a unary operator', () => {
    const node = buildFilterNode(withConditions({ field: 'projectId', operator: 'is_empty' }));

    expect(node).toEqual({
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', field: 'container', operator: 'equals', value: 'inbox' },
        { kind: 'condition', field: 'projectId', operator: 'is_empty' },
      ],
    });
  });

  it('has no container condition for an unscoped view', () => {
    expect(
      buildFilterNode({
        ...defaultState(null),
        conditions: [{ field: 'title', operator: 'is_empty' }],
      }),
    ).toEqual({
      kind: 'condition',
      field: 'title',
      operator: 'is_empty',
    });
  });
});

describe('adding conditions', () => {
  it('adds one', () => {
    const next = addCondition(inbox, { field: 'title', operator: 'contains', value: 'tax' });

    expect(next.conditions).toHaveLength(1);
  });

  /*
   * Replacing rather than accumulating. Two conditions on one field are almost
   * always a mistake — "before today" and "after the weekend" — and a UI showing them
   * as two rows is nearly impossible to reason about.
   */
  it('replaces an existing condition on the same field', () => {
    const first = addCondition(inbox, { field: 'title', operator: 'contains', value: 'tax' });
    const second = addCondition(first, { field: 'title', operator: 'contains', value: 'vat' });

    expect(second.conditions).toEqual([{ field: 'title', operator: 'contains', value: 'vat' }]);
  });

  it('returns to page one, because a changed filter means a different result set', () => {
    const onPageSeven = { ...inbox, page: 7 };
    const next = addCondition(onPageSeven, { field: 'title', operator: 'contains', value: 'tax' });

    // Staying on page 7 of a now three-page list shows an empty screen and looks
    // like data loss.
    expect(next.page).toBe(1);
  });

  it('removes by field', () => {
    const state = withConditions(
      { field: 'title', operator: 'contains', value: 'tax' },
      { field: 'estimateMinutes', operator: 'lte', value: 30 },
    );

    expect(removeCondition(state, 'title').conditions).toHaveLength(1);
  });

  it('clears everything', () => {
    const state = withConditions({ field: 'title', operator: 'contains', value: 'tax' });
    expect(clearConditions(state).conditions).toEqual([]);
  });
});

describe('sorting', () => {
  it('adds a sort by the field', () => {
    expect(applySort(inbox, 'title').sort).toEqual([
      { field: 'title', direction: 'asc', nulls: 'last' },
    ]);
  });

  it('uses the direction that is useful for the field', () => {
    // Newest first is the useful order for when something was captured; oldest first
    // for a title would put the alphabetically last one on top.
    expect(applySort(inbox, 'createdAt').sort.at(0)?.direction).toBe('desc');
  });

  it('flips direction on a second click', () => {
    const ascending = applySort(inbox, 'title');
    expect(applySort(ascending, 'title').sort.at(0)?.direction).toBe('desc');
  });

  it('clears on a third click, returning to the default', () => {
    /*
     * A sort that cannot be removed is a sort someone works around by making a new
     * view, which is how lists multiply.
     */
    const once = applySort(inbox, 'title');
    const twice = applySort(once, 'title');
    expect(applySort(twice, 'title').sort).toEqual(inbox.sort);
  });

  it('replaces the existing sort when not additive', () => {
    const sorted = applySort(inbox, 'title');
    const resorted = applySort(sorted, 'createdAt');

    expect(resorted.sort).toHaveLength(1);
    expect(resorted.sort.at(0)?.field).toBe('createdAt');
  });

  it('adds a second sort when additive', () => {
    // "Which of these is due first, then by how long it takes" is the question a
    // list usually exists to answer, and it needs more than one column.
    const sorted = applySort(inbox, 'deadlineOn');
    const both = applySort(sorted, 'estimateMinutes', { additive: true });

    expect(both.sort.map((rule) => rule.field)).toEqual(['deadlineOn', 'estimateMinutes']);
  });

  it('reports the primary sort for aria-sort', () => {
    const sorted = applySort(inbox, 'title');
    expect(primarySortDirection(sorted, 'title')).toBe('asc');
    expect(primarySortDirection(sorted, 'deadlineOn')).toBe('none');
  });

  it('resets the page when the sort changes', () => {
    expect(applySort({ ...inbox, page: 4 }, 'title').page).toBe(1);
  });
});

describe('pagination', () => {
  it('counts pages', () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(150, 50)).toBe(3);
  });

  it('never reports zero pages, so an empty list says "page 1 of 1"', () => {
    expect(pageCount(0, 50)).toBeGreaterThanOrEqual(1);
  });

  it('survives a nonsensical page size rather than dividing by zero', () => {
    expect(pageCount(10, 0)).toBe(1);
  });

  it('clamps a page past the end to the last one', () => {
    // Showing the last page is nearly right. Showing an empty table is confidently
    // wrong, and is what someone sees after completing items on another page.
    expect(clampPage(7, 120, 50)).toBe(3);
  });

  it('leaves a valid page alone', () => {
    expect(clampPage(2, 120, 50)).toBe(2);
  });

  it('raises a page below one', () => {
    expect(clampPage(0, 120, 50)).toBe(1);
  });
});

describe('describing conditions', () => {
  /*
   * The chip has to read as intent. "deadlineOn lt 2026-03-01" describes the query;
   * "Deadline is before 1 Mar" describes what was asked for.
   */
  it('reads a text condition as a sentence', () => {
    expect(describeCondition({ field: 'title', operator: 'contains', value: 'tax' })).toBe(
      'Title contains tax',
    );
  });

  it('reads a unary condition as a sentence', () => {
    expect(describeCondition({ field: 'projectId', operator: 'is_empty' })).toBe(
      'Project is empty',
    );
  });

  it('reads a list condition', () => {
    expect(
      describeCondition({ field: 'contexts', operator: 'has_any', value: ['@office', '@phone'] }),
    ).toBe('Context includes any of @office, @phone');
  });

  it('uses a custom field label when given one', () => {
    expect(
      describeCondition(
        { field: 'my_priority', operator: 'equals', value: 'high' },
        { my_priority: 'My priority' },
      ),
    ).toBe('My priority is high');
  });

  it('falls back to the raw field for something unknown', () => {
    // Still readable: the unknown field is shown verbatim, but the operator is
    // translated, so the chip is a sentence rather than a query.
    expect(describeCondition({ field: 'mystery', operator: 'equals', value: 1 })).toBe(
      'mystery is 1',
    );
  });
});
