"use client";

import { useState } from "react";
import type { DesignState } from "@/lib/design-types";
import { exportBriefAsJson, exportPosterAsPng } from "@/lib/export";
import { DownloadIcon } from "./icons";

type Status = { tone: "idle" | "busy" | "ok" | "error"; message: string };

export function ExportControls({
  design,
  selectedPaletteId,
}: {
  design: DesignState;
  selectedPaletteId: string | null;
}) {
  const [status, setStatus] = useState<Status>({ tone: "idle", message: "" });

  async function exportPng() {
    setStatus({ tone: "busy", message: "Rendering PNG..." });
    try {
      await exportPosterAsPng(design);
      setStatus({ tone: "ok", message: "PNG downloaded" });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "PNG export failed",
      });
    }
  }

  function exportJson() {
    try {
      exportBriefAsJson(design, selectedPaletteId);
      setStatus({ tone: "ok", message: "Brief downloaded" });
    } catch {
      setStatus({ tone: "error", message: "Brief export failed" });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        role="status"
        aria-live="polite"
        className={`hidden text-xs md:inline ${
          status.tone === "error" ? "text-red-700" : "text-muted"
        }`}
      >
        {status.message}
      </span>
      <button
        type="button"
        onClick={exportJson}
        className="whitespace-nowrap rounded-md border border-line px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-ink hover:text-ink"
      >
        Brief JSON
      </button>
      <button
        type="button"
        onClick={exportPng}
        disabled={status.tone === "busy"}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-3 py-2 text-xs font-medium text-paper transition-opacity disabled:opacity-50"
      >
        <DownloadIcon />
        Export PNG
      </button>
    </div>
  );
}
