"use client";

import type { Dispatch } from "react";
import type { DesignState } from "@/lib/design-types";
import type { CopyKey, StudioAction } from "@/lib/design-state";
import { directionConfigs, directionOrder } from "@/lib/design-presets";
import { Poster } from "./poster";
import { ResetIcon } from "./icons";
import { ColorField, Field, SegmentedControl, inputClass } from "./ui";

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
  return (
    <section
      aria-label="Design canvas"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <SegmentedControl
          label="Visual direction"
          value={design.direction}
          options={directionOrder.map((direction) => ({
            value: direction,
            label: directionConfigs[direction].label,
          }))}
          onChange={(direction) => dispatch({ type: "setDirection", direction })}
        />
        <button
          type="button"
          onClick={() => dispatch({ type: "resetDesign" })}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          <ResetIcon />
          Reset design
        </button>
      </div>

      <div className="p-4 sm:p-6">
        <div className="mx-auto aspect-[4/5] w-full max-w-[min(100%,58dvh)] border border-line shadow-sm">
          <Poster design={design} />
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
