import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Waiting on the service worker's cache invalidation.
 *
 * This wait sits on the path of every mutation the app makes, and it is not
 * decorative: the worker's API cache is stale-while-revalidate, so a refetch
 * that beats the delete is served the very response the mutation invalidated
 * and says nothing about it. What it must not do is wait on a worker that is
 * never going to answer — a build predating the ack handshake made every
 * "Add to list" hold its spinner for a full second after the server had already
 * replied.
 *
 * Its own file because the module remembers, across calls, whether the
 * controlling worker answers — so each case needs a fresh import of `api.ts`.
 */

type Controller = { postMessage: ReturnType<typeof vi.fn> };

/** A worker that replies on the port it is handed. */
const ackingController = (): Controller => ({
  postMessage: vi.fn((_message: unknown, transfer: MessagePort[]) => {
    transfer[0].postMessage({ done: true });
  }),
});

/** A worker from before the handshake existed: it does the work, silently. */
const silentController = (): Controller => ({ postMessage: vi.fn() });

function installController(controller: Controller | null) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller, addEventListener: vi.fn(), getRegistration: vi.fn() },
  });
}

async function loadApi() {
  vi.resetModules();
  return import("./api");
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

/** Resolved-ness of a promise, without awaiting one that may never settle. */
function track(promise: Promise<unknown>) {
  const state = { settled: false };
  void promise.then(() => { state.settled = true; });
  return state;
}

describe("notifyServiceWorkerToInvalidateApiCache", () => {
  // Real timers, alone among these: jsdom delivers a MessagePort message on a
  // task the fake clock doesn't drive, so an acking worker can only be observed
  // acking on the real one. Ten milliseconds is nowhere near the 200ms fallback,
  // which is what makes this the ack rather than the giving-up.
  it("waits for the worker's ack, so a refetch can't be served the stale answer", async () => {
    installController(ackingController());
    const { notifyServiceWorkerToInvalidateApiCache } = await loadApi();

    const waiting = track(notifyServiceWorkerToInvalidateApiCache());
    expect(waiting.settled).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(waiting.settled).toBe(true);
  });

  it("gives up on a worker that doesn't answer, and stops waiting on it after that", async () => {
    vi.useFakeTimers();
    installController(silentController());
    const { notifyServiceWorkerToInvalidateApiCache } = await loadApi();

    const first = track(notifyServiceWorkerToInvalidateApiCache());
    await vi.advanceTimersByTimeAsync(199);
    expect(first.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.settled).toBe(true);

    // Every mutation after the first pays nothing: the message still goes out,
    // there is just no longer anything to wait for.
    const second = track(notifyServiceWorkerToInvalidateApiCache());
    await vi.advanceTimersByTimeAsync(0);
    expect(second.settled).toBe(true);
  });

  it("doesn't let a replaced worker's timeout mark its replacement silent", async () => {
    // The 200ms after an update takes over. A timeout armed for the outgoing
    // worker fires once the new one is already in control, and a single shared
    // flag has no way to tell that the verdict it is writing is about a worker
    // nobody will ask again — so it switched the wait off for the arriving
    // build, which is the one that can answer it.
    vi.useFakeTimers();
    installController(silentController());
    const { notifyServiceWorkerToInvalidateApiCache } = await loadApi();

    const first = track(notifyServiceWorkerToInvalidateApiCache());
    installController(silentController());
    await vi.advanceTimersByTimeAsync(200);
    expect(first.settled).toBe(true);

    // Never asked, so it gets the full budget rather than the previous
    // worker's verdict.
    const second = track(notifyServiceWorkerToInvalidateApiCache());
    await vi.advanceTimersByTimeAsync(199);
    expect(second.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(second.settled).toBe(true);
  });

  it("keeps sending the message to a worker it has stopped waiting on", async () => {
    vi.useFakeTimers();
    const controller = silentController();
    installController(controller);
    const { notifyServiceWorkerToInvalidateApiCache } = await loadApi();

    await vi.advanceTimersByTimeAsync(200);
    void notifyServiceWorkerToInvalidateApiCache();
    await vi.advanceTimersByTimeAsync(200);
    void notifyServiceWorkerToInvalidateApiCache();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.postMessage).toHaveBeenCalledTimes(2);
    expect(controller.postMessage.mock.calls[0][0]).toEqual({ type: "INVALIDATE_API_CACHE" });
  });

  it("does nothing at all when no worker controls the page", async () => {
    vi.useFakeTimers();
    installController(null);
    const { notifyServiceWorkerToInvalidateApiCache } = await loadApi();

    const waiting = track(notifyServiceWorkerToInvalidateApiCache());
    await vi.advanceTimersByTimeAsync(0);

    expect(waiting.settled).toBe(true);
  });

  it("does not hold a mutation open behind a silent worker for a second", async () => {
    vi.useFakeTimers();
    installController(silentController());
    const { api } = await loadApi();

    const marking = track(api.markEpisodeWatched("tt1", 2, 3));
    await vi.advanceTimersByTimeAsync(200);

    expect(marking.settled).toBe(true);
  });
});
