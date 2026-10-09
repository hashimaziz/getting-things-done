/**
 * API server entry point.
 *
 * Binds to loopback by default. This app is single-user and local, and the data
 * is personal, so it should not be reachable from the network without an
 * explicit decision to change that.
 */

import { APP_CONFIG } from '@gtd/core';
import { bootstrap, describePaths } from '@gtd/db';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const host = process.env.GTD_HOST ?? APP_CONFIG.defaults.apiHost;
  const port = Number(process.env.GTD_PORT ?? APP_CONFIG.defaults.apiPort);

  const { db, paths, migrations } = bootstrap({ strictMigrations: true });

  if (migrations.applied.length > 0) {
    console.log(
      `[gtd] applied ${migrations.applied.length} migration(s); schema at v${migrations.version}`,
    );
  }
  console.log(`[gtd] database ${describePaths(paths)}`);

  const app = await buildApp({ db, logger: true });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[gtd] ${signal} received, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host, port });
  console.log(`[gtd] API listening on http://${host}:${port}`);
}

main().catch((error: unknown) => {
  console.error('[gtd] failed to start:', error);
  process.exit(1);
});
