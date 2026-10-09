/**
 * Settings routes.
 *
 * Settings are the runtime-mutable half of the configuration, as opposed to the
 * static app config in core. Everything here is a plain key/value read and write;
 * the interpretation of specific keys belongs to the client.
 */

import { APP_CONFIG, SETTING_KEYS, type SettingKey } from '@gtd/core';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

const KNOWN_KEYS = Object.values(SETTING_KEYS) as SettingKey[];

const setSettingSchema = z.object({
  value: z.unknown(),
});

const wellKnownSchema = z.enum(KNOWN_KEYS as [SettingKey, ...SettingKey[]]);

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/status', async () => ({
    app: APP_CONFIG.identity.name,
    version: 1,
    setupCompleted: app.repos.settings.isSetupComplete(),
  }));

  app.get('/api/settings', async () => ({
    settings: app.repos.settings.getAll(),
  }));

  app.get<{ Params: { key: string } }>('/api/settings/:key', async (request, reply) => {
    const { key } = request.params;
    if (!app.repos.settings.has(key)) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No setting named "${key}"` },
      });
    }
    return { key, value: app.repos.settings.get(key) };
  });

  app.put<{ Params: { key: string }; Body: unknown }>(
    '/api/settings/:key',
    async (request, reply) => {
      const { key } = request.params;
      const body = setSettingSchema.parse(request.body ?? {});
      return reply.send(app.repos.settings.set(key, body.value));
    },
  );

  /**
   * Typed access for the keys the app actually reads. Present so the web client
   * does not have to hardcode string literals that could drift from core.
   */
  app.get<{ Params: { key: SettingKey } }>('/api/settings-known/:key', async (request, reply) => {
    const parsed = wellKnownSchema.safeParse(request.params.key);
    if (!parsed.success) {
      return reply.status(404).send({
        error: {
          code: 'unknown_setting',
          message: `"${request.params.key}" is not a known setting`,
        },
      });
    }
    return { key: parsed.data, value: app.repos.settings.getKnown(parsed.data) ?? null };
  });

  app.delete<{ Params: { key: string } }>('/api/settings/:key', async (request, reply) => {
    const removed = app.repos.settings.remove(request.params.key);
    return reply.status(removed ? 204 : 404).send();
  });
}
