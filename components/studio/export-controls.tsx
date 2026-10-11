"use client";

import { useState } from "react";
import type { DesignState } from "@/lib/design-types";
import type { PosterEdits } from "@/lib/poster-editor";
import { exportBriefAsJson, exportPoster, type PosterExportFormat } from "@/lib/export";
import { DownloadIcon } from "./icons";
import GlideSelect from "./glide-select";
import WarmTooltip, { WarmTooltipGroup } from "./warm-tooltip";

type Status = { tone: "idle" | "busy" | "ok" | "error"; message: string };

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG", tag: "Lossless" },
  { value: "jpg", label: "JPG", tag: "Smallest" },
  { value: "psd", label: "PSD", tag: "Photoshop" },
];

export function ExportControls({
  design,
  selectedPaletteId,
  posterEdits = {},
  layerOrder = [],
  compact = false,
}: {
  design: DesignState;
  selectedPaletteId: string | null;
  posterEdits?: PosterEdits;
  layerOrder?: string[];
  compact?: boolean;
}) {
  const [status, setStatus] = useState<Status>({ tone: "idle", message: "" });
  const [format, setFormat] = useState<PosterExportFormat>("png");

  async function exportSelectedFormat() {
    setStatus({ tone: "busy", message: `Rendering ${format.toUpperCase()}...` });
    try {
      await exportPoster(design, format, posterEdits, layerOrder);
      setStatus({ tone: "ok", message: `${format.toUpperCase()} downloaded` });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : `${format.toUpperCase()} export failed`,
      });
    }
  }

  function exportJson() {
    try {
      exportBriefAsJson(design, selectedPaletteId, posterEdits, layerOrder);
      setStatus({ tone: "ok", message: "Brief downloaded" });
    } catch {
      setStatus({ tone: "error", message: "Brief export failed" });
    }
  }

  const busy = status.tone === "busy";

  return (
    <WarmTooltipGroup delay={420} warmWindow={300} travel={220}>
      <div className={`flex items-center gap-2${compact ? " studio-export-compact" : ""}`}>
        {!compact ? (
          <span
            role="status"
            aria-live="polite"
            className={`hidden text-xs md:inline ${
              status.tone === "error" ? "text-red-700" : "text-muted"
            }`}
          >
            {status.message}
          </span>
        ) : null}
        <GlideSelect
          options={FORMAT_OPTIONS}
          value={format}
          onChange={(value) => setFormat(value as PosterExportFormat)}
          ariaLabel="Export format"
          showTags
          accentColor="#f5f5f5"
          surfaceColor="#27272a"
          highlightColor="#3f3f46"
          textColor="#f5f5f5"
          size="sm"
          radius={9}
          menuWidth={150}
          align={compact ? "right" : "left"}
          disabled={busy}
        />
        {!compact ? (
          <>
            <WarmTooltip content="Download the editable brief" shortcut="JSON" side="bottom">
              <button
                type="button"
                aria-label="Download brief JSON"
                onClick={exportJson}
                className="whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                Brief JSON
              </button>
            </WarmTooltip>
            <WarmTooltip content={`Export ${format.toUpperCase()}`} shortcut="Enter" side="bottom">
              <button
                type="button"
                onClick={() => void exportSelectedFormat()}
                disabled={busy}
                aria-label={`Export ${format.toUpperCase()}`}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-3 py-2 text-xs font-medium text-paper transition-opacity disabled:opacity-50"
              >
                <DownloadIcon />
                Export {format.toUpperCase()}
              </button>
            </WarmTooltip>
          </>
        ) : null}
      </div>
    </WarmTooltipGroup>
  );
}
