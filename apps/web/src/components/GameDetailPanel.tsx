import { useEffect, useRef, useState } from "react";
import { Check, Clock, Gamepad2, Star, Trash2, X } from "lucide-react";
import { api, Game } from "../api";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useScrollLock } from "../hooks/useScrollLock";
import { useEscapeKey } from "../hooks/useEscapeKey";

function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return "Not played yet";
  const hours = minutes / 60;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function GameStarRating({
  game,
  onChange,
  onError,
}: {
  game: Game;
  onChange: (game: Game) => void;
  onError: (message: string) => void;
}) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const handleRate = async (rating: number) => {
    if (saving) return;
    setSaving(true);
    try {
      const { game: updated } = await api.updateGame(game.id, { rating: game.rating === rating ? null : rating });
      onChange(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save rating");
    } finally {
      setSaving(false);
      setHoverRating(null);
    }
  };

  const displayRating = hoverRating ?? game.rating ?? 0;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
        <Star className="h-3.5 w-3.5" /> Your Rating <span className="font-normal">(1-10)</span>
      </h3>
      <div className="flex flex-wrap items-center gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => {
          const isFilled = game.rating !== null && star <= game.rating;
          const isPreview = star <= displayRating;
          return (
            <button
              key={star}
              type="button"
              disabled={saving}
              onClick={() => void handleRate(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(null)}
              className="relative flex p-0.5 disabled:opacity-50"
              aria-label={`Rate ${star} out of 10`}
              title={game.rating === star ? "Click again to remove your rating" : undefined}
            >
              <Star
                className={`h-5 w-5 transition-colors ${isPreview ? "fill-amber-400 text-amber-400" : ""}`}
                style={isPreview ? undefined : { color: "var(--text-mute)" }}
              />
              {isFilled && <span className="sr-only">(rated)</span>}
            </button>
          );
        })}
        <span className="ml-1 text-sm font-semibold text-amber-500">
          {hoverRating != null ? `${hoverRating}/10` : game.rating !== null ? `${game.rating}/10` : ""}
        </span>
      </div>
    </div>
  );
}

export function GameDetailPanel({
  game,
  onClose,
  onUpdated,
  onDeleted,
  onShowToast,
}: {
  game: Game;
  onClose: () => void;
  onUpdated: (game: Game) => void;
  onDeleted: (id: string) => void;
  onShowToast: (message: string, type: "success" | "error" | "info") => void;
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>();
  useScrollLock();
  useEscapeKey(onClose);

  const [notes, setNotes] = useState(game.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Bumped on every edit; a save's response is only applied if it's still the
  // latest one, so an earlier (slower) request can't clobber a newer draft with
  // stale data if responses arrive out of order.
  const notesVersionRef = useRef(0);
  const pendingNotesRef = useRef<string | null>(null);

  useEffect(() => {
    setNotes(game.notes ?? "");
  }, [game.id, game.notes]);

  const persistNotes = (value: string, { notifyOnSuccess }: { notifyOnSuccess: boolean }) => {
    const version = ++notesVersionRef.current;
    pendingNotesRef.current = null;
    void (async () => {
      try {
        const { game: updated } = await api.updateGame(game.id, { notes: value.trim() ? value : null });
        if (notifyOnSuccess && notesVersionRef.current === version) {
          onUpdated(updated);
        }
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : "Failed to save notes", "error");
      }
    })();
  };

  const saveNotes = (value: string) => {
    setNotes(value);
    pendingNotesRef.current = value;
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      persistNotes(value, { notifyOnSuccess: true });
    }, 600);
  };

  useEffect(() => () => {
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    // Flush a still-pending edit so closing the panel right after typing
    // doesn't silently drop it. Skips onUpdated (the panel is already gone by
    // the time this resolves — calling it would just reopen it).
    if (pendingNotesRef.current !== null) {
      persistNotes(pendingNotesRef.current, { notifyOnSuccess: false });
    }
  }, []);

  const toggleFinished = async () => {
    try {
      const { game: updated } = await api.updateGame(game.id, { finished: !game.finished });
      onUpdated(updated);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : "Failed to update finished status", "error");
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteGame(game.id);
      onDeleted(game.id);
      onShowToast(`Removed ${game.title}`, "success");
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : "Failed to remove game", "error");
    } finally {
      setDeleting(false);
    }
  };

  const releaseYear = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/70 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={game.title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full max-h-screen flex-col overflow-hidden shadow-feature sm:h-auto sm:max-h-[85vh] sm:max-w-3xl sm:flex-row sm:rounded-3xl sm:border"
        style={{ background: "var(--bg-0)", borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full shadow-lg backdrop-blur transition-colors hover:text-white"
          style={{ background: "color-mix(in srgb, var(--bg-0) 80%, transparent)", color: "var(--bg-2)" }}
          aria-label="Close detail panel"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative z-0 w-full flex-none overflow-hidden aspect-[2/3] max-h-[38vh] sm:aspect-[2/3] sm:max-h-none sm:w-[38%]">
          {game.coverUrl ? (
            <img src={game.coverUrl} alt={game.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ background: "linear-gradient(to bottom right, var(--bg-1), var(--bg-0))" }}>
              <Gamepad2 className="h-20 w-20" style={{ color: "var(--border-strong)" }} />
            </div>
          )}
        </div>

        <div className="-mt-10 relative z-20 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-10 sm:mt-0 sm:p-8">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 rounded-md bg-claw-500/90 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-claw-on">
                <Gamepad2 className="h-3 w-3" /> Game
              </span>
              {releaseYear && <span className="text-sm" style={{ color: "var(--text-mute)" }}>{releaseYear}</span>}
              {game.finished && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 ring-1 ring-emerald-500/20">
                  <Check className="h-3 w-3" /> Finished
                </span>
              )}
            </div>
            <h2 className="mt-3 font-heading text-2xl font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{game.title}</h2>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}>
                <Clock className="h-3 w-3" /> {formatPlaytime(game.playtimeMinutes)}
              </span>
              {game.genres.slice(0, 4).map((g) => (
                <span key={g} className="rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}>
                  {g}
                </span>
              ))}
            </div>
            {game.lastPlayedAt && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--text-dim)" }}>
                Last played <span style={{ color: "var(--text)" }}>{formatDate(game.lastPlayedAt)}</span>
              </p>
            )}
          </div>

          <GameStarRating game={game} onChange={onUpdated} onError={(msg) => onShowToast(msg, "error")} />

          <div>
            <label
              htmlFor="game-finished-toggle"
              className="flex items-center gap-2 text-sm font-medium"
              style={{ color: "var(--text-dim)" }}
            >
              <input
                id="game-finished-toggle"
                type="checkbox"
                checked={game.finished}
                onChange={() => void toggleFinished()}
                className="h-4 w-4 rounded"
              />
              Finished
              {game.finished && game.finishedAt && (
                <span className="text-xs" style={{ color: "var(--text-mute)" }}>on {formatDate(game.finishedAt)}</span>
              )}
            </label>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => saveNotes(e.target.value)}
              placeholder="Add personal notes about this game..."
              rows={4}
              className="w-full rounded-xl border p-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
            />
          </div>

          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: "var(--text-dim)" }}>Remove from library?</span>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? "Removing..." : "Confirm remove"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                  style={{ color: "var(--text-mute)" }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-rose-500 hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove from library
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
