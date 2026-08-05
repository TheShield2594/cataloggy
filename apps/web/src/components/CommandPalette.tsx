import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BarChart3, CalendarDays, Clapperboard, Film, Gamepad2, List, Search, Settings, Tv } from "lucide-react";
import { api, SearchResult } from "../api";
import { Poster } from "./Poster";
import { DetailPanel, useDetailPanel } from "./MediaDetailPanel";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useToast } from "../hooks/useToast";

type Action = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  run: () => void;
};

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  // Escape is deliberately not handled here — CommandPalette registers it with
  // useEscapeKey so the palette takes its place in the layer stack instead of
  // closing alongside whatever is on top of it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const { showToast } = useToast();
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading, detail: panelDetail, detailLoading: panelDetailLoading } = useDetailPanel();

  // Bottom of the stack relative to any DetailPanel opened from a result, so
  // Escape closes the panel back to the palette rather than both at once.
  useEscapeKey(onClose, open);

  // Arrowing past the fold of the max-h-[60vh] scroller would otherwise move
  // the highlight somewhere the user can't see. "nearest" makes this a no-op
  // when the row is already visible, so mouse hover doesn't yank the list.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const [movies, series] = await Promise.all([
            api.search("movie", query),
            api.search("series", query),
          ]);
          const merged: SearchResult[] = [];
          const maxLen = Math.max(movies.length, series.length);
          for (let i = 0; i < maxLen && merged.length < 8; i++) {
            if (i < movies.length) merged.push(movies[i]);
            if (i < series.length) merged.push(series[i]);
          }
          setResults(merged.slice(0, 8));
        } catch {
          setResults([]);
          setSearchError(true);
        } finally {
          setSearching(false);
        }
      })();
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const goToSearch = useCallback((q: string) => {
    onClose();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }, [navigate, onClose]);

  const openDetail = useCallback((r: SearchResult) => {
    setSelectedItem(r);
  }, [setSelectedItem]);

  const actions: Action[] = [
    { id: "nav-dashboard", label: "Go to Dashboard", icon: Clapperboard, run: () => { onClose(); navigate("/"); } },
    { id: "nav-search", label: "Go to Search", icon: Search, run: () => { onClose(); navigate("/search"); } },
    { id: "nav-lists", label: "Go to Lists", icon: List, run: () => { onClose(); navigate("/lists"); } },
    { id: "nav-games", label: "Go to Games", icon: Gamepad2, run: () => { onClose(); navigate("/games"); } },
    { id: "nav-calendar", label: "Go to Calendar", icon: CalendarDays, run: () => { onClose(); navigate("/calendar"); } },
    { id: "nav-stats", label: "Go to Stats", icon: BarChart3, run: () => { onClose(); navigate("/stats"); } },
    { id: "nav-settings", label: "Go to Settings", icon: Settings, run: () => { onClose(); navigate("/settings"); } },
  ];

  const visibleActions = query.trim()
    ? actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : actions;

  const totalItems = results.length + visibleActions.length;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < results.length) {
        const r = results[activeIndex];
        if (r) openDetail(r);
      } else {
        const action = visibleActions[activeIndex - results.length];
        if (action) action.run();
        else if (query.trim()) goToSearch(query);
      }
    }
  };

  if (!open && !selectedItem) return null;

  if (selectedItem) {
    return (
      <DetailPanel
        item={selectedItem}
        history={panelHistory}
        historyLoading={panelHistoryLoading}
        detail={panelDetail}
        detailLoading={panelDetailLoading}
        // Drops back to the palette rather than dismissing both layers — the
        // palette keeps its query and results, so the next title is one click away.
        onClose={() => setSelectedItem(null)}
        onShowToast={showToast}
        onHistoryChange={(events) => setPanelHistory(events)}
        onSelectItem={setSelectedItem}
      />
    );
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="glass-surface relative w-full max-w-lg overflow-hidden rounded-2xl shadow-feature"
        style={{ background: "var(--bg-0)", border: "1px solid var(--border-strong)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <Search className="h-4 w-4 flex-none" style={{ color: "var(--text-mute)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search everything..."
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--text)" }}
            aria-label="Search everything"
          />
          <kbd
            className="rounded px-1.5 py-0.5 text-2xs font-medium"
            style={{ background: "var(--surface-strong)", color: "var(--text-mute)" }}
          >
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {searching && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--text-dim)" }}>Searching...</p>
          )}

          {!searching && searchError && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--text-dim)" }}>
              Search is unavailable right now. Check your TMDB configuration in Settings.
            </p>
          )}

          {!searching && !searchError && query.trim() && results.length === 0 && visibleActions.length === 0 && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--text-dim)" }}>No results for "{query}".</p>
          )}

          {!searching && results.length > 0 && (
            <div className="px-2 pb-2">
              <p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
                Titles
              </p>
              {results.map((r, i) => (
                <button
                  key={r.imdbId}
                  ref={activeIndex === i ? activeRowRef : undefined}
                  type="button"
                  onClick={() => openDetail(r)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors"
                  style={{ background: activeIndex === i ? "var(--surface-strong)" : "transparent" }}
                >
                  <div className="h-9 w-7 flex-none overflow-hidden rounded" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
                    <Poster src={r.poster ?? undefined} alt={r.name} className="h-full w-full" sizes="28px" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{r.name}</p>
                    <p className="text-2xs" style={{ color: "var(--text-mute)" }}>
                      {r.year ?? ""} {r.type === "movie" ? <Film className="inline h-3 w-3" /> : <Tv className="inline h-3 w-3" />}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="px-2">
            {visibleActions.length > 0 && (
              <p className="px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
                Navigate
              </p>
            )}
            {visibleActions.map((action, i) => {
              const idx = results.length + i;
              return (
                <button
                  key={action.id}
                  ref={activeIndex === idx ? activeRowRef : undefined}
                  type="button"
                  onClick={action.run}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
                  style={{ background: activeIndex === idx ? "var(--surface-strong)" : "transparent" }}
                >
                  <action.icon className="h-4 w-4 flex-none" style={{ color: "var(--text-dim)" }} />
                  <span className="text-sm" style={{ color: "var(--text)" }}>{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
