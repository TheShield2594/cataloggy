import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { api, ApiError, MediaType } from "../../api";
import { ImdbLogo, RtLogo, McIcon, TmdbLogo } from "./RatingLogos";
import { KICKER } from "../typography";

export function ExternalLinks({
  imdbId, tmdbId, type,
}: {
  imdbId: string;
  tmdbId: number | null | undefined;
  type: MediaType;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-opacity hover:opacity-80"
        style={{ color: "var(--text-dim)" }}
        aria-label="View on IMDb"
      >
        <ImdbLogo />
        <ExternalLink className="h-3 w-3" />
      </a>
      {tmdbId != null && (
        <a
          href={`https://www.themoviedb.org/${type === "movie" ? "movie" : "tv"}/${tmdbId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-opacity hover:opacity-80"
          style={{ color: "var(--text-dim)" }}
          aria-label="View on TMDB"
        >
          <TmdbLogo />
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

export function ExternalRatings({
  imdbRating, rtScore, mcScore, loading = false,
}: {
  imdbRating: number | null | undefined;
  rtScore: number | null | undefined;
  mcScore: number | null | undefined;
  /** True while the detail bundle that may enrich these scores is in flight. */
  loading?: boolean;
}) {
  if (imdbRating == null && rtScore == null && mcScore == null) {
    // Scores often arrive with the detail bundle rather than on the item
    // itself; hold the row's space instead of springing it open mid-read.
    if (!loading) return null;
    return (
      <div>
        <h3 className={`mb-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>Ratings</h3>
        <div className="flex flex-wrap items-center gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-5 w-16 rounded" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className={`mb-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>Ratings</h3>
      <div className="flex flex-wrap items-center gap-4">
        {imdbRating != null && (
          <div className="flex items-center gap-1.5">
            <ImdbLogo />
            <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{imdbRating.toFixed(1)}</span>
            <span className="text-xs" style={{ color: "var(--text-mute)" }}>/10</span>
          </div>
        )}
        {rtScore != null && (
          <div className="flex items-center gap-1.5">
            <RtLogo score={rtScore} />
            <span className={`text-sm font-semibold ${rtScore >= 60 ? "text-green-600" : "text-rose-500"}`}>{rtScore}%</span>
          </div>
        )}
        {mcScore != null && (
          <div className="flex items-center gap-1.5">
            <McIcon score={mcScore} />
            <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{mcScore}</span>
            <span className="text-xs" style={{ color: "var(--text-mute)" }}>/100</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function StarRating({
  imdbId, type, onError,
}: {
  imdbId: string; type: MediaType; onError?: (message: string) => void;
}) {
  const [userRating, setUserRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canceledRef = useRef(false);

  useEffect(() => {
    setUserRating(null); setHoverRating(null); setLoaded(false); setLoadError(null);
    canceledRef.current = false;
    void (async () => {
      try {
        const res = await api.getRating(type, imdbId);
        if (!canceledRef.current) setUserRating(res.rating.rating);
      } catch (err) {
        if (!canceledRef.current) {
          if (!(err instanceof ApiError && err.status === 404)) {
            setLoadError(err instanceof Error ? err.message : "Failed to load rating");
          }
        }
      } finally {
        if (!canceledRef.current) setLoaded(true);
      }
    })();
    return () => { canceledRef.current = true; };
  }, [imdbId, type]);

  const handleRate = async (rating: number) => {
    if (saving) return;
    if (userRating === rating) {
      setSaving(true);
      try { await api.deleteRating(type, imdbId); setUserRating(null); setHoverRating(null); }
      catch (err) { onError?.(err instanceof Error ? err.message : "Failed to remove rating"); }
      finally { setSaving(false); }
      return;
    }
    setSaving(true);
    try { const res = await api.setRating(imdbId, type, rating); setUserRating(res.rating.rating); setHoverRating(null); }
    catch (err) { onError?.(err instanceof Error ? err.message : "Failed to save rating"); }
    finally { setSaving(false); }
  };

  const retryLoadRating = useCallback(() => {
    setLoadError(null); setLoaded(false);
    void (async () => {
      try {
        const res = await api.getRating(type, imdbId);
        if (!canceledRef.current) setUserRating(res.rating.rating);
      } catch (err) {
        if (!canceledRef.current && !(err instanceof ApiError && err.status === 404)) {
          setLoadError(err instanceof Error ? err.message : "Failed to load rating");
        }
      } finally {
        if (!canceledRef.current) setLoaded(true);
      }
    })();
  }, [imdbId, type]);

  if (!loaded) return <div className="skeleton h-8 w-40 rounded-lg" />;

  const displayRating = hoverRating ?? userRating ?? 0;
  const groups: number[][] = [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]];
  return (
    <div>
      <h3 className={`mb-2 flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
        <Star className="h-3.5 w-3.5" /> Your Rating <span className="font-normal">(1-10)</span>
      </h3>
      <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-0 sm:gap-0.5">
            {group.map((star) => {
              const isFilled = userRating !== null && star <= userRating;
              const isPreview = star <= displayRating;
              const isCurrentRating = userRating === star;
              return (
                <button
                  key={star} type="button" disabled={saving}
                  onClick={() => void handleRate(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(null)}
                  onFocus={() => setHoverRating(star)}
                  onBlur={() => setHoverRating(null)}
                  className="relative flex flex-col items-center gap-0.5 p-0.5 before:absolute before:inset-[-4px] before:content-[''] disabled:opacity-50 sm:p-1"
                  // The current rating's button does the opposite of every
                  // other one — it clears the rating — and `title` is the only
                  // place that said so, which a screen reader may never
                  // announce and a touch user never sees at all.
                  aria-label={isCurrentRating ? `Your rating: ${star} out of 10. Activate to remove it` : `Rate ${star} out of 10`}
                  aria-pressed={isCurrentRating}
                  title={isCurrentRating ? "Click again to remove your rating" : undefined}
                >
                  <span className="relative grid h-5 w-5 place-items-center sm:h-7 sm:w-7">
                    <Star
                      className={`absolute h-5 w-5 transition-colors duration-slow sm:h-7 sm:w-7 ${isPreview ? "text-amber-400" : ""}`}
                      style={isPreview ? undefined : { color: "var(--text-mute)" }}
                    />
                    {/* Gated on the preview as well as the commit, so hovering
                        below a saved rating actually previews the lower score —
                        on `isFilled` alone the stars above the pointer stayed
                        solid and nothing showed what the click would do.
                        `star-pop` stays tied to `isFilled` so the pop plays when
                        a rating is committed, not every time the pointer
                        leaves. */}
                    <Star
                      className={`star-shake-target absolute h-5 w-5 fill-amber-400 text-amber-400 transition-opacity duration-slow sm:h-7 sm:w-7 ${isFilled ? "star-pop" : ""} ${isFilled && isPreview ? "opacity-100" : "opacity-0"}`}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <span className="ml-1 text-xs font-semibold text-amber-500 sm:text-sm">
          {hoverRating != null ? `Rating: ${hoverRating}/10` : userRating !== null ? `${userRating}/10` : ""}
        </span>
      </div>
      {userRating !== null && (
        <p className="mt-1 text-2xs" style={{ color: "var(--text-mute)" }}>Click your current rating again to remove it.</p>
      )}
      {loadError && (
        <p className="mt-1 flex items-center gap-2 text-xs text-rose-400">
          {loadError}
          <button type="button" onClick={retryLoadRating} className="underline hover:text-rose-300">Retry</button>
        </p>
      )}
    </div>
  );
}
