import { afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";

/**
 * Builds a Fastify instance carrying one route plugin, and closes it after the
 * test regardless of how the test ended.
 *
 * Closing at the end of a test body — the pattern the older route tests use —
 * is skipped when an assertion throws, so a failing test leaves its instance
 * open. Tracking them here and closing in `afterEach` means a failure reports
 * the assertion rather than the assertion plus whatever the leaked instance
 * does next.
 *
 * The plugin is imported through a callback so `vi.resetModules()` can run
 * first, which is what lets each test see the mock state set up for it.
 */
const openApps = new Set<FastifyInstance>();

afterEach(async () => {
  for (const app of openApps) await app.close();
  openApps.clear();
});

export const buildRouteApp = async (
  loadPlugin: () => Promise<{ default: FastifyPluginAsync }>
): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: routes } = await loadPlugin();
  const app = Fastify({ logger: false });
  await app.register(routes);
  await app.ready();
  openApps.add(app);
  return app;
};
