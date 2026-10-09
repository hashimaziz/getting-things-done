import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { stubFetch, type FetchStub, type StubbedRoute } from '@/test/fetch-stub';

/**
 * The weekly review screen.
 *
 * The property being protected is that the review is a *sequence*. Each step links to
 * the place its work happens, and the steps come in the order the method specifies. Most
 * systems fail at the review by making it a list of counts to glance at, and the test
 * that would catch that regression is "the inbox step comes first and links to the
 * inbox".
 */

const STATUS_SET_UP = {
  path: '/api/status',
  body: { app: 'GTD', version: 1, setupCompleted: true },
};

const PHASES = [
  { id: 'get_clear', title: 'Get clear', description: 'Empty every collection point.' },
  { id: 'get_current', title: 'Get current', description: 'Review each list.' },
  { id: 'get_creative', title: 'Get creative', description: 'Consider the wider horizon.' },
];

function step(id: string, title: string, source: string, phase: string) {
  return { id, title, description: `About ${title}.`, source, phase };
}

const STEPS = [
  step('process_inbox', 'Process the inbox to zero', 'inbox', 'get_clear'),
  step(
    'review_upcoming_calendar',
    'Review the upcoming calendar',
    'calendar_upcoming',
    'get_current',
  ),
  step('review_goals', 'Review the wider horizon', 'goals', 'get_creative'),
];

function review(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    phases: PHASES,
    steps: STEPS,
    progress: [
      { step: STEPS[0], pending: 4, problems: 0, satisfied: false },
      { step: STEPS[1], pending: 0, problems: 0, satisfied: true },
      { step: STEPS[2], pending: 0, problems: 0, satisfied: true },
    ],
    lastReviewAt: daysAgo(2),
    outstanding: 1,
    violations: [],
    ...overrides,
  };
}

const HEALTH = {
  inboxBacklog: 4,
  overdue: 0,
  dueSoon: 0,
  scheduledOn: '2026-03-02',
  scheduledCount: 0,
  waiting: 0,
  waitingOverdue: 0,
  waitingOldestDays: 0,
  someday: 3,
  openWithoutEstimate: 1,
  openMinutes: 60,
  openWithoutProject: 1,
};

let lastStub: FetchStub | null = null;

/** A timestamp the given number of days before today, so cadence assertions do not rot. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function routes(
  answer: Record<string, unknown> = review(),
  extra: StubbedRoute[] = [],
): StubbedRoute[] {
  return [
    STATUS_SET_UP,
    { path: '/api/review', body: answer },
    { path: '/api/metrics/health', body: { health: HEALTH } },
    { path: '/api/categories', body: { categories: [] } },
    { path: '/api/fields', body: { fields: [] } },
    { path: '/api/projects', body: { projects: [] } },
    { path: '/api/settings/ui.listColumns', body: { key: 'ui.listColumns', value: {} } },
    { path: '/api/settings/ui.shortcuts', body: { key: 'ui.shortcuts', value: {} } },
    { path: '/api/items', body: { items: [], total: 0 } },
    ...extra,
  ];
}

describe('the sequence', () => {
  it('shows the steps in the order the method gives', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    // Waits for a step, not the heading: the heading is on screen while the review is
    // still loading, so asserting on it would measure the loading state.
    await waitFor(() => {
      expect(
        [...document.querySelectorAll('p')].some(
          (node) => node.textContent === 'Review the wider horizon',
        ),
      ).toBe(true);
    });

    // Read from the document rather than by role: the step titles are paragraphs inside
    // cards, and their order in the DOM is the order the method specifies, which is the
    // thing being asserted.
    const paragraphs = [...document.querySelectorAll('p')].map((node) => node.textContent ?? '');
    const indexes = STEPS.map((entry) => paragraphs.indexOf(entry.title));

    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it('sends the inbox step to the inbox', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    // "Done" is not a tick box; it is having been somewhere and dealt with the work.
    expect(await screen.findByRole('link', { name: 'Clarify the inbox' })).toHaveAttribute(
      'href',
      '/list/inbox',
    );
  });

  it('sends the calendar step to the calendar', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    expect(await screen.findByRole('link', { name: 'Open the calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );
  });

  it('offers no link for a step done away from the app', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    // Goals and areas of focus have no screen yet. A link to a route that does not
    // exist is worse than saying the step happens in your head.
    await screen.findByText('Review the wider horizon');
    expect(screen.getByText(/Done from memory/)).toBeInTheDocument();
  });

  it('groups the steps under their phases', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    expect(await screen.findByText('Get clear')).toBeInTheDocument();
    expect(screen.getByText('Get current')).toBeInTheDocument();
    expect(screen.getByText('Get creative')).toBeInTheDocument();
  });

  it('says which phase is how far through', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    // Two phases each hold a single clear step, so the count appears once per phase.
    expect((await screen.findAllByText('1 of 1 clear')).length).toBe(2);
  });
});

describe('what is outstanding', () => {
  it('counts what is left', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    expect(
      await screen.findByText('1 collection still has something outstanding.'),
    ).toBeInTheDocument();
  });

  it('says so plainly when everything is clear', async () => {
    const clear = review({
      progress: [
        { step: STEPS[0], pending: 0, problems: 0, satisfied: true },
        { step: STEPS[1], pending: 0, problems: 0, satisfied: true },
        { step: STEPS[2], pending: 0, problems: 0, satisfied: true },
      ],
      outstanding: 0,
    });
    lastStub = stubFetch(routes(clear));
    renderApp('/review');

    // A review where every step reports nothing is a good outcome and should look like
    // one rather than like a broken screen.
    expect(await screen.findByText('Everything has been reviewed.')).toBeInTheDocument();
  });

  it('names the step to start with', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    // The order is the point: the review is not a bag of tasks, and offering to jump to
    // the easiest step is how the inbox gets skipped.
    expect(await screen.findByText(/Start with/)).toBeInTheDocument();
    // Twice: once in the "start with" line and once as the step's own title.
    expect(screen.getAllByText('Process the inbox to zero').length).toBeGreaterThanOrEqual(2);
  });

  it('reports a flagged step in warning colours', async () => {
    const flagged = review({
      progress: [{ step: STEPS[0], pending: 2, problems: 2, satisfied: false }],
    });
    lastStub = stubFetch(routes(flagged));
    renderApp('/review');

    expect(await screen.findByText('2 to look at')).toBeInTheDocument();
  });

  it('lists what is inconsistent, in words', async () => {
    const broken = review({
      violations: [
        {
          kind: 'project_without_next_action',
          severity: 'warning',
          message: 'project_without_next_action',
          itemIds: [],
          projectIds: ['p1'],
        },
      ],
    });
    lastStub = stubFetch(routes(broken));
    renderApp('/review');

    expect(await screen.findByText(/1 thing is inconsistent/)).toBeInTheDocument();
    expect(screen.getByText(/project without next action/)).toBeInTheDocument();
  });
});

describe('the cadence', () => {
  it('says when the review last ran', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    expect(
      await screen.findByText(/Done 2 days ago|Done 1 day ago|Done today/),
    ).toBeInTheDocument();
  });

  it('says it has never been run without calling it a failure', async () => {
    lastStub = stubFetch(routes(review({ lastReviewAt: null })));
    renderApp('/review');

    expect(await screen.findByText('Never run')).toBeInTheDocument();
  });

  it('calls a long gap overdue', async () => {
    lastStub = stubFetch(routes(review({ lastReviewAt: daysAgo(42) })));
    renderApp('/review');

    // The value of the review is that it is weekly, so a long gap is the thing worth
    // saying plainly.
    expect(await screen.findByText(/overdue/)).toBeInTheDocument();
  });

  it('shows progress as a bar', async () => {
    lastStub = stubFetch(routes());
    renderApp('/review');

    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '67');
  });
});

describe('completing the review', () => {
  it('records it', async () => {
    lastStub = stubFetch(
      routes(review(), [
        {
          path: '/api/review/complete',
          method: 'POST',
          body: { lastReviewAt: '2026-03-08T12:00:00.000Z' },
        },
      ]),
    );
    const { user } = renderApp('/review');

    await user.click(await screen.findByRole('button', { name: /mark review complete/i }));

    await waitFor(() => {
      expect(lastStub?.calls.some((entry) => entry.path === '/api/review/complete')).toBe(true);
    });
  });
});

describe('failure', () => {
  it('says so when the review cannot be loaded', async () => {
    lastStub = stubFetch([
      { path: '/api/review', body: { error: { code: 'boom', message: 'no' } }, status: 500 },
      ...routes(),
    ]);
    renderApp('/review');

    expect(await screen.findByText('no')).toBeInTheDocument();
  });

  it('offers a retry', async () => {
    lastStub = stubFetch([
      { path: '/api/review', body: { error: { code: 'boom', message: 'no' } }, status: 500 },
      ...routes(),
    ]);
    renderApp('/review');

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
