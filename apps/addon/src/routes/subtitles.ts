import { addonBaseUrl } from "../lib/config.js";
import { mintMarkWatchedToken, type MarkWatchedTarget } from "../lib/mark-watched.js";
import { forwardPlaySignal } from "../lib/play-signal.js";
import { resolveProfileScope } from "../lib/profile.js";
import type { AddonRouter } from "../lib/router.js";
import type { StremioSubtitle } from "../lib/stremio-types.js";

/**
 * The "Cataloggy: Mark Watched" entry in Stremio's subtitle menu.
 *
 * A subtitle is the only thing an addon can put in front of a viewer that they
 * can click, so marking something watched from Stremio is a subtitle whose URL
 * records the watch and answers with a one-line SRT saying it did.
 */
export const registerSubtitlesRoute = (routes: AddonRouter): void => {
  routes.get<{ Params: { type: string; id: string } }>("/subtitles/:type/:id.json", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "application/json");

    const { type, id } = request.params;
    if (type !== "movie" && type !== "series") {
      return reply.send({ subtitles: [] });
    }

    // Parse IMDb ID — Stremio sends "tt1234567" for movies, "tt1234567:1:2" for episodes
    const [imdbId, seasonPart, episodePart] = id.split(":");
    if (!imdbId?.startsWith("tt")) {
      return reply.send({ subtitles: [] });
    }

    const scope = await resolveProfileScope(request);
    if (!scope.ok) return reply.send({ subtitles: [] });

    // A subtitles request means a player actually loaded, which is a stronger
    // play signal than the stream request that preceded it.
    forwardPlaySignal("subtitles", type, id, scope.profileId, request.headers["user-agent"], request.log);

    const addonBase = addonBaseUrl();
    // Pin the resolved profile into the mark-watched URL rather than leaving it
    // to be re-resolved later, so the write lands on the profile whose catalog
    // the user is actually looking at. A request that arrived without a profile
    // prefix has already resolved to the default profile by this point, so the
    // URL handed to Stremio names it explicitly either way.
    const profileSegment = scope.profileId ? `/p/${scope.profileId}` : "";

    // Minted against the same profile the URL above names, which is the value
    // /mark-watched reads back out of its own path and verifies against.
    const capabilityFor = (target: MarkWatchedTarget): string | null =>
      mintMarkWatchedToken(scope.profileId, target);

    if (type === "movie") {
      const token = capabilityFor({ type: "movie", imdbId });
      // Nothing to sign with means the mark-watched routes reject everything, so
      // the row would be a button that always fails. Better to not offer it.
      if (!token) return reply.send({ subtitles: [] });

      const subtitles: StremioSubtitle[] = [{
        id: `cataloggy-watch-${imdbId}`,
        url: `${addonBase}${profileSegment}/mark-watched/${type}/${imdbId}.srt?token=${token}`,
        lang: "Cataloggy: Mark Watched",
      }];
      return reply.send({ subtitles });
    }

    // For series, include season/episode info if available
    if (type === "series" && seasonPart !== undefined && episodePart !== undefined) {
      const season = parseInt(seasonPart, 10);
      const episode = parseInt(episodePart, 10);
      if (!isNaN(season) && !isNaN(episode)) {
        const token = capabilityFor({ type: "episode", imdbId, season, episode });
        if (!token) return reply.send({ subtitles: [] });

        const subtitles: StremioSubtitle[] = [{
          id: `cataloggy-watch-${imdbId}-s${season}e${episode}`,
          url: `${addonBase}${profileSegment}/mark-watched/episode/${imdbId}/${season}/${episode}.srt?token=${token}`,
          lang: `Cataloggy: Mark S${season}E${episode} Watched`,
        }];
        return reply.send({ subtitles });
      }
    }

    return reply.send({ subtitles: [] });
  });
};
