import type { FastifyInstance } from 'fastify';
import { registerArchiveRoutes } from './archive.js';
import { registerCategoryRoutes } from './categories.js';
import { registerItemRoutes } from './items.js';
import { registerRecurrenceRoutes } from './recurrence.js';
import { registerSettingsRoutes } from './settings.js';

export function registerRoutes(app: FastifyInstance): void {
  registerSettingsRoutes(app);
  registerCategoryRoutes(app);
  registerArchiveRoutes(app);
  registerItemRoutes(app);
  registerRecurrenceRoutes(app);
}

export { registerArchiveRoutes } from './archive.js';
export { registerCategoryRoutes } from './categories.js';
export { registerItemRoutes } from './items.js';
export { expandItem, toFieldValues, type ExpandedItem } from './item-helpers.js';
export { registerRecurrenceRoutes } from './recurrence.js';
export { registerSettingsRoutes } from './settings.js';
