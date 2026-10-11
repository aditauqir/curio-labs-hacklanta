"use client";

import dynamic from "next/dynamic";
import { useState, type Dispatch } from "react";
import { askCoach, CoachError, type CoachReply } from "@/lib/coach-client";
import type { DesignState } from "@/lib/design-types";
import type { CopyKey, StudioAction } from "@/lib/design-state";
import { directionConfigs, directionOrder } from "@/lib/design-presets";
import { Poster } from "./poster";
import {
  BoardIcon,
  GridIcon,
  PanelRightIcon,
  ResetIcon,
  SlidersIcon,
  SparkleIcon,
} from "./icons";
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
  onToggleInspector,
}: {
  design: DesignState;
  dispatch: Dispatch<StudioAction>;
  onToggleInspector?: () => void;
}) {
  const [coach, setCoach] = useState<CoachReply | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);

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
    <section aria-label="Design canvas" className="design-canvas">
      <header className="design-canvas-header">
        <div className="design-canvas-heading">
          <span className="design-canvas-live-dot" aria-hidden="true" />
          <div>
            <p className="studio-eyebrow">Canvas</p>
            <p className="design-canvas-title">Live poster direction</p>
          </div>
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

        <div className="design-canvas-header-actions">
          <button
            type="button"
            className={`studio-tool-button ${boardOpen ? "is-active" : ""}`}
            onClick={() => setBoardOpen((open) => !open)}
            aria-pressed={boardOpen}
          >
            <BoardIcon />
            <span>Board</span>
          </button>
          <button
            type="button"
            className={`studio-tool-button ${propertiesOpen ? "is-active" : ""}`}
            onClick={() => setPropertiesOpen((open) => !open)}
            aria-pressed={propertiesOpen}
          >
            <SlidersIcon />
            <span>Properties</span>
          </button>
          {onToggleInspector ? (
            <button type="button" className="studio-tool-button studio-inspector-toggle" onClick={onToggleInspector}>
              <PanelRightIcon />
              <span>References</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="design-canvas-main">
        <div className="design-canvas-stage">
          <div className="design-canvas-poster-frame">
            <div className="design-canvas-poster-meta">
              <span>Poster / live</span>
              <span>1080 × 1350</span>
            </div>
            <div className="design-canvas-poster">
              <Poster design={design} />
            </div>
          </div>
        </div>

        <nav className="design-canvas-tool-rail" aria-label="Canvas tools">
          <button type="button" className="studio-rail-tool is-active" aria-label="Poster canvas" title="Poster canvas">
            <GridIcon />
          </button>
          <button
            type="button"
            className={`studio-rail-tool ${boardOpen ? "is-active" : ""}`}
            aria-label="Toggle tldraw board"
            title="Toggle tldraw board"
            onClick={() => setBoardOpen((open) => !open)}
          >
            <BoardIcon />
          </button>
          <button
            type="button"
            className={`studio-rail-tool ${propertiesOpen ? "is-active" : ""}`}
            aria-label="Toggle poster properties"
            title="Toggle poster properties"
            onClick={() => setPropertiesOpen((open) => !open)}
          >
            <SlidersIcon />
          </button>
          <span className="studio-rail-divider" aria-hidden="true" />
          <button
            type="button"
            className="studio-rail-tool"
            aria-label="Reset design"
            title="Reset design"
            onClick={() => dispatch({ type: "resetDesign" })}
          >
            <ResetIcon />
          </button>
        </nav>
      </div>

      <footer className="design-canvas-footer">
        <div className="design-canvas-footer-meta">
          <span className="design-canvas-footer-status" aria-hidden="true" />
          <span>Poster model synced</span>
        </div>
        <div className="design-canvas-footer-actions">
          <button type="button" className="studio-footer-button" onClick={() => void checkLayout()} disabled={checking}>
            <SparkleIcon />
            <span>{checking ? "Checking…" : "Check layout"}</span>
          </button>
          <a
            href="https://github.com/storytold/photocraft"
            target="_blank"
            rel="noreferrer"
            className="studio-footer-link"
          >
            PhotoCraft reference ↗
          </a>
        </div>
      </footer>

      {coach ? (
        <div className="studio-coach-card">
          <div className="studio-coach-heading">
            <span>Gemini coach</span>
            <span>{coach.focus}</span>
            {coach.usedTool ? <span>TigerData search</span> : null}
          </div>
          <p>{coach.feedback}</p>
          {coach.assets.length > 0 ? (
            <small>Library references: {coach.assets.map((asset) => asset.name).join(", ")}</small>
          ) : null}
        </div>
      ) : null}
      {coachError ? <p className="studio-coach-error" role="status">{coachError}</p> : null}

      {boardOpen ? (
        <section className="tldraw-board-drawer" aria-label="Embedded tldraw board">
          <div className="tldraw-board-drawer-heading">
            <div>
              <p className="studio-eyebrow">Freeform board</p>
              <p>Arrange loose thoughts beside the live poster.</p>
            </div>
            <button type="button" className="studio-footer-button" onClick={() => setBoardOpen(false)}>
              Close board
            </button>
          </div>
          <TldrawBoard />
        </section>
      ) : null}

      {propertiesOpen ? (
        <section className="studio-properties-panel" aria-label="Poster properties">
          <div className="studio-properties-heading">
            <div>
              <p className="studio-eyebrow">Poster properties</p>
              <p>Edit the live model without leaving the canvas.</p>
            </div>
            <button type="button" className="studio-footer-button" onClick={() => setPropertiesOpen(false)}>
              Done
            </button>
          </div>

          <div className="studio-properties-grid">
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

            <div className="studio-properties-options">
              <ColorField
                label="Accent color"
                value={design.colors.accent}
                onChange={(value) => dispatch({ type: "setColor", key: "accent", value })}
              />
              <div className="grid gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Alignment</span>
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
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Spacing</span>
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
          </div>

          <details className="studio-copy-details">
            <summary>Edit poster copy</summary>
            <div className="studio-copy-grid">
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
        </section>
      ) : null}
    </section>
  );
}
