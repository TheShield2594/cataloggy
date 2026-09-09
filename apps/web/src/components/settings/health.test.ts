import { describe, expect, it } from "vitest";
import type { JobRun } from "../../api";
import {
  healthDotClass,
  healthSummary,
  jobsHealth,
  lastRunLabel,
  optionalKeyHealth,
  stremioHealth,
  tmdbHealth,
  traktHealth,
  type JobStatus,
} from "./health";

const timeAgo = () => "4m ago";
const run = (job: string, over: Partial<JobRun> = {}): JobRun => ({
  job,
  status: "ok",
  message: null,
  durationMs: 120,
  overran: false,
  at: "2026-09-09T13:00:00.000Z",
  ...over,
});
const jobs = (over: Partial<JobStatus> = {}): JobStatus => ({ failures: [], runs: [], ...over });

describe("healthDotClass", () => {
  it("gives an unconfigured source the plain dot, not a fault's colour", () => {
    expect(healthDotClass("idle")).toBe("status-dot");
    expect(healthDotClass("ok")).toBe("status-dot status-dot--ok");
    expect(healthDotClass("warn")).toBe("status-dot status-dot--warn");
    expect(healthDotClass("bad")).toBe("status-dot status-dot--bad");
  });
});

describe("traktHealth", () => {
  const connected = { connected: true, configured: true, expiresAt: "2027-01-01T00:00:00.000Z" };

  it("separates 'no credentials' from 'no account linked' — they need different fixes", () => {
    expect(traktHealth({ connected: false, configured: false, expiresAt: null }, null, timeAgo)).toEqual({
      tone: "idle",
      label: "Not set up",
    });
    expect(traktHealth({ connected: false, configured: true, expiresAt: null }, null, timeAgo)).toEqual({
      tone: "warn",
      label: "Not connected",
    });
  });

  it("calls an expired token what it is — the commonest reason history quietly stops", () => {
    expect(
      traktHealth({ ...connected, expiresAt: "2026-01-01T00:00:00.000Z" }, null, timeAgo)
    ).toEqual({ tone: "bad", label: "Token expired" });
  });

  it("reports when it last actually ran, not merely that it is connected", () => {
    expect(traktHealth(connected, jobs({ runs: [run("trakt-history-poll")] }), timeAgo)).toEqual({
      tone: "ok",
      label: "Synced 4m ago",
    });
  });

  it("says only 'Connected' for an account that has never synced", () => {
    expect(traktHealth(connected, jobs(), timeAgo)).toEqual({ tone: "ok", label: "Connected" });
  });

  it("lets a failing poll outrank a recorded success, which may predate it", () => {
    const status = jobs({
      runs: [run("trakt-history-poll")],
      failures: [{ job: "trakt-history-poll", message: "401", failedAt: "2026-09-09T13:05:00.000Z" }],
    });

    expect(traktHealth(connected, status, timeAgo)).toEqual({ tone: "bad", label: "Last sync failed" });
  });

  it("reports nothing rather than a fault when the status itself could not be read", () => {
    expect(traktHealth(null, null, timeAgo)).toEqual({ tone: "idle", label: "Not set up" });
  });
});

describe("stremioHealth", () => {
  const connected = { connected: true, email: "a@b.c", apiBase: null, connectedAt: null };

  it("is idle until an account is linked", () => {
    expect(stremioHealth(null, null, timeAgo)).toEqual({ tone: "idle", label: "Not connected" });
  });

  it("carries the last sync once one has happened", () => {
    expect(stremioHealth(connected, jobs({ runs: [run("stremio-library-sync")] }), timeAgo)).toEqual({
      tone: "ok",
      label: "Synced 4m ago",
    });
  });

  it("reports a failing sync rather than the success before it", () => {
    const status = jobs({ failures: [{ job: "stremio-library-sync", message: "boom", failedAt: "x" }] });

    expect(stremioHealth(connected, status, timeAgo)).toEqual({ tone: "bad", label: "Last sync failed" });
  });
});

describe("tmdbHealth", () => {
  it("treats a missing TMDB key as a fault, because the app is visibly broken without one", () => {
    expect(tmdbHealth(null)).toEqual({ tone: "warn", label: "No key — artwork is off" });
    expect(tmdbHealth({ configured: false, source: null })).toMatchObject({ tone: "warn" });
  });

  it("says where a configured key came from, since one of the two can't be edited here", () => {
    expect(tmdbHealth({ configured: true, source: "env" })).toEqual({ tone: "ok", label: "Key set (env)" });
    expect(tmdbHealth({ configured: true, source: "db" })).toEqual({ tone: "ok", label: "Key set" });
  });
});

describe("optionalKeyHealth", () => {
  it("is never a fault — these buy extra ratings and prettier posters, nothing more", () => {
    expect(optionalKeyHealth(false)).toEqual({ tone: "idle", label: "Not set" });
    expect(optionalKeyHealth(undefined)).toEqual({ tone: "idle", label: "Not set" });
    expect(optionalKeyHealth(true)).toEqual({ tone: "ok", label: "Key set" });
  });
});

describe("jobsHealth", () => {
  it("counts failures first", () => {
    const status = jobs({ failures: [{ job: "steam-sync", message: "x", failedAt: "y" }] });

    expect(jobsHealth(status)).toEqual({ tone: "bad", label: "1 failing" });
  });

  it("warns about a job running less often than configured, which no failure list can show", () => {
    expect(jobsHealth(jobs({ runs: [run("trakt-history-poll", { overran: true })] }))).toEqual({
      tone: "warn",
      label: "1 overrunning",
    });
  });

  it("is healthy when nothing failed and nothing overran", () => {
    expect(jobsHealth(jobs({ runs: [run("steam-sync")] }))).toEqual({ tone: "ok", label: "All healthy" });
  });

  it("admits it doesn't know when the request failed", () => {
    expect(jobsHealth(null)).toEqual({ tone: "idle", label: "Unknown" });
  });
});

describe("lastRunLabel", () => {
  it("is null for a job that has never been seen, which is not the same as one that just ran", () => {
    expect(lastRunLabel(jobs(), "trakt-history-poll", timeAgo)).toBeNull();
    expect(lastRunLabel(null, "trakt-history-poll", timeAgo)).toBeNull();
    expect(lastRunLabel(jobs({ runs: [run("trakt-history-poll")] }), "trakt-history-poll", timeAgo)).toBe("4m ago");
  });
});

describe("healthSummary", () => {
  it("counts only what has been set up, so the number is one a reader can act on", () => {
    expect(
      healthSummary({
        trakt: { tone: "ok", label: "Synced 4m ago" },
        tmdb: { tone: "warn", label: "No key" },
        omdb: { tone: "idle", label: "Not set" },
        rpdb: { tone: "idle", label: "Not set" },
      })
    ).toBe("1 of 2 sources healthy · 2 not set up");
  });

  it("leaves the unconfigured clause off when there is nothing to say", () => {
    expect(healthSummary({ trakt: { tone: "ok", label: "x" }, tmdb: { tone: "ok", label: "y" } })).toBe(
      "2 of 2 sources healthy"
    );
  });

  it("stays singular for one source", () => {
    expect(healthSummary({ trakt: { tone: "bad", label: "x" } })).toBe("0 of 1 source healthy");
  });

  it("says so plainly when nothing is connected at all", () => {
    expect(healthSummary({ omdb: { tone: "idle", label: "Not set" } })).toBe("Nothing connected yet");
  });

  it("says nothing at all before the statuses land", () => {
    expect(healthSummary({})).toBe("");
  });
});
