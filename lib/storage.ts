import { sanitizeState, type StudioState } from "./design-state";

const STORAGE_KEY = "studio-workspace-v1";

/** Returns validated saved state, or null if storage is empty, blocked, or corrupted. */
export function loadStudioState(): StudioState | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? sanitizeState(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export function saveStudioState(state: StudioState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode, quota). The editor keeps working in memory.
  }
}

export function clearStudioState() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: the in-memory reset still applies.
  }
}
