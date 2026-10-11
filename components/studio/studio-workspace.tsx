"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type WheelEvent as ReactWheelEvent } from "react";
import {
  createDefaultState,
  createDemoState,
  sanitizeState,
  studioReducer,
  type StudioAction,
  type StudioState,
} from "@/lib/design-state";
import { loadStudioSnapshot, loadStudioState, markStudioStateSynced, saveStudioState } from "@/lib/storage";
import { CreativeDirector } from "./creative-director";
import { DesignCanvas } from "./design-canvas";
import { OnboardingStudio } from "./onboarding-studio";
import { StudioInspector } from "./studio-inspector";
import { ExportControls } from "./export-controls";
import { ImageImportControl } from "./image-import";
import { getWorkspaceHostUrl } from "@/lib/host-routing";
import { posterSizes } from "@/lib/design-presets";
import type { PosterLayerEdit, PosterTool } from "@/lib/poster-editor";
import { HomeIcon } from "./icons";
import { analyzeImage, ImageImportError, type ImportedReference } from "@/lib/image-import-client";
import { SegmentedControl } from "./ui";

export type StudioView = "start" | "editor";

const VIEW_ROUTES: Record<StudioView, string> = {
  start: "/home",
  editor: "/app",
};

const ONBOARDING_KEY = "curio-onboarding-complete-v1";

type StudioHistory = {
  past: StudioState[];
  present: StudioState;
  future: StudioState[];
};

function viewForPathname(pathname: string): StudioView {
  if (pathname === "/editor") return "editor";
  if (pathname === VIEW_ROUTES.editor) {
    return window.history.state?.curioView === "editor" ? "editor" : "start";
  }
  return "start";
}

function preventEditorPageZoom(event: ReactWheelEvent<HTMLDivElement>) {
  if (!event.ctrlKey) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".design-canvas-stage")) return;
  event.preventDefault();
}

export default function StudioWorkspace({ initialView }: { initialView: StudioView }) {
  const [history, setHistory] = useState<StudioHistory>(() => ({
    past: [],
    present: createDefaultState(),
    future: [],
  }));
  const state = history.present;
  const dispatchActions = useCallback((actions: StudioAction[]) => {
    setHistory((current) => {
      const next = actions.reduce(studioReducer, current.present);
      if (next === current.present) return current;

      // Chat messages are context, not canvas edits. Keep them visible without
      // spending an undo step so Undo returns to the last visual state.
      if (actions.every((action) => action.type === "addMessages")) {
        return { ...current, present: next };
      }

      return {
        past: [...current.past, current.present].slice(-50),
        present: next,
        future: [],
      };
    });
  }, []);
  const dispatch: Dispatch<StudioAction> = useCallback(
    (action) => dispatchActions([action]),
    [dispatchActions],
  );
  const [view, setView] = useState<StudioView>(() => {
    if (
      initialView === "start" &&
      typeof window !== "undefined" &&
      window.location.pathname === VIEW_ROUTES.editor &&
      window.history.state?.curioView === "editor"
    ) {
      return "editor";
    }
    return initialView;
  });
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const demoRequestedRef = useRef(false);
  const [referenceOpen, setReferenceOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [importedReference, setImportedReference] = useState<ImportedReference | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>("headline-0");
  const [activeTool, setActiveTool] = useState<PosterTool>("select");
  const [persistence, setPersistence] = useState<{
    ready: boolean;
    instanceId: string | null;
    persistent: boolean;
  }>({ ready: false, instanceId: null, persistent: false });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    fetch("/api/workspace", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("workspace"))))
      .then((json: { instanceId?: unknown; state?: unknown; updatedAt?: unknown; persistent?: unknown }) => {
        if (!active) return;
        const instanceId = typeof json.instanceId === "string" ? json.instanceId : null;
        const remote = sanitizeState(json.state);
        const local = instanceId ? loadStudioSnapshot(instanceId) ?? loadStudioSnapshot() : loadStudioSnapshot();
        const remoteUpdatedAt = typeof json.updatedAt === "string" ? Date.parse(json.updatedAt) : NaN;
        if (!demoRequestedRef.current) {
          const restored =
            local && (!Number.isFinite(remoteUpdatedAt) || local.savedAt > remoteUpdatedAt)
              ? local.state
              : remote ?? local?.state ?? null;
          if (restored) dispatch({ type: "restoreState", state: restored });
        }
        setPersistence({
          ready: true,
          instanceId,
          persistent: json.persistent === true,
        });
      })
      .catch(() => {
        if (!active) return;
        const local = loadStudioState();
        if (local) dispatch({ type: "restoreState", state: local });
        setPersistence({ ready: true, instanceId: null, persistent: false });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [dispatch]);

  const importImage = useCallback(async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setImportError(null);
    try {
      const analysis = await analyzeImage(file);
      const imported: ImportedReference = {
        ...analysis,
        filename: file.name || "reference-image",
        previewUrl,
      };
      setImportedReference((previous) => {
        if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
        return imported;
      });
      setInitialPrompt(analysis.prompt);
      return imported;
    } catch (error) {
      // Keep the local image visible even when optional Gemini analysis is down.
      // The reference itself is still useful on the canvas; only the analysis
      // result is unavailable.
      if (error instanceof ImageImportError && error.status >= 500) {
        const fallback: ImportedReference = {
          filename: file.name || "reference-image",
          previewUrl,
          summary: "Imported reference loaded. Visual analysis is unavailable right now.",
          prompt: "",
          suggestions: [
            "Use this image as a visual reference",
            "Build a poster around this image",
            "Keep the image and refine the typography",
          ],
        };
        setImportedReference((previous) => {
          if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
          return fallback;
        });
        setInitialPrompt(null);
        return fallback;
      }
      URL.revokeObjectURL(previewUrl);
      throw error;
    }
  }, []);

  useEffect(() => {
    function fileFromDrop(event: DragEvent) {
      return event.dataTransfer?.files?.[0] ?? null;
    }

    function handleDragOver(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDropActive(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (event.relatedTarget === null) setDropActive(false);
    }

    function handleDrop(event: DragEvent) {
      const file = fileFromDrop(event);
      if (!file) return;
      event.preventDefault();
      setDropActive(false);
      void importImage(file).catch((error: unknown) => {
        setImportError(
          error instanceof ImageImportError && error.code === "not_configured"
            ? "Image analysis is not configured yet."
            : error instanceof ImageImportError && error.code === "too_large"
              ? "Choose an image smaller than 8 MB."
              : "Image analysis failed. Try again.",
        );
      });
    }

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [importImage]);

  useEffect(() => {
    if (!persistence.ready) return;
    saveStudioState(state, persistence.instanceId ?? undefined);
    if (!persistence.persistent || !persistence.instanceId) return;

    const controller = new AbortController();
    const saveRemote = async (keepalive = false) => {
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
          keepalive,
          signal: controller.signal,
        });
        if (response.ok) {
          const json = (await response.json().catch(() => null)) as { updatedAt?: unknown } | null;
          if (typeof json?.updatedAt === "string" && persistence.instanceId) {
            markStudioStateSynced(state, persistence.instanceId, json.updatedAt);
          }
        }
      } catch {
        // LocalStorage remains the source for the next refresh when the server is unavailable.
      }
    };
    const timer = window.setTimeout(() => void saveRemote(), 500);
    const flushOnPageHide = () => void saveRemote(true);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      window.removeEventListener("pagehide", flushOnPageHide);
    };
  }, [persistence, state]);

  useEffect(() => {
    function handlePopState() {
      const nextView = viewForPathname(window.location.pathname);
      setInitialPrompt(null);
      setView(nextView);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const { design, messages, selectedPaletteId, posterEdits, layerOrder } = state;

  function changeLayer(id: string, patch: Partial<PosterLayerEdit>) {
    dispatch({ type: "setPosterLayerEdit", id, patch });
  }

  function deleteLayer(id: string) {
    if (id === "background") return;
    changeLayer(id, { visible: false });
    setSelectedLayerId(null);
  }

  function toggleLayerVisibility(id: string) {
    changeLayer(id, { visible: !(posterEdits[id]?.visible ?? true) });
  }

  function toggleLayerLock(id: string) {
    changeLayer(id, { locked: !(posterEdits[id]?.locked ?? false) });
  }

  function resetProject() {
    dispatch({ type: "resetProject" });
  }

  async function saveProject() {
    const savedAt = Date.now();
    saveStudioState(state, persistence.instanceId ?? undefined, savedAt);
    if (!persistence.ready || !persistence.persistent || !persistence.instanceId) return;

    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (response.ok) {
        const json = (await response.json().catch(() => null)) as { updatedAt?: unknown } | null;
        if (typeof json?.updatedAt === "string") {
          markStudioStateSynced(state, persistence.instanceId, json.updatedAt);
        }
      }
    } catch {
      // LocalStorage remains the source for the next refresh when the server is unavailable.
    }
  }

  function undo() {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }

  function redo() {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present].slice(-50),
        present: next,
        future: current.future.slice(1),
      };
    });
  }

  useEffect(() => {
    function handleUndoRedo(event: KeyboardEvent) {
      if (view !== "editor" || event.defaultPrevented || (!event.metaKey && !event.ctrlKey)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleUndoRedo);
    return () => window.removeEventListener("keydown", handleUndoRedo);
  }, [view]);

  function navigateTo(nextView: StudioView) {
    const nextPath = VIEW_ROUTES[nextView];
    const hostUrl = getWorkspaceHostUrl(nextPath);
    if (hostUrl) {
      window.location.assign(hostUrl);
      return;
    }

    const nextHistoryState = {
      ...(window.history.state && typeof window.history.state === "object" ? window.history.state : {}),
      curioView: nextView,
    };
    if (window.location.pathname !== nextPath) {
      window.history.pushState(nextHistoryState, "", nextPath);
    } else {
      window.history.replaceState(nextHistoryState, "", nextPath);
    }
    setView(nextView);
  }

  function startStudio(prompt?: string) {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setInitialPrompt(prompt?.trim() || importedReference?.prompt || null);
    navigateTo("editor");
  }

  function openDemo() {
    demoRequestedRef.current = true;
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setHistory({ past: [], present: createDemoState(), future: [] });
    setInitialPrompt(null);
    navigateTo("editor");
  }

  function openStart() {
    window.localStorage.removeItem(ONBOARDING_KEY);
    setInitialPrompt(null);
    navigateTo("start");
  }

  if (view === "start") {
    return (
      <>
        <OnboardingStudio
          onStart={startStudio}
          onOpenDemo={openDemo}
          onImportImage={importImage}
          importedReference={importedReference}
          projectName={design.projectName}
        />
        {dropActive ? <div className="studio-drop-overlay">Drop image to import</div> : null}
        {importError ? <p className="studio-global-import-error" role="alert">{importError}</p> : null}
      </>
    );
  }

  return (
    <>
      <div
        className="studio-editor-shell flex h-dvh flex-col bg-[#101113] text-white"
        data-testid="editor-screen"
        style={{
          width: "100vw",
          height: "100dvh",
          maxWidth: "100vw",
          maxHeight: "100dvh",
          overflow: "hidden",
          overscrollBehavior: "none",
          touchAction: "pan-y",
        }}
        onWheelCapture={preventEditorPageZoom}
      >
      <div className="studio-editor-body">
        <aside className="studio-editor-chat" style={{ borderRadius: 0 }}>
          <CreativeDirector
            messages={messages}
            design={design}
            selectedPaletteId={selectedPaletteId}
            posterEdits={posterEdits}
            layerOrder={layerOrder}
            dispatch={dispatch}
            dispatchBatch={dispatchActions}
            initialPrompt={initialPrompt}
          />
        </aside>

        <div className="studio-editor-workspace">
          <header className="studio-editor-header">
            <button type="button" className="studio-editor-home" aria-label="Home" onClick={openStart}>
              <HomeIcon />
            </button>
            <ImageImportControl
              compact
              className="studio-editor-import"
              onImport={importImage}
              result={importedReference}
            />
            <div className="studio-editor-size-control">
              <SegmentedControl
                label="Poster size"
                value={design.posterSize}
                options={posterSizes.map((size) => ({ value: size.id, label: size.label }))}
                onChange={(value) => dispatch({ type: "setPosterSize", value })}
                tone="dark"
              />
            </div>
            <label className="studio-project-field">
              <span>Project</span>
              <input
                type="text"
                aria-label="Project name"
                value={design.projectName}
                maxLength={60}
                onChange={(event) =>
                  dispatch({ type: "setCopy", key: "projectName", value: event.target.value })
                }
              />
            </label>
            <div className="studio-editor-export">
              <ExportControls
                compact
                design={design}
                selectedPaletteId={selectedPaletteId}
                posterEdits={posterEdits}
                layerOrder={layerOrder}
              />
            </div>
          </header>

          <main className="studio-editor-grid min-h-0 flex-1">
            <section className="studio-editor-surface">
              <div className="studio-editor-canvas">
                <DesignCanvas
                  design={design}
                  selectedPaletteId={selectedPaletteId}
                  dispatch={dispatch}
                  dispatchBatch={dispatchActions}
                  posterEdits={posterEdits}
                  layerOrder={layerOrder}
                  selectedLayerId={selectedLayerId}
                  importedReference={importedReference}
                  activeTool={activeTool}
                  onToolChange={setActiveTool}
                  onSelectLayer={setSelectedLayerId}
                  onChangeLayer={changeLayer}
                  onDeleteLayer={deleteLayer}
                  onResetProject={resetProject}
                  onSaveProject={saveProject}
                  onUndo={undo}
                  onRedo={redo}
                  canUndo={history.past.length > 0}
                  canRedo={history.future.length > 0}
                  referenceOpen={referenceOpen}
                  layersOpen={layersOpen}
                  onToggleInspector={(nextTab = "reference") => {
                    if (nextTab === "layers") setLayersOpen((open) => !open);
                    else setReferenceOpen((open) => !open);
                  }}
                />
              </div>
              {referenceOpen || layersOpen ? (
                <aside className="studio-editor-inspector">
                  <StudioInspector
                    referenceOpen={referenceOpen}
                    layersOpen={layersOpen}
                    importedReference={importedReference}
                    design={design}
                    selectedPaletteId={selectedPaletteId}
                    dispatch={dispatch}
                    posterEdits={posterEdits}
                    layerOrder={layerOrder}
                    selectedLayerId={selectedLayerId}
                    onSelectLayer={setSelectedLayerId}
                    onToggleLayerVisibility={toggleLayerVisibility}
                    onToggleLayerLock={toggleLayerLock}
                    onDeleteLayer={deleteLayer}
                    onReorderLayer={(id, direction) => dispatch({ type: "reorderLayer", id, direction })}
                    onToggleReference={() => setReferenceOpen((open) => !open)}
                    onToggleLayers={() => setLayersOpen((open) => !open)}
                  />
                </aside>
              ) : null}
            </section>
          </main>
        </div>
      </div>
      </div>
      {dropActive ? <div className="studio-drop-overlay">Drop image to import</div> : null}
      {importError ? <p className="studio-global-import-error" role="alert">{importError}</p> : null}
    </>
  );
}
