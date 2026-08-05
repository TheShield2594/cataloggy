import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "./App";
import { runtimeConfig } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, getProfiles: vi.fn().mockResolvedValue({ profiles: [] }) },
  };
});

// The dashboard is the landing route and fires a page's worth of requests on
// mount; this suite is only about what the top bar renders around it.
vi.mock("./pages/DashboardPage", () => ({ DashboardPage: () => <p>dashboard</p> }));

vi.mock("./utils/routePrefetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/routePrefetch")>();
  return {
    ...actual,
    loadSearchPage: () => Promise.resolve({ SearchPage: () => <p>search page</p> }),
    schedulePrefetchOnIdle: () => {},
  };
});

beforeEach(() => {
  // Past the setup wizard and the profile picker, which otherwise render
  // instead of the shell.
  window.localStorage.setItem(runtimeConfig.tokenKey, "test-token");
  window.localStorage.setItem(runtimeConfig.profileIdKey, "profile-1");
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

const headerSearch = () => screen.queryByRole("button", { name: "Search (⌘K)" });

describe("top bar search", () => {
  it("offers the palette trigger on a route with no search field of its own", async () => {
    renderAt("/");

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(headerSearch()).toBeInTheDocument();
  });

  it("stands down on the search page, which has its own field", async () => {
    renderAt("/search");

    expect(await screen.findByText("search page")).toBeInTheDocument();
    expect(headerSearch()).not.toBeInTheDocument();
  });
});
