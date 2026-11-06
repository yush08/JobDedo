/**
 * Desktop sidebar collapse preference (pure, storage-safe helpers).
 *
 * Contract:
 * - Desktop defaults to EXPANDED (`collapsed = false`).
 * - Only the explicit string `"1"` means collapsed; every other value
 *   (including junk, `"true"`, `"0"`, empty) normalizes to expanded.
 * - Reads/writes are guarded: storage can throw in private browsing or
 *   be absent during SSR — callers must never crash because of it.
 * - The stored value is a pure UI preference; application data never
 *   lives in localStorage.
 */

export const SIDEBAR_STORAGE_KEY = "jobdedo:sidebar-collapsed";

/** Minimal storage surface so tests can inject fakes. */
export type SidebarStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Parse a raw stored value — only an explicit `"1"` collapses. */
export function parseSidebarCollapsed(raw: string | null | undefined): boolean {
  return raw === "1";
}

/** Serialize the preference for storage. */
export function serializeSidebarCollapsed(collapsed: boolean): string {
  return collapsed ? "1" : "0";
}

function defaultStorage(): SidebarStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Accessing localStorage itself can throw (storage disabled).
    return null;
  }
}

/**
 * Read the stored preference. Returns `false` (expanded) when storage is
 * unavailable, throws, or holds anything other than an explicit `"1"`.
 */
export function readSidebarCollapsed(storage?: SidebarStorage | null): boolean {
  try {
    const target = storage ?? defaultStorage();
    if (!target) return false;
    return parseSidebarCollapsed(target.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Persist the preference; never throws when storage is unavailable. */
export function writeSidebarCollapsed(
  collapsed: boolean,
  storage?: SidebarStorage | null,
): void {
  try {
    const target = storage ?? defaultStorage();
    target?.setItem(SIDEBAR_STORAGE_KEY, serializeSidebarCollapsed(collapsed));
  } catch {
    // Storage unavailable — preference stays session-only.
  }
}
