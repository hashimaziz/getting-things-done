/**
 * System-level routes.
 *
 * Currently one: wiping every row of user data so the application returns to its
 * first-run state. This exists because the alternative is deleting the database file by
 * hand, which also takes the directory, the WAL files and any chance of recovery —
 * destroying more than intended and leaving nothing behind to reason about.
 *
 * The endpoint is deliberately hard to hit by accident. It requires the confirmation
 * phrase in the request body, and the preview endpoint exists so a person can be told
 * what they are about to lose before being asked to confirm it. "This will delete 412
 * items" is meaningfully different from a button labelled "reset".
 */

import { WIPE_CONFIRMATION, previewWipe, wipeAllData } from '@gtd/db';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../http-errors.js';

const wipeSchema = z.object({
  /**
   * Must match the phrase exactly.
   *
   * Not a boolean and not a `force` flag. A flag is something a stale script or a
   * hopeful retry can send; a phrase someone has to type is a deliberate act. This is
   * the difference between a reset and an accident.
   */
  confirm: z.literal(WIPE_CONFIRMATION),
});

export function registerSystemRoutes(app: FastifyInstance): void {
  /** What a wipe would remove. Read-only, so it is safe to call and poll. */
  app.get('/api/system/wipe/preview', async () => {
    return {
      confirmation: WIPE_CONFIRMATION,
      tables: previewWipe(app.db),
      total: previewWipe(app.db).reduce((sum, entry) => sum + entry.rows, 0),
    };
  });

  app.post('/api/system/wipe', async (request, reply) => {
    const parsed = wipeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new BadRequestError(`A wipe requires the confirmation phrase "${WIPE_CONFIRMATION}".`);
    }

    const report = wipeAllData(app.db);

    /*
     * The preview is taken again afterwards so the response can say what is left,
     * which should be nothing. If anything remains, the wipe did not do what it claims
     * and the caller should be able to see that rather than discover it later.
     */
    const remaining = previewWipe(app.db).reduce((sum, entry) => sum + entry.rows, 0);

    return reply.status(200).send({
      wiped: report.totalRemoved,
      tables: report.tables,
      remaining,
      elapsedMs: report.elapsedMs,
    });
  });
}
