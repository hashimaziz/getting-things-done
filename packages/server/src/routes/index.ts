import type { FastifyInstance } from 'fastify';
import { registerCategoryRoutes } from './categories.js';
import { registerItemRoutes } from './items.js';
import { registerSettingsRoutes } from './settings.js';

export function registerRoutes(app: FastifyInstance): void {
  registerSettingsRoutes(app);
  registerCategoryRoutes(app);
  registerItemRoutes(app);
}

export { registerCategoryRoutes } from './categories.js';
export { registerItemRoutes } from './items.js';
export { registerSettingsRoutes } from './settings.js';
