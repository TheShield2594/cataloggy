import type { FastifyPluginAsync } from "fastify";
import { checkDatabase } from "../lib/db-health.js";
import { getJobRuns } from "../lib/job-status.js";
import { metricsSnapshot } from "../lib/metrics.js";

// One place to look when something is wrong, behind `API_TOKEN` like every
// other non-probe route.
//
// It answers with JSON rather than the Prometheus text format on purpose: the
// most useful thing here is the last run of every background job, which is
// already structured (`lib/job-status.ts`, the same rows Settings → Sync Status
// reads) and does not flatten into counters without losing the error message
// that explains the failure. A self-hoster with `curl` and `jq` gets more from
// this than from a scrape they have nowhere to send.
// Prisma's errors carry a rendered source excerpt of the failing call, which is
// several hundred characters of context that belongs in the log this also
// writes, not in a field beside a row of counters.
const MAX_ERROR_LENGTH = 200;

const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metrics", async (request, reply) => {
    // Counters live in this process and change on every request, including the
    // one fetching them.
    reply.header("Cache-Control", "no-store");

    const database = await checkDatabase();

    // The job rows come from the database this endpoint just probed, so a
    // failure to read them is expected when it is down — and that is precisely
    // when someone is reading `/metrics`. Losing the rows must not lose the
    // counters, so it degrades to null rather than a 500.
    let jobs: Awaited<ReturnType<typeof getJobRuns>> | null = null;
    let jobsError: string | null = null;
    try {
      jobs = await getJobRuns();
    } catch (error) {
      jobsError = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
      request.log.warn(error, "Could not read background job status for /metrics");
    }

    const memory = process.memoryUsage();
    const snapshot = metricsSnapshot();

    return reply.send({
      // The counters are per-process and reset on restart, so they only mean
      // something read next to how long the process has been up.
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
      database,
      requests: snapshot.requests,
      upstream: snapshot.upstream,
      jobs,
      jobsError,
    });
  });
};

export default metricsRoutes;
