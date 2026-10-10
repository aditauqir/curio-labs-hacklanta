import { sanitizeState, type StudioState } from "./design-state";

const STORAGE_KEY = "studio-workspace-v1";

function key(instanceId?: string) {
  return instanceId ? `${STORAGE_KEY}:${instanceId}` : STORAGE_KEY;
}

/** Returns validated saved state, or null if storage is empty, blocked, or corrupted. */
export function loadStudioState(instanceId?: string): StudioState | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = window.localStorage.getItem(key(instanceId));
    return saved ? sanitizeState(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export function saveStudioState(state: StudioState, instanceId?: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key(instanceId), JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode, quota). The editor keeps working in memory.
  }
}

export function clearStudioState(instanceId?: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key(instanceId));
  } catch {
    // Ignore: the in-memory reset still applies.
  }
}
