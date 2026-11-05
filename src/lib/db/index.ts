import "server-only";

import type { DataStore } from "./types";
import { LocalStore } from "./local-store";
import { SupabaseStore } from "./supabase-store";
import { getServiceClient, supabaseConfigured } from "@/lib/supabase/server";
import { DEFAULT_PROFILE_ID } from "./seed";
import type { ProfileData } from "@/types";

export type { DataStore, Collections, PreferencesBundle, StoreHealth } from "./types";

const CACHE_KEY = Symbol.for("jobdedo.dataStore");

type GlobalWithStore = { [CACHE_KEY]?: DataStore };

/**
 * Resolves the active driver once per process.
 *
 * JOBDEDO_DATA_DRIVER = auto      -> Supabase when configured, else local file
 * JOBDEDO_DATA_DRIVER = supabase  -> force Supabase (throws when unconfigured)
 * JOBDEDO_DATA_DRIVER = local     -> force the local JSON store
 */
export function getDataStore(): DataStore {
  const g = globalThis as GlobalWithStore;
  if (g[CACHE_KEY]) return g[CACHE_KEY];

  const mode = (process.env.JOBDEDO_DATA_DRIVER ?? "auto").toLowerCase();
  let store: DataStore;

  if (mode === "local") {
    store = new LocalStore();
  } else if (mode === "supabase") {
    if (!supabaseConfigured()) {
      throw new Error(
        "JOBDEDO_DATA_DRIVER=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing.",
      );
    }
    store = new SupabaseStore(getServiceClient());
  } else if (supabaseConfigured()) {
    store = new SupabaseStore(getServiceClient());
  } else {
    store = new LocalStore();
  }

  g[CACHE_KEY] = store;
  return store;
}

export interface ProfileBundle {
  profile: NonNullable<Awaited<ReturnType<DataStore["getProfile"]>>>;
  education: ProfileData["education"];
  skills: ProfileData["skills"];
  projects: ProfileData["projects"];
  experiences: ProfileData["experiences"];
  leadership: ProfileData["leadership"];
  certifications: ProfileData["certifications"];
  roles: Awaited<ReturnType<DataStore["getPreferences"]>>["roles"];
  preferences: Awaited<ReturnType<DataStore["getPreferences"]>>["preferences"];
}

/**
 * Single idempotent entry point for "the one personal profile".
 * Safe to call as often as needed; never creates duplicates.
 */
export async function getProfileBundle(): Promise<ProfileBundle> {
  const db = getDataStore();
  const profile = await db.ensureProfile();
  const [children, prefs] = await Promise.all([
    db.listProfileChildren(),
    db.getPreferences(),
  ]);
  return {
    profile,
    ...children,
    roles: prefs.roles,
    preferences: prefs.preferences,
  };
}

export function toProfileData(bundle: ProfileBundle): ProfileData {
  return {
    id: bundle.profile.id,
    personal: bundle.profile.personal,
    education: bundle.education,
    skills: bundle.skills,
    projects: bundle.projects,
    experiences: bundle.experiences,
    leadership: bundle.leadership,
    certifications: bundle.certifications,
    created_at: bundle.profile.created_at,
    updated_at: bundle.profile.updated_at,
  };
}

export { DEFAULT_PROFILE_ID };
