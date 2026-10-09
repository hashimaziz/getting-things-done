/**
 * Data hooks.
 *
 * These wrap React Query rather than being used inline at each call site, so that
 * every screen reads the same key for the same data and one `invalidate` updates
 * every screen showing it. The consistency is the point: the sidebar count and the
 * dashboard tile must never disagree because they were fetched under different keys.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import { keys } from './query-keys';
import type {
  ActivityEntry,
  Category,
  ContainerSpec,
  FieldDefinition,
  Item,
  Project,
  SystemHealth,
  SystemViolation,
} from './types';

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function useHealth() {
  return useQuery({
    queryKey: keys.metrics.health,
    queryFn: async () => (await apiFetch.get<{ health: SystemHealth }>('/metrics/health')).health,
  });
}

export function useContainers() {
  return useQuery({
    queryKey: keys.containers,
    queryFn: async () => {
      const response = await apiFetch.get<{ containers: ContainerSpec[] }>('/containers');
      return response.containers;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: async () => (await apiFetch.get<{ categories: Category[] }>('/categories')).categories,
  });
}

export function useFieldDefinitions() {
  return useQuery({
    queryKey: keys.fields.list(),
    queryFn: async () => (await apiFetch.get<{ fields: FieldDefinition[] }>('/fields')).fields,
  });
}

export interface AppStatus {
  app: string;
  version: number;
  setupCompleted: boolean;
}

/**
 * Whether first-run setup has happened. The app shell redirects to the wizard
 * when it has not, so this is fetched before any other data.
 *
 * The three `false`s are a bug fix, not preferences, and they were found the hard
 * way. With the server unreachable this query was fetched roughly 2,900 times a
 * second, forever. The loop:
 *
 *   1. The query errors. React Query treats an errored query as worth retrying on
 *      mount (`retryOnMount`, default true), independently of `retry`.
 *   2. The gate redirects to the wizard, and the wizard asks for the same query.
 *   3. Asking again refetches, so the answer is pending again.
 *   4. The gate shows its waiting state while pending, which unmounts the wizard.
 *   5. The settled answer remounts the wizard, which asks again. Back to 3.
 *
 * A local server that cannot answer one query is exactly when the app should do
 * the least work possible, so both mount-time refetch triggers are off. The
 * consequence is that a stale answer can persist for `staleTime`; that is the right
 * trade for a value which only changes when the wizard finishes, and finishing
 * invalidates it explicitly.
 */
export function useStatus() {
  return useQuery({
    queryKey: keys.setupStatus,
    queryFn: () => apiFetch.get<AppStatus>('/status'),
    retry: false,
    refetchOnMount: false,
    staleTime: 60_000,
    retryOnMount: false,
  });
}

/** Marks the setup status stale, so the next gate mount asks again. */
export function invalidateSetupStatus(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: keys.setupStatus });
}

/** Invariants power the weekly review, so the review flow fetches them. */
export function useViolations() {
  return useQuery({
    queryKey: keys.review.violations,
    queryFn: async () =>
      (await apiFetch.get<{ violations: SystemViolation[] }>('/invariants')).violations,
  });
}

export interface CreateItemInput {
  categoryId: string;
  title: string;
  notes?: string | null;
  container?: string;
  estimateMinutes?: number | null;
  whenAt?: string | null;
  deadlineOn?: string | null;
  projectId?: string | null;
  waitingOnPersonId?: string | null;
  followUpAt?: string | null;
  contextIds?: string[];
  data?: Record<string, unknown>;
}

export interface CreateItemResult {
  item: Item;
}

/** Capture. Shared by the inbox, the command palette, and the CLI-facing route. */
export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateItemInput) =>
      (await apiFetch.post<CreateItemResult>('/items', input)).item,
    onSuccess: () => {
      // Item lists are keyed by their filters, so invalidating the whole item
      // prefix is the only correct way to be sure every affected list updates.
      void queryClient.invalidateQueries({ queryKey: keys.items.all });
      void queryClient.invalidateQueries({ queryKey: keys.metrics.all });
      void queryClient.invalidateQueries({ queryKey: keys.review.all });
    },
  });
}

export function useItem(id: string | null) {
  return useQuery({
    queryKey: keys.items.detail(id ?? 'none'),
    queryFn: async () => (await apiFetch.get<{ item: Item }>(`/items/${id}`)).item,
    enabled: id !== null,
  });
}

export function useItemActivity(id: string | null) {
  return useQuery({
    queryKey: keys.items.activity(id ?? 'none'),
    queryFn: async () =>
      (await apiFetch.get<{ entries: ActivityEntry[] }>(`/items/${id}/history`)).entries,
    enabled: id !== null,
  });
}

export interface UpdateItemInput {
  title?: string;
  notes?: string | null;
  estimateMinutes?: number | null;
  whenAt?: string | null;
  deadlineOn?: string | null;
  projectId?: string | null;
  waitingOnPersonId?: string | null;
  followUpAt?: string | null;
  contextIds?: string[];
  data?: Record<string, unknown>;
}

export function useUpdateItem(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateItemInput) =>
      (await apiFetch.patch<{ item: Item }>(`/items/${id}`, input)).item,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.items.all });
      void queryClient.invalidateQueries({ queryKey: keys.metrics.all });
    },
  });
}

/**
 * Moving an item between containers.
 *
 * Goes through the move endpoint rather than a patch, because the server decides
 * whether a transition is legal: `trash` to `done` is not a field update, it is an
 * illegal transition, and only the server knows the rules.
 */
export function useMoveItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, container }: { id: string; container: string }) =>
      (await apiFetch.post<{ item: Item }>(`/items/${id}/move`, { container })).item,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.items.all });
      void queryClient.invalidateQueries({ queryKey: keys.metrics.all });
      void queryClient.invalidateQueries({ queryKey: keys.review.all });
      void queryClient.invalidateQueries({ queryKey: keys.archive.all });
    },
  });
}

export function useProjects() {
  return useQuery({
    queryKey: keys.reference.projects,
    queryFn: async () => (await apiFetch.get<{ projects: Project[] }>('/projects')).projects,
  });
}
