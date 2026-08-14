import { afterEach, vi } from "vitest";
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyServerOptions,
} from "fastify";
import {
  isSchemaValidationError,
  registerRequestSchemas,
  requestSchemaOptions,
} from "../request-schema.js";

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
  loadPlugin: () => Promise<{ default: FastifyPluginAsync }>,
  // A couple of suites need a non-default `bodyLimit` to exercise the 413 path.
  options: FastifyServerOptions = {}
): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: routes } = await loadPlugin();
  const app = Fastify({ logger: false, ...requestSchemaOptions, ...options });
  // The same two lines index.ts wires, so a schema-validated route answers a
  // test the way it answers a real caller.
  registerRequestSchemas(app);
  app.setErrorHandler((error, _request, reply) =>
    isSchemaValidationError(error) ? reply.code(400).send({ error: error.message }) : reply.send(error)
  );
  await app.register(routes);
  await app.ready();
  openApps.add(app);
  return app;
};
