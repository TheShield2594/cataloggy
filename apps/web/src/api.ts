/**
 * The client every page imports.
 *
 * This file was 1,670 lines: one flat object with 102 methods spanning every
 * domain in the app, the types they speak in, the request helper, the runtime
 * config and the service-worker plumbing — imported wholesale by every page.
 * The shape callers want is exactly what it always was, so that is what it
 * still exports: one `api` object and the types. What changed is where the
 * pieces live — `api/lists.ts`, `api/watch.ts`, `api/games.ts` and the rest,
 * each a plain object of calls over the one `request` in `api/client.ts`.
 *
 * A new call goes in the domain module it belongs to. The only thing that
 * belongs *here* is the composition below.
 */

export * from "./api/types";
export { ApiContractError } from "@cataloggy/shared/contracts";
export { ApiError, OfflineWriteQueuedError } from "./api/client";
export {
  invalidatedCachePrefixes,
  notifyServiceWorkerToInvalidateApiCache,
  onQueuedWritesReplayed,
  purgeApiCache,
  replayQueuedWrites,
  runtimeConfig,
  tellServiceWorkerWhereTheApiIs,
  WATCH_STATE_STALE_EVENT,
  type QueuedWritesReplayed,
} from "./api/runtime";

import { aiApi } from "./api/ai";
import { dataApi } from "./api/data";
import { discoverApi } from "./api/discover";
import { gamesApi } from "./api/games";
import { integrationsApi } from "./api/integrations";
import { listsApi } from "./api/lists";
import { metadataApi } from "./api/metadata";
import { notificationsApi } from "./api/notifications";
import { profilesApi } from "./api/profiles";
import { ratingsApi } from "./api/ratings";
import { settingsApi } from "./api/settings";
import { watchApi } from "./api/watch";

/**
 * Flat on purpose. `api.getLists()` is what several hundred call sites already
 * say, and nesting them under `api.lists.get()` would be a rename of every one
 * of those for no gain — the modules are for whoever is editing the client,
 * and the call sites never had to know which file a method came from.
 */
export const api = {
  ...aiApi,
  ...dataApi,
  ...discoverApi,
  ...gamesApi,
  ...integrationsApi,
  ...listsApi,
  ...metadataApi,
  ...notificationsApi,
  ...profilesApi,
  ...ratingsApi,
  ...settingsApi,
  ...watchApi,
};
