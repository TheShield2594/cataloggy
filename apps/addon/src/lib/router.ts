import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteGenericInterface,
  RouteHandlerMethod,
} from "fastify";
import { PROFILE_ROUTE_PREFIX } from "./profile.js";

export type AddonHandler<R extends RouteGenericInterface> = RouteHandlerMethod<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  R
>;

/**
 * Registers a route twice: bare, and under the per-profile prefix.
 *
 * Every Stremio-facing route is served both ways, so old installs keep working
 * while new ones can pin a profile — see `lib/profile.ts`. A route module takes
 * one of these rather than the Fastify instance, so it cannot register a route
 * that exists at only one of the two addresses.
 */
export type AddonRouter = {
  get: <R extends RouteGenericInterface>(path: string, handler: AddonHandler<R>) => void;
  post: <R extends RouteGenericInterface>(path: string, handler: AddonHandler<R>) => void;
};

export const addonRouter = (app: FastifyInstance): AddonRouter => ({
  get: (path, handler) => {
    app.get(path, handler);
    app.get(`${PROFILE_ROUTE_PREFIX}${path}`, handler);
  },
  post: (path, handler) => {
    app.post(path, handler);
    app.post(`${PROFILE_ROUTE_PREFIX}${path}`, handler);
  },
});
