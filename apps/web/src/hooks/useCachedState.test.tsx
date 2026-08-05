import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCachedState } from "./useCachedState";
import { invalidate, readCache, setCacheScope, writeCache } from "../utils/dataCache";

function Counter({ cacheKey = "k" }: { cacheKey?: string }) {
  const [items, setItems, meta] = useCachedState<string[]>(cacheKey, []);
  return (
    <div>
      <span data-testid="items">{items.join(",") || "empty"}</span>
      <span data-testid="seeded">{meta.hadCachedValue ? "seeded" : "cold"}</span>
      <button type="button" onClick={() => setItems([...items, "direct"])}>direct</button>
      <button type="button" onClick={() => setItems((prev) => [...prev, "updater"])}>updater</button>
    </div>
  );
}

describe("useCachedState", () => {
  it("starts cold with the fallback when nothing is cached", () => {
    render(<Counter />);
    expect(screen.getByTestId("items")).toHaveTextContent("empty");
    expect(screen.getByTestId("seeded")).toHaveTextContent("cold");
  });

  it("paints a cached value in the very first render", () => {
    writeCache("k", ["from-cache"]);
    render(<Counter />);
    // Not after an effect, not a tick later — in the first commit. That frame is
    // the spinner this hook exists to remove.
    expect(screen.getByTestId("items")).toHaveTextContent("from-cache");
    expect(screen.getByTestId("seeded")).toHaveTextContent("seeded");
  });

  it("writes through, so unmounting and remounting keeps the data", async () => {
    const user = userEvent.setup();
    const first = render(<Counter />);
    await user.click(screen.getByRole("button", { name: "direct" }));
    expect(readCache<string[]>("k")).toEqual(["direct"]);

    first.unmount();
    render(<Counter />);
    expect(screen.getByTestId("items")).toHaveTextContent("direct");
  });

  it("accepts an updater function, the form the pages actually use", async () => {
    const user = userEvent.setup();
    render(<Counter />);
    await user.click(screen.getByRole("button", { name: "updater" }));
    await user.click(screen.getByRole("button", { name: "updater" }));
    expect(screen.getByTestId("items")).toHaveTextContent("updater,updater");
    expect(readCache<string[]>("k")).toEqual(["updater", "updater"]);
  });

  it("does not resurrect another profile's value after a scope change", () => {
    setCacheScope("profile-a");
    writeCache("k", ["a's list"]);
    setCacheScope("profile-b");

    render(<Counter />);
    expect(screen.getByTestId("items")).toHaveTextContent("empty");
  });

  it("holds its last value when a mutation invalidates the key", async () => {
    const user = userEvent.setup();
    render(<Counter />);
    await user.click(screen.getByRole("button", { name: "direct" }));

    // Invalidation clears the cache so the next read refetches; what is already
    // on screen stays, because blanking a page mid-mutation is worse than
    // showing data that is about to be replaced.
    invalidate("k");
    expect(readCache("k")).toBeUndefined();
    expect(screen.getByTestId("items")).toHaveTextContent("direct");
  });
});
