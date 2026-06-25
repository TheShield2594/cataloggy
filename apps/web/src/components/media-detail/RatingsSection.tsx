import { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { api, ApiError, MediaType } from "../../api";
import { ImdbLogo, RtLogo, McIcon } from "./RatingLogos";

export function ExternalRatings({
  imdbRating, rtScore, mcScore,
}: {
  imdbRating: number | null | undefined;
  rtScore: number | null | undefined;
  mcScore: number | null | undefined;
}) {
  if (imdbRating == null && rtScore == null && mcScore == null) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>Ratings</h3>
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
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
        <Star className="h-3.5 w-3.5" /> Your Rating
      </h3>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
          const isFilled = userRating !== null && star <= userRating;
          const isPreview = star <= displayRating;
          return (
            <button
              key={star} type="button" disabled={saving}
              onClick={() => void handleRate(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(null)}
              onFocus={() => setHoverRating(star)}
              onBlur={() => setHoverRating(null)}
              className="flex flex-col items-center gap-0.5 p-0.5 disabled:opacity-50"
              aria-label={`Rate ${star} out of 10`}
            >
              <span className="relative grid h-5 w-5 place-items-center">
                <Star
                  className={`absolute h-5 w-5 transition-colors duration-300 ${isPreview ? "text-amber-400" : ""}`}
                  style={isPreview ? undefined : { color: "var(--text-mute)" }}
                />
                <Star
                  className={`star-shake-target absolute h-5 w-5 fill-amber-400 text-amber-400 transition-opacity duration-300 ${isFilled ? "star-pop opacity-100" : "opacity-0"}`}
                />
              </span>
              <span
                className={`h-1 w-4 rounded-full bg-amber-500/30 blur-[2px] transition-opacity duration-300 ${isPreview || isFilled ? "opacity-60" : "opacity-0"}`}
              />
            </button>
          );
        })}
        {userRating !== null && <span className="ml-2 text-sm font-semibold text-amber-500">{userRating}/10</span>}
      </div>
      {loadError && (
        <p className="mt-1 flex items-center gap-2 text-xs text-rose-400">
          {loadError}
          <button type="button" onClick={retryLoadRating} className="underline hover:text-rose-300">Retry</button>
        </p>
      )}
    </div>
  );
}
