import type { FastifyInstance } from 'fastify';
import { registerArchiveRoutes } from './archive.js';
import { registerCategoryRoutes } from './categories.js';
import { registerDashboardRoutes } from './dashboards.js';
import { registerItemRoutes } from './items.js';
import { registerMetricsRoutes } from './metrics.js';
import { registerReferenceRoutes } from './reference.js';
import { registerReviewRoutes } from './review.js';
import { registerRecurrenceRoutes } from './recurrence.js';
import { registerRecommendationRoutes } from './recommendations.js';
import { registerSettingsRoutes } from './settings.js';
import { registerSystemRoutes } from './system.js';

export function registerRoutes(app: FastifyInstance): void {
  registerSettingsRoutes(app);
  registerSystemRoutes(app);
  registerCategoryRoutes(app);
  registerDashboardRoutes(app);
  registerArchiveRoutes(app);
  registerItemRoutes(app);
  registerMetricsRoutes(app);
  registerRecurrenceRoutes(app);
  registerRecommendationRoutes(app);
  registerReferenceRoutes(app);
  registerReviewRoutes(app);
}

export { registerArchiveRoutes } from './archive.js';
export { registerCategoryRoutes } from './categories.js';
export { registerDashboardRoutes } from './dashboards.js';
export { registerItemRoutes } from './items.js';
export { registerMetricsRoutes } from './metrics.js';
export { registerReferenceRoutes } from './reference.js';
export { registerReviewRoutes } from './review.js';
export { expandItem, toFieldValues, type ExpandedItem } from './item-helpers.js';
export { registerRecurrenceRoutes } from './recurrence.js';
export { registerRecommendationRoutes } from './recommendations.js';
export { registerSettingsRoutes } from './settings.js';
export { registerSystemRoutes } from './system.js';
