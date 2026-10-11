"use client";

import { useEffect, useReducer, useState } from "react";
import { createDefaultState, sanitizeState, studioReducer } from "@/lib/design-state";
import { loadStudioSnapshot, loadStudioState, markStudioStateSynced, saveStudioState } from "@/lib/storage";
import { ChatScreen } from "./chat-screen";
import { CreativeDirector } from "./creative-director";
import { DesignCanvas } from "./design-canvas";
import { ExportControls } from "./export-controls";
import { InspirationBoard } from "./inspiration-board";
import { OnboardingStudio, type StartDestination } from "./onboarding-studio";
import { getWorkspaceHostUrl } from "@/lib/host-routing";
import { PanelLeftIcon, PanelRightIcon, ResetIcon } from "./icons";

type Tab = "chat" | "canvas" | "inspiration";
export type StudioView = "start" | "chat" | "editor";

const VIEW_ROUTES: Record<StudioView, string> = {
  start: "/home",
  chat: "/director",
  editor: "/app",
};

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Director" },
  { id: "canvas", label: "Canvas" },
  { id: "inspiration", label: "Inspiration" },
];

const ONBOARDING_KEY = "curio-onboarding-complete-v1";

export default function StudioWorkspace({ initialView }: { initialView: StudioView }) {
  const [state, dispatch] = useReducer(
    studioReducer,
    undefined,
    createDefaultState,
  );
  const [tab, setTab] = useState<Tab>("canvas");
  const [view, setView] = useState<StudioView>(initialView);
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
      const pathname = window.location.pathname;
      const nextView =
        pathname === VIEW_ROUTES.chat
          ? "chat"
          : pathname === VIEW_ROUTES.editor || pathname === "/editor"
            ? "editor"
            : "start";
      setInitialPrompt(null);
      setView(nextView);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const { design, messages, selectedPaletteId } = state;

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

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setView(nextView);
  }

  function startStudio(prompt?: string, destination: StartDestination = prompt ? "chat" : "editor") {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setInitialPrompt(prompt?.trim() || null);
    navigateTo(destination);
  }

  function openChat() {
    setInitialPrompt(null);
    navigateTo("chat");
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
          <button type="button" className="studio-header-action" onClick={openChat}>
            <PanelLeftIcon />
            <span>Director</span>
          </button>
          <button
            type="button"
            className={`studio-header-action ${inspectorOpen ? "is-active" : ""}`}
            onClick={() => setInspectorOpen((open) => !open)}
          >
            <PanelRightIcon />
            <span>Inspector</span>
          </button>
          <button type="button" className="studio-header-action" onClick={resetProject}>
            <ResetIcon />
            <span>Reset</span>
          </button>
          <button type="button" className="studio-header-action" onClick={openStart}>
            <span>Exit</span>
          </button>
          <ExportControls design={design} selectedPaletteId={selectedPaletteId} />
        </nav>
      </header>

      <div
        role="tablist"
        aria-label="Workspace panels"
        className="grid grid-cols-3 border-b border-line bg-panel lg:hidden"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`py-3 text-xs font-medium uppercase tracking-[0.14em] transition-colors ${
              tab === item.id ? "border-b-2 border-ink text-ink" : "text-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <main className="studio-editor-grid min-h-0 flex-1" data-tab={tab}>
        <section className="studio-editor-surface">
          <aside className="studio-editor-chat">
            <CreativeDirector
              messages={messages}
              design={design}
              selectedPaletteId={selectedPaletteId}
              dispatch={dispatch}
              initialPrompt={initialPrompt}
            />
          </aside>
          <div className="studio-editor-canvas">
            <DesignCanvas
              design={design}
              dispatch={dispatch}
              onToggleInspector={() => setInspectorOpen((open) => !open)}
            />
          </div>
          {inspectorOpen ? (
            <aside className="studio-editor-inspector">
              <InspirationBoard
                design={design}
                selectedPaletteId={selectedPaletteId}
                dispatch={dispatch}
              />
            </aside>
          ) : null}
        </section>
      </main>
    </div>
  );
}
