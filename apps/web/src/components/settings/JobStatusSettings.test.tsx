import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatusSettings } from "./JobStatusSettings";

const getJobStatus = vi.fn();

vi.mock("../../api", () => ({ api: { getJobStatus: () => getJobStatus() } }));

const run = (overrides: Partial<{ job: string; status: string; message: string | null; durationMs: number | null; overran: boolean; at: string }>) => ({
  job: "steam-sync",
  status: "ok",
  message: null,
  durationMs: 1200,
  overran: false,
  at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  getJobStatus.mockReset().mockResolvedValue({ failures: [], runs: [] });
});

describe("JobStatusSettings", () => {
  it("says everything is healthy when nothing failed", async () => {
    render(<JobStatusSettings />);

    expect(await screen.findByText(/all scheduled jobs healthy/i)).toBeInTheDocument();
  });

  it("names the failing job and shows the error it failed with", async () => {
    getJobStatus.mockResolvedValue({
      failures: [{ job: "steam-sync", message: "Steam API returned 503", failedAt: "2026-01-01T00:00:00.000Z" }],
      runs: [run({ status: "failed", message: "Steam API returned 503" })],
    });

    render(<JobStatusSettings />);

    expect(await screen.findByText("Steam API returned 503")).toBeInTheDocument();
    expect(screen.getAllByText("Steam library sync").length).toBeGreaterThan(0);
    expect(screen.queryByText(/all scheduled jobs healthy/i)).not.toBeInTheDocument();
  });

  it("flags a job that outlasted its own interval, which no failure list can show", async () => {
    // Nothing failed — the scheduler dropped the tick this run collided with,
    // so the job is quietly running less often than it was configured to.
    getJobStatus.mockResolvedValue({
      runs: [run({ job: "trakt-history-poll", durationMs: 900_000, overran: true })],
      failures: [],
    });

    render(<JobStatusSettings />);

    expect(await screen.findByText(/took longer than its scheduled interval/i)).toBeInTheDocument();
    expect(screen.getAllByText(/15m/).length).toBeGreaterThan(0);
    // Still healthy: an overrun is not a failure.
    expect(screen.getByText(/all scheduled jobs healthy/i)).toBeInTheDocument();
  });

  it("lists how long each job's last run took", async () => {
    getJobStatus.mockResolvedValue({
      failures: [],
      runs: [run({ job: "scrobble-cleanup", durationMs: 40 }), run({ job: "steam-sync", durationMs: 65_000 })],
    });

    render(<JobStatusSettings />);

    expect(await screen.findByText(/40 ms/)).toBeInTheDocument();
    expect(screen.getByText(/1m 5s/)).toBeInTheDocument();
  });

  it("works against a server that has not been upgraded to report runs", async () => {
    getJobStatus.mockResolvedValue({ failures: [] });

    render(<JobStatusSettings />);

    expect(await screen.findByText(/all scheduled jobs healthy/i)).toBeInTheDocument();
  });

  it("surfaces a failure to load the status itself", async () => {
    getJobStatus.mockRejectedValue(new Error("Network request failed"));

    render(<JobStatusSettings />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Network request failed");
  });
});
