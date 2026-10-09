import type { FastifyInstance } from 'fastify';
import { registerCategoryRoutes } from './categories.js';
import { registerSettingsRoutes } from './settings.js';

export function registerRoutes(app: FastifyInstance): void {
  registerSettingsRoutes(app);
  registerCategoryRoutes(app);
}

export { registerCategoryRoutes } from './categories.js';
export { registerSettingsRoutes } from './settings.js';
