/**
 * Executes the setup plan.
 *
 * Sequential on purpose. Categories must exist before their fields, and the
 * wizard's whole job is to leave a consistent database, so a failure halfway must
 * stop rather than skip ahead and produce something half-built.
 *
 * The important behaviour is what happens when it does fail: the requests that
 * already succeeded stay, and the error names the step. Restarting setup then
 * creates duplicates, so the hook reports precisely which request failed and what
 * was already created, rather than a bare "setup failed".
 */

import { useCallback, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { useQueryClient } from '@tanstack/react-query';
import {
  buildContextPlan,
  buildFieldPlan,
  buildSetupPlan,
  type SetupRequest,
  type SetupState,
} from './plan';

export interface SetupProgress {
  /** 1-based index of the request being attempted. */
  current: number;
  total: number;
  /** The human-readable purpose, e.g. `category "Work"`. */
  purpose: string | null;
}

export interface SetupFailure {
  purpose: string;
  message: string;
  /** What had already been created when it stopped, so it can be reported. */
  completed: string[];
  /** Which requests were made, for a retry that skips what worked. */
  done: SetupRequest[];
}

export interface SetupWizardState {
  running: boolean;
  progress: SetupProgress | null;
  failure: SetupFailure | null;
  complete: boolean;
}

const INITIAL: SetupWizardState = {
  running: false,
  progress: null,
  failure: null,
  complete: false,
};

export function useSetupWizard() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SetupWizardState>(INITIAL);

  const run = useCallback(
    async (setup: SetupState): Promise<boolean> => {
      setState({ ...INITIAL, running: true });

      const done: SetupRequest[] = [];
      const completed: string[] = [];

      // Settings and category creation, in the order `buildSetupPlan` fixed.
      const base = buildSetupPlan(setup);
      const total =
        base.length +
        setup.categories.reduce(
          (sum, category) =>
            sum + category.fields.filter((field) => field.label.trim() !== '').length,
          0,
        ) +
        setup.contexts.filter((context) => context.name.trim() !== '').length +
        1;

      let index = 0;
      // Held in a local rather than read back out of state: `setState` has not
      // taken effect when the next request starts, and a failure report that names
      // the previous step is worse than no report.
      let currentPurpose = 'starting';
      const step = (request: SetupRequest): void => {
        index += 1;
        currentPurpose = request.purpose;
        setState((previous) => ({
          ...previous,
          progress: { current: index, total, purpose: request.purpose },
        }));
      };

      try {
        const categoryIds = new Map<string, string>();

        for (const request of base) {
          step(request);

          if (request.method === 'POST' && request.path === '/categories') {
            const response = await apiFetch.post<{ category: { id: string } }>(
              '/categories',
              request.body,
            );
            categoryIds.set(String(request.body.name), response.category.id);
          } else {
            await apiFetch.put(`/settings/${request.path.split('/').pop()}`, request.body);
          }

          done.push(request);
          completed.push(request.purpose);
        }

        // Fields, addressed at the ids the category requests actually returned.
        for (const category of setup.categories) {
          const categoryId = categoryIds.get(category.name);
          if (!categoryId) {
            continue;
          }
          for (const request of buildFieldPlan(categoryId, category.fields)) {
            step(request);
            await apiFetch.post(request.path, request.body);
            done.push(request);
            completed.push(request.purpose);
          }
        }

        // Contexts, after the categories whose ids they may be scoped to. Same
        // two-phase reasoning as the fields: the scope is a name until the category
        // exists, and only the created id can be written down.
        for (const request of buildContextPlan(setup.contexts, categoryIds)) {
          step(request);
          await apiFetch.post(request.path, request.body);
          done.push(request);
          completed.push(request.purpose);
        }

        // Last, because it is what gates the wizard. Setting it early means a
        // failure above leaves the app in setup mode, which is recoverable; the
        // reverse order would leave a half-configured app that looks finished.
        step({ method: 'PUT', path: '', body: {}, categoryName: null, purpose: 'finishing setup' });
        await apiFetch.put('/settings/setup.completed', { value: true });
        completed.push('finishing setup');
        done.push({
          method: 'PUT',
          path: '/settings/setup.completed',
          body: { value: true },
          categoryName: null,
          purpose: 'finishing setup',
        });

        // Everything the wizard created is now stale, including the gate's own
        // answer: the app has to stop redirecting to the wizard it just completed.
        void queryClient.invalidateQueries({ queryKey: keys.setupStatus });
        void queryClient.invalidateQueries({ queryKey: ['settings'] });
        void queryClient.invalidateQueries({ queryKey: keys.categories });
        void queryClient.invalidateQueries({ queryKey: keys.fields.all });
        void queryClient.invalidateQueries({ queryKey: keys.reference.all });

        setState({ running: false, progress: null, failure: null, complete: true });
        return true;
      } catch (cause) {
        const purpose = currentPurpose;
        setState({
          running: false,
          progress: null,
          failure: {
            purpose,
            message: cause instanceof ApiError ? cause.message : String(cause),
            completed,
            done,
          },
          complete: false,
        });
        return false;
      }
    },
    [queryClient],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, run, reset };
}
