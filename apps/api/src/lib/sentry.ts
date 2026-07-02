import { Sentry, initNodeSentry } from "@cataloggy/shared";

export const sentryEnabled = initNodeSentry("api");

export { Sentry };
