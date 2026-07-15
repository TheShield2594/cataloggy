import { IgdbClient } from "../igdb.js";

export const getIgdb = (): IgdbClient => IgdbClient.fromEnv();
