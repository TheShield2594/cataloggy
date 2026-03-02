const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:7000";
const TOKEN_KEY = "cataloggy_token";

export type MediaType = "movie" | "series";

export type SearchResult = {
  imdbId: string;
  type: MediaType;
  name: string;
  year: number | null;
  poster: string | null;
};

export type ListItem = {
  listId: string;
  type: MediaType;
  imdbId: string;
  addedAt: string;
};

export type CatalogList = {
  id: string;
  name: string;
  kind: "watchlist" | "custom";
  items: ListItem[];
};

export type CatalogMeta = {
  id: string;
  type: MediaType;
  name: string;
};

const authHeaders = () => {
  const token = window.localStorage.getItem(TOKEN_KEY) ?? "";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  search(type: MediaType, query: string) {
    return request<SearchResult[]>(`/search?type=${type}&query=${encodeURIComponent(query)}`);
  },
  getLists() {
    return request<{ lists: CatalogList[] }>("/lists");
  },
  createList(name: string) {
    return request<{ list: CatalogList }>("/lists", {
      method: "POST",
      body: JSON.stringify({ name, kind: "custom" })
    });
  },
  addToList(listId: string, payload: { type: MediaType; imdbId: string; title: string }) {
    return request(`/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  removeFromList(listId: string, item: { type: MediaType; imdbId: string }) {
    return request(`/lists/${listId}/items/${item.type}/${item.imdbId}`, {
      method: "DELETE"
    });
  },
  dashboard() {
    return Promise.all([
      request<{ metas: CatalogMeta[] }>("/stremio/catalog/my_watchlist_movies?limit=10"),
      request<{ metas: CatalogMeta[] }>("/stremio/catalog/my_continue_series?limit=10"),
      request<{ metas: CatalogMeta[] }>("/stremio/catalog/my_recent_movies?limit=10")
    ]);
  }
};
