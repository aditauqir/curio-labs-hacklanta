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

type Tab = "chat" | "canvas" | "inspiration";
type StudioView = "start" | "chat" | "editor";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Director" },
  { id: "canvas", label: "Canvas" },
  { id: "inspiration", label: "Inspiration" },
];

const ONBOARDING_KEY = "curio-onboarding-complete-v1";

export default function StudioWorkspace() {
  const [state, dispatch] = useReducer(
    studioReducer,
    undefined,
    createDefaultState,
  );
  const [tab, setTab] = useState<Tab>("canvas");
  const [view, setView] = useState<StudioView>(
    () =>
      typeof window === "undefined"
        ? "start"
        : window.localStorage.getItem(ONBOARDING_KEY) === "true"
          ? "editor"
          : "start",
  );
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
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

  const { design, messages, selectedPaletteId } = state;

  function resetProject() {
    if (window.confirm("Reset the whole project, including the conversation?")) {
      dispatch({ type: "resetProject" });
    }
  }

  function startStudio(prompt?: string, destination: StartDestination = prompt ? "chat" : "editor") {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setInitialPrompt(prompt?.trim() || null);
    setView(destination);
  }

  function openChat() {
    setInitialPrompt(null);
    setView("chat");
  }

  function openEditor() {
    setInitialPrompt(null);
    setView("editor");
  }

  function openStart() {
    window.localStorage.removeItem(ONBOARDING_KEY);
    setInitialPrompt(null);
    setView("start");
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
      className="studio-editor-shell flex h-dvh flex-col bg-paper text-ink"
      data-testid="editor-screen"
    >
      <header className="studio-editor-header flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-4">
          <h1 className="font-display whitespace-nowrap text-lg font-bold tracking-[0.18em] sm:text-xl">
            CURIO LABS
          </h1>
          <p className="hidden text-xs text-muted xl:block">
            From vague ideas to visual direction.
          </p>
        </div>

        <div className="order-3 flex w-full min-w-0 items-center justify-between gap-3 sm:order-2 sm:w-auto sm:justify-start">
          <div className="studio-view-switcher" aria-label="Studio views">
            <button type="button" aria-label="Open director" onClick={openChat}>
              Director
            </button>
            <button type="button" aria-current="page" className="is-active">
              Editor
            </button>
          </div>
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <span>Project</span>
            <input
              type="text"
              aria-label="Project name"
              value={design.projectName}
              maxLength={60}
              onChange={(event) =>
                dispatch({ type: "setCopy", key: "projectName", value: event.target.value })
              }
              className="w-40 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium text-ink hover:border-line focus:border-line sm:w-48"
            />
          </label>
          <button
            type="button"
            onClick={resetProject}
            className="whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            Reset project
          </button>
          <button
            type="button"
            onClick={openStart}
            className="whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            Start screen
          </button>
          <button
            type="button"
            onClick={openStart}
            className="whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            Exit
          </button>
        </div>

        <div className="order-2 sm:order-3">
          <div className="flex items-center gap-2">
            <ExportControls design={design} selectedPaletteId={selectedPaletteId} />
          </div>
        </div>
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
        <aside className="studio-editor-rail min-h-0 border-line lg:border-r">
          <div className="studio-rail-panel studio-rail-inspiration">
            <InspirationBoard
              design={design}
              selectedPaletteId={selectedPaletteId}
              dispatch={dispatch}
            />
          </div>
          <div className="studio-rail-panel studio-rail-chat border-line lg:border-t">
            <CreativeDirector
              messages={messages}
              design={design}
              selectedPaletteId={selectedPaletteId}
              dispatch={dispatch}
              initialPrompt={initialPrompt}
            />
          </div>
        </aside>
        <div className="studio-editor-canvas min-h-0 min-w-0">
          <DesignCanvas design={design} dispatch={dispatch} />
        </div>
      </main>
    </div>
  );
}
