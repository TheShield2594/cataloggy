import { prisma } from "./prisma.js";

export const LANGUAGE_KV_KEY = "settings:language";
export const REGION_KV_KEY = "settings:region";
export const SPOILER_PROTECTION_KV_KEY = "settings:spoilerProtection";

export const getLanguageSetting = async (): Promise<string> => {
  const row = await prisma.kV.findUnique({ where: { key: LANGUAGE_KV_KEY } });
  return row?.value ?? "en-US";
};

export const getRegionSetting = async (): Promise<string> => {
  const row = await prisma.kV.findUnique({ where: { key: REGION_KV_KEY } });
  return row?.value ?? "US";
};

export const getSpoilerProtection = async (): Promise<boolean> => {
  const row = await prisma.kV.findUnique({ where: { key: SPOILER_PROTECTION_KV_KEY } });
  return row?.value === "true";
};
