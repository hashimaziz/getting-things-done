/**
 * Query key factory.
 *
 * Keys are built here rather than written inline at each call site, because a key
 * typo does not fail a test, it fails as a stale cache entry that never
 * invalidates. A malformed key is the kind of bug that looks like "the list did
 * not update after I moved something" weeks later.
 *
 * Keys are hierarchical. `keys.items.list(filters)` is a prefix-match for
 * `keys.items.detail(id)`, so invalidating the list does not need every filter
 * combination enumerated, and invalidating all items is a single call.
 */

import type { FilterNode, SortRule } from './types';

export interface ItemListParams {
  container?: string;
  categoryId?: string;
  projectId?: string;
  filter?: FilterNode | null;
  sort?: SortRule[];
  search?: string;
  page?: number;
  pageSize?: number;
}

export const keys = {
  settings: ['settings'] as const,
  setupStatus: ['settings', 'setup-status'] as const,
  containers: ['containers'] as const,
  categories: ['categories'] as const,
  fields: {
    all: ['fields'] as const,
    list: () => ['fields', 'list'] as const,
    forCategory: (categoryId: string) => ['fields', 'category', categoryId] as const,
  },
  items: {
    all: ['items'] as const,
    list: (params: ItemListParams) => ['items', 'list', params] as const,
    detail: (id: string) => ['items', 'detail', id] as const,
    activity: (id: string) => ['items', 'activity', id] as const,
  },
  recommendations: {
    all: ['recommendations'] as const,
    list: (focus: string) => ['recommendations', 'list', focus] as const,
    providers: ['recommendations', 'providers'] as const,
  },
  metrics: {
    all: ['metrics'] as const,
    health: ['metrics', 'health'] as const,
    breakdown: (dimension: string) => ['metrics', 'breakdown', dimension] as const,
    throughput: (days: number) => ['metrics', 'throughput', days] as const,
    completions: (limit: number) => ['metrics', 'completions', limit] as const,
  },
  review: {
    all: ['review'] as const,
    data: ['review', 'data'] as const,
    waiting: (groupBy: string) => ['review', 'waiting', groupBy] as const,
    violations: ['review', 'violations'] as const,
  },
  archive: {
    all: ['archive'] as const,
    search: (params: ItemListParams) => ['archive', 'search', params] as const,
    facets: ['archive', 'facets'] as const,
    daily: (days: number) => ['archive', 'daily', days] as const,
  },
  reference: {
    all: ['reference'] as const,
    projects: ['reference', 'projects'] as const,
    people: ['reference', 'people'] as const,
    contexts: ['reference', 'contexts'] as const,
    templates: ['reference', 'templates'] as const,
  },
  dashboards: {
    all: ['dashboards'] as const,
    list: ['dashboards', 'list'] as const,
    one: (id: string) => ['dashboards', 'detail', id] as const,
  },
} as const;
