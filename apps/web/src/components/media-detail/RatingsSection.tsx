import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { api, ApiError, MediaType, RatingType } from "../../api";
import { ImdbLogo, RtLogo, McIcon, TmdbLogo } from "./RatingLogos";
import { StarPicker } from "../StarPicker";
import { STARS_MAX } from "../../utils/rating";
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
  imdbId, type, season, episode, onError,
}: {
  imdbId: string;
  type: RatingType;
  /** Required for `season` and `episode` ratings; ignored otherwise. */
  season?: number;
  episode?: number;
  onError?: (message: string) => void;
}) {
  const [userRating, setUserRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canceledRef = useRef(false);

  const target = useMemo(() => ({ season, episode }), [season, episode]);

  const load = useCallback(async () => {
    try {
      const res = await api.getRating(type, imdbId, target);
      if (!canceledRef.current) setUserRating(res.rating.rating);
    } catch (err) {
      if (!canceledRef.current) {
        // A title you haven't rated is the common case, not a failure.
        if (err instanceof ApiError && err.status === 404) setUserRating(null);
        else setLoadError(err instanceof Error ? err.message : "Failed to load rating");
      }
    } finally {
      if (!canceledRef.current) setLoaded(true);
    }
  }, [type, imdbId, target]);

  useEffect(() => {
    setUserRating(null); setLoaded(false); setLoadError(null);
    canceledRef.current = false;
    void load();
    return () => { canceledRef.current = true; };
  }, [load]);

  const handleRate = async (rating: number) => {
    if (saving) return;
    setSaving(true);
    try {
      if (userRating === rating) {
        await api.deleteRating(type, imdbId, target);
        setUserRating(null);
      } else {
        const res = await api.setRating(imdbId, type, rating, target);
        setUserRating(res.rating.rating);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to save rating");
    } finally {
      setSaving(false);
    }
  };

  const retryLoadRating = useCallback(() => {
    setLoadError(null); setLoaded(false);
    void load();
  }, [load]);

  if (!loaded) return <div className="skeleton h-8 w-40 rounded-lg" />;

  return (
    <div>
      <h3 className={`mb-2 flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
        <Star className="h-3.5 w-3.5" /> Your Rating <span className="font-normal">(out of {STARS_MAX})</span>
      </h3>
      <StarPicker value={userRating} onRate={(value) => void handleRate(value)} disabled={saving} />
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
