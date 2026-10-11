"use client";

import { useEffect, useReducer, useState } from "react";
import { createDefaultState, sanitizeState, studioReducer } from "@/lib/design-state";
import { loadStudioSnapshot, loadStudioState, markStudioStateSynced, saveStudioState } from "@/lib/storage";
import { ChatScreen } from "./chat-screen";
import { CreativeDirector } from "./creative-director";
import { DesignCanvas } from "./design-canvas";
import { ExportControls } from "./export-controls";
import { OnboardingStudio, type StartDestination } from "./onboarding-studio";
import { StudioInspector, type InspectorTab } from "./studio-inspector";
import { getWorkspaceHostUrl } from "@/lib/host-routing";
import type { PosterLayerEdit, PosterTool } from "@/lib/poster-editor";
import { LayersIcon, ResetIcon } from "./icons";

export type StudioView = "start" | "chat" | "editor";

const VIEW_ROUTES: Record<StudioView, string> = {
  start: "/home",
  chat: "/director",
  editor: "/app",
};

const ONBOARDING_KEY = "curio-onboarding-complete-v1";

function viewForPathname(pathname: string): StudioView {
  if (pathname === VIEW_ROUTES.chat) return "chat";
  if (pathname === "/editor") return "editor";
  if (pathname === VIEW_ROUTES.editor) {
    return window.history.state?.curioView === "editor" ? "editor" : "start";
  }
  return "start";
}

export default function StudioWorkspace({ initialView }: { initialView: StudioView }) {
  const [state, dispatch] = useReducer(
    studioReducer,
    undefined,
    createDefaultState,
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
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("reference");
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
        const restored =
          local && (!Number.isFinite(remoteUpdatedAt) || local.savedAt > remoteUpdatedAt)
            ? local.state
            : remote ?? local?.state ?? null;
        if (restored) dispatch({ type: "restoreState", state: restored });
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
  }, []);

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

  const { design, messages, selectedPaletteId, posterEdits } = state;

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
    if (window.confirm("Reset the whole project, including the conversation?")) {
      dispatch({ type: "resetProject" });
    }
  }

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

  function startStudio(prompt?: string, destination: StartDestination = prompt ? "chat" : "editor") {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setInitialPrompt(prompt?.trim() || null);
    navigateTo(destination);
  }

  function openEditor() {
    setInitialPrompt(null);
    navigateTo("editor");
  }

  function openStart() {
    window.localStorage.removeItem(ONBOARDING_KEY);
    setInitialPrompt(null);
    navigateTo("start");
  }

  if (view === "start") return <OnboardingStudio onStart={startStudio} projectName={design.projectName} />;

  if (view === "chat") {
    return (
      <ChatScreen
        design={design}
        messages={messages}
        selectedPaletteId={selectedPaletteId}
        posterEdits={posterEdits}
        dispatch={dispatch}
        initialPrompt={initialPrompt}
        onBack={openStart}
        onOpenEditor={openEditor}
      />
    );
  }

  return (
    <div
      className="studio-editor-shell flex h-dvh flex-col bg-[#101113] text-white"
      data-testid="editor-screen"
    >
      <header className="studio-editor-header">
        <div className="studio-editor-brand">
          <span className="studio-brand-mark" aria-hidden="true" />
          <div>
            <h1>CURIO LABS</h1>
            <p>Visual direction workspace</p>
          </div>
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

        <nav className="studio-editor-actions" aria-label="Editor actions">
          <button
            type="button"
            className={`studio-header-action ${inspectorOpen ? "is-active" : ""}`}
            onClick={() => {
              setInspectorTab("layers");
              setInspectorOpen((open) => !open);
            }}
          >
            <LayersIcon />
            <span>Layers</span>
          </button>
          <button type="button" className="studio-header-action" onClick={resetProject}>
            <ResetIcon />
            <span>Reset</span>
          </button>
          <button type="button" className="studio-header-action" onClick={openStart}>
            <span>Home</span>
          </button>
          <ExportControls design={design} selectedPaletteId={selectedPaletteId} posterEdits={posterEdits} />
        </nav>
      </header>
      <main className="studio-editor-grid min-h-0 flex-1">
        <section className="studio-editor-surface">
          <aside className="studio-editor-chat">
            <CreativeDirector
              messages={messages}
              design={design}
              selectedPaletteId={selectedPaletteId}
              posterEdits={posterEdits}
              dispatch={dispatch}
              initialPrompt={initialPrompt}
            />
          </aside>
          <div className="studio-editor-canvas">
            <DesignCanvas
              design={design}
              dispatch={dispatch}
              posterEdits={posterEdits}
              selectedLayerId={selectedLayerId}
              activeTool={activeTool}
              onToolChange={setActiveTool}
              onSelectLayer={setSelectedLayerId}
              onChangeLayer={changeLayer}
              onDeleteLayer={deleteLayer}
              onToggleInspector={(nextTab = "reference") => {
                setInspectorTab(nextTab);
                setInspectorOpen(true);
              }}
            />
          </div>
          {inspectorOpen ? (
            <aside className="studio-editor-inspector">
              <StudioInspector
                activeTab={inspectorTab}
                design={design}
                selectedPaletteId={selectedPaletteId}
                dispatch={dispatch}
                posterEdits={posterEdits}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                onToggleLayerVisibility={toggleLayerVisibility}
                onToggleLayerLock={toggleLayerLock}
                onTabChange={setInspectorTab}
              />
            </aside>
          ) : null}
        </section>
      </main>
    </div>
  );
}
