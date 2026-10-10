"use client";

import { useEffect, useReducer, useState } from "react";
import { createDefaultState, sanitizeState, studioReducer } from "@/lib/design-state";
import { loadStudioState, saveStudioState } from "@/lib/storage";
import { CreativeDirector } from "./creative-director";
import { DesignCanvas } from "./design-canvas";
import { ExportControls } from "./export-controls";
import { InspirationBoard } from "./inspiration-board";

type Tab = "chat" | "canvas" | "inspiration";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Director" },
  { id: "canvas", label: "Canvas" },
  { id: "inspiration", label: "Inspiration" },
];

export default function StudioWorkspace() {
  const [state, dispatch] = useReducer(
    studioReducer,
    undefined,
    createDefaultState,
  );
  const [tab, setTab] = useState<Tab>("canvas");
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
      .then((json: { instanceId?: unknown; state?: unknown; persistent?: unknown }) => {
        if (!active) return;
        const instanceId = typeof json.instanceId === "string" ? json.instanceId : null;
        const remote = sanitizeState(json.state);
        const local = instanceId ? loadStudioState(instanceId) : loadStudioState();
        const restored = remote ?? local;
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

    const timer = window.setTimeout(() => {
      void fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [persistence, state]);

  const { design, messages, selectedPaletteId } = state;
  const show = (target: Tab) => (tab === target ? "flex" : "hidden");

  function resetProject() {
    if (window.confirm("Reset the whole project, including the conversation?")) {
      dispatch({ type: "resetProject" });
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-4">
          <h1 className="font-display whitespace-nowrap text-lg font-bold tracking-[0.18em] sm:text-xl">
            CURIO LABS
          </h1>
          <p className="hidden text-xs text-muted xl:block">
            From vague ideas to visual direction.
          </p>
        </div>

        <div className="order-3 flex w-full min-w-0 items-center justify-between gap-3 sm:order-2 sm:w-auto sm:justify-start">
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
        </div>

        <div className="order-2 sm:order-3">
          <ExportControls design={design} selectedPaletteId={selectedPaletteId} />
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

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)_380px]">
        <div className={`${show("chat")} min-h-0 flex-col border-line lg:flex lg:border-r`}>
          <CreativeDirector
            messages={messages}
            design={design}
            selectedPaletteId={selectedPaletteId}
            dispatch={dispatch}
          />
        </div>
        <div className={`${show("canvas")} min-h-0 min-w-0 flex-col lg:flex`}>
          <DesignCanvas design={design} dispatch={dispatch} />
        </div>
        <div
          className={`${show("inspiration")} min-h-0 flex-col border-line lg:flex lg:border-l`}
        >
          <InspirationBoard
            design={design}
            selectedPaletteId={selectedPaletteId}
            dispatch={dispatch}
          />
        </div>
      </main>
    </div>
  );
}
