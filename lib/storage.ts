import { sanitizeState, type StudioState } from "./design-state";

const STORAGE_KEY = "studio-workspace-v1";

export type StudioSnapshot = {
  state: StudioState;
  savedAt: number;
};

function key(instanceId?: string) {
  return instanceId ? `${STORAGE_KEY}:${instanceId}` : STORAGE_KEY;
}

/** Returns validated saved state, or null if storage is empty, blocked, or corrupted. */
export function loadStudioSnapshot(instanceId?: string): StudioSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = window.localStorage.getItem(key(instanceId));
    if (!saved) return null;
    const parsed = JSON.parse(saved) as { state?: unknown; savedAt?: unknown };
    const state = sanitizeState(parsed.state ?? parsed);
    if (!state) return null;
    return {
      state,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function loadStudioState(instanceId?: string) {
  return loadStudioSnapshot(instanceId)?.state ?? null;
}

export function saveStudioState(state: StudioState, instanceId?: string, savedAt = Date.now()) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key(instanceId), JSON.stringify({ state, savedAt }));
  } catch {
    // Storage can be unavailable (private mode, quota). The editor keeps working in memory.
  }
}

export function markStudioStateSynced(state: StudioState, instanceId: string, updatedAt: string) {
  const timestamp = Date.parse(updatedAt);
  saveStudioState(state, instanceId, Number.isFinite(timestamp) ? timestamp : Date.now());
}

export function clearStudioState(instanceId?: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key(instanceId));
  } catch {
    // Ignore: the in-memory reset still applies.
  }
}
