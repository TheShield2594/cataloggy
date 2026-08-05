import { useEffect, useRef, useState } from "react";
import { Check, Heart, ListPlus, Plus, X } from "lucide-react";
import { api, CatalogList, MediaType } from "../../api";

export function ListsSection({
  imdbId, type, name, initialListIds, onError, onToast,
}: {
  imdbId: string;
  type: MediaType;
  name: string;
  initialListIds: string[];
  onError?: (message: string) => void;
  onToast?: (message: string, type: "success" | "info") => void;
}) {
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [memberIds, setMemberIds] = useState<string[]>(initialListIds);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [savingNewList, setSavingNewList] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMemberIds(initialListIds);
  }, [imdbId, type]);

  useEffect(() => {
    let cancelled = false;
    api.getLists()
      .then((res) => { if (!cancelled) setLists(res.lists); })
      .catch(() => { /* best-effort */ })
      .finally(() => { if (!cancelled) setListsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  // Reset the inline create form whenever the menu closes.
  useEffect(() => {
    if (!menuOpen) { setCreating(false); setNewListName(""); }
  }, [menuOpen]);

  const createAndAdd = async () => {
    const listName = newListName.trim();
    if (!listName || savingNewList) return;
    setSavingNewList(true);
    // These are two separate backend calls; the list can be created even if adding
    // the item then fails. Report each step honestly and never discard a list that
    // was actually created (which would also tempt a retry into a duplicate list).
    let list: CatalogList;
    try {
      ({ list } = await api.createList(listName));
      setLists((prev) => [...prev, list]);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to create list");
      setSavingNewList(false);
      return;
    }
    try {
      await api.addToList(list.id, { type, imdbId, title: name });
      setMemberIds((ids) => [...ids, list.id]);
      onToast?.(`Created ${list.name} and added`, "success");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      onError?.(`Created ${list.name}, but couldn't add this title (${reason})`);
    } finally {
      setMenuOpen(false);
      setSavingNewList(false);
    }
  };

  const toggle = async (list: CatalogList) => {
    if (pending[list.id]) return;
    setPending((p) => ({ ...p, [list.id]: true }));
    const already = memberIds.includes(list.id);
    try {
      if (already) {
        await api.removeFromList(list.id, { type, imdbId });
        setMemberIds((ids) => ids.filter((id) => id !== list.id));
        onToast?.(`Removed from ${list.name}`, "info");
      } else {
        await api.addToList(list.id, { type, imdbId, title: name });
        setMemberIds((ids) => [...ids, list.id]);
        onToast?.(`Added to ${list.name}`, "success");
      }
      setMenuOpen(false);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to update list");
    } finally {
      setPending((p) => ({ ...p, [list.id]: false }));
    }
  };

  if (listsLoading) return <div className="skeleton h-8 w-40 rounded-full" />;

  const watchlist = lists.find((l) => l.kind === "watchlist");
  const inWatchlist = watchlist ? memberIds.includes(watchlist.id) : false;
  const memberLists = lists.filter((l) => memberIds.includes(l.id));
  // The watchlist already has its own dedicated chip/button above — don't repeat it in the generic menu.
  const otherLists = lists.filter((l) => l.kind !== "watchlist");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {memberLists.map((list) => (
        <button
          key={list.id}
          type="button"
          onClick={() => void toggle(list)}
          disabled={pending[list.id]}
          aria-label={`Remove from ${list.name}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
        >
          <Check className="h-3 w-3" />{list.name}
          <X className="h-3 w-3" />
        </button>
      ))}

      {watchlist && !inWatchlist && (
        <button
          type="button"
          onClick={() => void toggle(watchlist)}
          disabled={pending[watchlist.id]}
          aria-label={`Add ${name} to Watchlist`}
          className="inline-flex items-center gap-1.5 rounded-full bg-claw-500 px-3 py-1.5 text-xs font-semibold text-claw-on transition-colors hover:bg-claw-600 disabled:opacity-50"
        >
          <Heart className="h-3 w-3" /> Watchlist
        </button>
      )}

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:text-[var(--text)]"
          style={{ borderColor: "var(--border-strong)", color: "var(--text-dim)" }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <ListPlus className="h-3 w-3" /> Add to list
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Add to list"
            className="absolute left-0 z-30 mt-1 w-48 overflow-hidden rounded-xl shadow-e2"
            style={{ background: "var(--bg-0)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)" }}
          >
            {otherLists.length === 0 && !creating && (
              <p className="px-3 py-2.5 text-xs" style={{ color: "var(--text-mute)" }}>No lists yet — create one below.</p>
            )}
            {otherLists.map((list) => {
              const already = memberIds.includes(list.id);
              return (
                <button
                  key={list.id}
                  type="button"
                  role="menuitem"
                  disabled={pending[list.id]}
                  onClick={() => void toggle(list)}
                  aria-label={already ? `Remove from ${list.name}` : `Add to ${list.name}`}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--surface)] disabled:opacity-50"
                >
                  {already ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" style={{ color: "var(--text-mute)" }} />
                  )}
                  <span style={{ color: "var(--text-dim)" }}>{list.name}</span>
                  {already && <span className="ml-auto text-2xs" style={{ color: "var(--text-mute)" }}>Added</span>}
                </button>
              );
            })}
            {creating ? (
              <div
                className="flex items-center gap-2 px-3 py-2.5"
                style={{ borderTopWidth: otherLists.length > 0 ? 1 : 0, borderTopStyle: "solid", borderTopColor: "var(--border)" }}
              >
                <input
                  autoFocus
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void createAndAdd(); }
                    if (e.key === "Escape") {
                      // Stop the document-level Escape handler from closing the whole
                      // menu; Escape here should only back out of the create form.
                      e.stopPropagation();
                      setCreating(false);
                      setNewListName("");
                    }
                  }}
                  placeholder="List name..."
                  aria-label="New list name"
                  className="min-w-0 flex-1 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-claw-500/40"
                  style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)", background: "var(--bg-1)", color: "var(--text)" }}
                />
                <button
                  type="button"
                  disabled={!newListName.trim() || savingNewList}
                  onClick={() => void createAndAdd()}
                  className="btn-primary btn-xs flex-none"
                >
                  {savingNewList ? "…" : "Add"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-claw-text transition-colors hover:bg-[var(--surface)]"
                style={{ borderTopWidth: otherLists.length > 0 ? 1 : 0, borderTopStyle: "solid", borderTopColor: "var(--border)" }}
              >
                <Plus className="h-3.5 w-3.5" />
                Create new list
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
