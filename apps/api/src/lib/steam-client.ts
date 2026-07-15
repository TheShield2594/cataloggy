import { SteamClient } from "../steam.js";

export const getSteam = (): SteamClient => SteamClient.fromEnv();
