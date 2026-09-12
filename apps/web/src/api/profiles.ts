/**
 * The household: who is using this install, and the PIN gate in front of
 * the ones that have one.
 */

import { request } from "./client";
import { runtimeConfig } from "./runtime";
import type {
  Profile,
} from "./types";

export const profilesApi = {
  // Profiles
  getProfiles() {
    return request<{ profiles: Profile[] }>("/profiles");
  },
  createProfile(payload: { name: string; pin?: string | undefined }) {
    return request<{ profile: Profile }>("/profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async verifyProfile(profileId: string, pin?: string) {
    const result = await request<{ id: string; name: string; profileToken?: string | undefined }>(
      `/profiles/${encodeURIComponent(profileId)}/verify`,
      {
        method: "POST",
        body: JSON.stringify(pin ? { pin } : {}),
      }
    );
    // Persist the signed capability so subsequent requests for this profile
    // clear the server-side PIN gate.
    runtimeConfig.setProfileToken(result.profileToken ?? "");
    return result;
  },
  updateProfile(profileId: string, payload: { name?: string | undefined; pin?: string | null | undefined; currentPin?: string | undefined }) {
    return request<{ profile: Profile }>(`/profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  // `currentPin` is required by the server for a PIN-protected profile unless
  // the stored profile token was minted for that same profile — deleting one
  // takes its whole history with it, so it is gated like a PIN change.
  deleteProfile(profileId: string, currentPin?: string) {
    return request<void>(`/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
      ...(currentPin ? { body: JSON.stringify({ currentPin }) } : {}),
    });
  },
};
