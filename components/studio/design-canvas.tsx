"use client";

import dynamic from "next/dynamic";
import { useState, type Dispatch } from "react";
import { Button } from "@/components/ui/button";
import { askCoach, CoachError, type CoachReply } from "@/lib/coach-client";
import type { DesignState } from "@/lib/design-types";
import type { CopyKey, StudioAction } from "@/lib/design-state";
import { directionConfigs, directionOrder } from "@/lib/design-presets";
import { Poster } from "./poster";
import { ResetIcon } from "./icons";
import { ColorField, Field, SegmentedControl, inputClass } from "./ui";

const TldrawBoard = dynamic(() => import("./tldraw-board").then((module) => module.TldrawBoard), {
  ssr: false,
});

const COPY_FIELDS: { key: CopyKey; label: string }[] = [
  { key: "venue", label: "Venue" },
  { key: "subtitle", label: "Subtitle" },
  { key: "date", label: "Date" },
  { key: "time", label: "Time" },
  { key: "footer", label: "Footer" },
];

export function DesignCanvas({
  design,
  dispatch,
}: {
  design: DesignState;
  dispatch: Dispatch<StudioAction>;
}) {
  const [coach, setCoach] = useState<CoachReply | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkLayout() {
    setChecking(true);
    setCoachError(null);
    try {
      setCoach(await askCoach({ design, question: "Check the hierarchy and placement of this poster." }));
    } catch (error) {
      setCoachError(
        error instanceof CoachError && error.code === "not_configured"
          ? "Gemini coaching is not configured on this server yet."
          : "The coach could not check this layout right now.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <section
      aria-label="Design canvas"
      className="design-canvas flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas"
    >
      <div className="design-canvas-header flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#202126] px-4 py-4 text-white sm:px-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/50">Canvas</p>
          <p className="mt-1 text-sm text-white/80">Live poster direction</p>
        </div>
        <SegmentedControl
          label="Visual direction"
          value={design.direction}
          options={directionOrder.map((direction) => ({
            value: direction,
            label: directionConfigs[direction].label,
          }))}
          onChange={(direction) => dispatch({ type: "setDirection", direction })}
          tone="dark"
        />
        <button
          type="button"
          onClick={() => dispatch({ type: "resetDesign" })}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        >
          <ResetIcon />
          Reset design
        </button>
      </div>

      <div className="design-canvas-stage p-4 sm:p-6">
        <div className="mx-auto w-full max-w-[min(100%,58dvh)] rounded-sm border border-white/10 bg-[#17181b] p-4 shadow-2xl sm:p-6">
          <div className="mb-3 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
            <span>Poster / live</span>
            <span>1080 x 1350</span>
          </div>
          <div className="aspect-[4/5] border border-white/10 shadow-sm">
            <Poster design={design} />
          </div>
        </div>
      </div>

      <div className="tldraw-board-section">
        <div className="tldraw-board-section-heading">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">Freeform board</p>
            <p className="mt-1 text-xs text-muted">Arrange thoughts beside the live poster.</p>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">Embedded</span>
        </div>
        <TldrawBoard />
      </div>

      <div className="canvas-tool-strip border-y border-line bg-panel px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">Studio tools</p>
            <p className="mt-1 text-xs text-muted">Keep the poster model fast; use the board for loose composition.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void checkLayout()} disabled={checking}>
              {checking ? "Checking…" : "Check layout"}
            </Button>
          </div>
        </div>
        {coach ? (
          <div className="mt-3 rounded-md border border-line bg-paper px-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              <span>Gemini coach</span>
              <span className="rounded border border-line px-1.5 py-0.5">{coach.focus}</span>
              {coach.usedTool ? <span className="rounded border border-line px-1.5 py-0.5">TigerData search</span> : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink">{coach.feedback}</p>
            {coach.assets.length > 0 ? (
              <p className="mt-2 text-[11px] text-muted">
                Referenced from the shared library: {coach.assets.map((asset) => asset.name).join(", ")}.
              </p>
            ) : null}
          </div>
        ) : null}
        {coachError ? <p className="mt-3 text-xs text-muted" role="status">{coachError}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>Vector poster renderer</span>
          <span aria-hidden="true">·</span>
          <span>tldraw is embedded above</span>
          <span aria-hidden="true">·</span>
          <a href="https://github.com/storytold/photocraft" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
            PhotoCraft WASM reference ↗
          </a>
        </div>
      </div>

      <div className="mt-auto grid gap-5 border-t border-line bg-panel p-4 sm:grid-cols-2 sm:p-6">
        <Field label="Headline" hint="Press Enter for a new line.">
          <textarea
            rows={2}
            maxLength={80}
            value={design.headline}
            onChange={(event) =>
              dispatch({ type: "setCopy", key: "headline", value: event.target.value })
            }
            className={`${inputClass} resize-none`}
          />
        </Field>

        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <ColorField
            label="Accent color"
            value={design.colors.accent}
            onChange={(value) => dispatch({ type: "setColor", key: "accent", value })}
          />
          <div className="grid gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              Alignment
            </span>
            <SegmentedControl
              label="Text alignment"
              value={design.layout.alignment}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
              ]}
              onChange={(value) => dispatch({ type: "setAlignment", value })}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              Spacing
            </span>
            <SegmentedControl
              label="Layout spacing"
              value={design.layout.spacing}
              options={[
                { value: "compact", label: "Compact" },
                { value: "normal", label: "Normal" },
                { value: "spacious", label: "Spacious" },
              ]}
              onChange={(value) => dispatch({ type: "setSpacing", value })}
            />
          </div>
        </div>

        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.14em] text-muted hover:text-ink">
            Edit poster copy
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {COPY_FIELDS.map((field) => (
              <Field key={field.key} label={field.label}>
                <input
                  type="text"
                  value={design[field.key]}
                  onChange={(event) =>
                    dispatch({ type: "setCopy", key: field.key, value: event.target.value })
                  }
                  className={inputClass}
                />
              </Field>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
