import { Sentry, initNodeSentry } from "@cataloggy/shared";

export const sentryEnabled = initNodeSentry("addon");

export { Sentry };
