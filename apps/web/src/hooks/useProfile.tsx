import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { Profile, runtimeConfig } from "../api";

type ProfileContextValue = {
  profile: Profile | null;
  setProfile: (profile: Profile) => void;
  switcherOpen: boolean;
  openSwitcher: () => void;
  closeSwitcher: () => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({
  initialProfile,
  children,
}: {
  initialProfile: Profile | null;
  children: ReactNode;
}) {
  const [profile, setProfileState] = useState<Profile | null>(initialProfile);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const setProfile = useCallback((next: Profile) => {
    runtimeConfig.setProfileId(next.id);
    setProfileState(next);
    setSwitcherOpen(false);
  }, []);

  const openSwitcher = useCallback(() => setSwitcherOpen(true), []);
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);

  return (
    <ProfileContext.Provider value={{ profile, setProfile, switcherOpen, openSwitcher, closeSwitcher }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}
