/**
 * The watchlist, the collection, and every list the user made.
 */

import { request } from "./client";
import type {
  CatalogList,
  CatalogMeta,
  ItemListMembership,
  ListItemWithMeta,
  MediaType,
} from "./types";

export const listsApi = {
  getLists(signal?: AbortSignal) {
    return request<{ lists: CatalogList[] }>("/lists", { signal });
  },
  createList(name: string) {
    return request<{ list: CatalogList }>("/lists", {
      method: "POST",
      body: JSON.stringify({ name, kind: "custom" })
    });
  },
  deleteList(listId: string) {
    return request<void>(`/lists/${encodeURIComponent(listId)}`, { method: "DELETE" });
  },
  renameList(listId: string, name: string) {
    return request<{ list: CatalogList }>(`/lists/${encodeURIComponent(listId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  addToList(listId: string, payload: { type: MediaType; imdbId: string; title: string }) {
    const encodedListId = encodeURIComponent(listId);

    return request(`/lists/${encodedListId}/items`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  getListItems(listId: string, signal?: AbortSignal) {
    return request<{ items: ListItemWithMeta[] }>(
      `/lists/${encodeURIComponent(listId)}/items`,
      { signal }
    );
  },
  removeFromList(listId: string, item: { type: MediaType; imdbId: string }) {
    const encodedListId = encodeURIComponent(listId);
    const encodedImdbId = encodeURIComponent(item.imdbId);

    return request(`/lists/${encodedListId}/items/${item.type}/${encodedImdbId}`, {
      method: "DELETE"
    });
  },
  getItemLists(imdbId: string) {
    return request<{ lists: ItemListMembership[] }>(`/items/${encodeURIComponent(imdbId)}/lists`);
  },
  dashboard() {
    return Promise.all([
      request<{ metas: CatalogMeta[] }>("/watchlist?type=movie&limit=10"),
      request<{ metas: CatalogMeta[] }>("/continue?limit=10"),
      request<{ metas: CatalogMeta[] }>("/recent?type=movie&limit=10")
    ]);
  },
};
