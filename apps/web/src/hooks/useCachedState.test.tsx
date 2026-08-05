import { useState } from "react";
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

  it("rehydrates when the key changes without a remount", async () => {
    // The calendar keys on its day range and the games page on its sort order,
    // so the key moves while the component stays mounted. `useState`'s
    // initialiser only runs once, so without an explicit re-read the hook would
    // keep serving the previous key's value under the new key's name.
    writeCache("games:recent", ["recent game"]);
    writeCache("games:title", ["title game"]);

    function Switcher() {
      const [sort, setSort] = useState("recent");
      const [items] = useCachedState<string[]>(`games:${sort}`, []);
      return (
        <div>
          <span data-testid="items">{items.join(",") || "empty"}</span>
          <button type="button" onClick={() => setSort("title")}>by title</button>
          <button type="button" onClick={() => setSort("recent")}>by recent</button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Switcher />);
    expect(screen.getByTestId("items")).toHaveTextContent("recent game");

    await user.click(screen.getByRole("button", { name: "by title" }));
    expect(screen.getByTestId("items")).toHaveTextContent("title game");

    await user.click(screen.getByRole("button", { name: "by recent" }));
    expect(screen.getByTestId("items")).toHaveTextContent("recent game");
  });

  it("falls back rather than carrying the old key's value into an uncached one", async () => {
    writeCache("games:recent", ["recent game"]);

    function Switcher() {
      const [sort, setSort] = useState("recent");
      const [items] = useCachedState<string[]>(`games:${sort}`, []);
      return (
        <div>
          <span data-testid="items">{items.join(",") || "empty"}</span>
          <button type="button" onClick={() => setSort("added")}>by added</button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Switcher />);
    await user.click(screen.getByRole("button", { name: "by added" }));

    // Nothing cached for this sort — showing the previous sort's list here would
    // be worse than an empty one, because it looks like a real answer.
    expect(screen.getByTestId("items")).toHaveTextContent("empty");
  });

  it("writes each key separately when a switching component saves", async () => {
    function Switcher() {
      const [sort, setSort] = useState("recent");
      const [items, setItems] = useCachedState<string[]>(`games:${sort}`, []);
      return (
        <div>
          <span data-testid="items">{items.join(",") || "empty"}</span>
          <button type="button" onClick={() => setItems([`${sort} result`])}>save</button>
          <button type="button" onClick={() => setSort("title")}>by title</button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Switcher />);
    await user.click(screen.getByRole("button", { name: "save" }));
    await user.click(screen.getByRole("button", { name: "by title" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    // A setter bound to the first key would have filed both under `games:recent`.
    expect(readCache<string[]>("games:recent")).toEqual(["recent result"]);
    expect(readCache<string[]>("games:title")).toEqual(["title result"]);
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
