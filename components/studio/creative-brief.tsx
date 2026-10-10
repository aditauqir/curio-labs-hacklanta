"use client";

import type { Dispatch } from "react";
import type { DesignState, DesignDirection } from "@/lib/design-types";
import { directionConfigs, directionOrder, fontPairs } from "@/lib/design-presets";
import { getBrief, type StudioAction } from "@/lib/design-state";
import { inputClass } from "./ui";

export function CreativeBrief({
  design,
  selectedPaletteId,
  dispatch,
}: {
  design: DesignState;
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
}) {
  const rows = getBrief(design, selectedPaletteId);

  function editor(id: (typeof rows)[number]["id"]) {
    switch (id) {
      case "style":
        return (
          <select
            aria-label="Style"
            value={design.direction}
            onChange={(event) =>
              dispatch({
                type: "setDirection",
                direction: event.target.value as DesignDirection,
              })
            }
            className={inputClass}
          >
            {directionOrder.map((direction) => (
              <option key={direction} value={direction}>
                {directionConfigs[direction].label}
              </option>
            ))}
          </select>
        );
      case "typography":
        return (
          <select
            aria-label="Typography"
            value={design.typography.id}
            onChange={(event) => dispatch({ type: "setFontPair", id: event.target.value })}
            className={inputClass}
          >
            {fontPairs.map((pair) => (
              <option key={pair.id} value={pair.id}>
                {pair.name}
              </option>
            ))}
          </select>
        );
      case "background":
        return (
          <input
            type="color"
            aria-label="Background color"
            value={design.colors.background}
            onChange={(event) =>
              dispatch({ type: "setColor", key: "background", value: event.target.value })
            }
            className="h-9 w-14 cursor-pointer rounded border border-line bg-paper p-0.5"
          />
        );
      case "accent":
        return (
          <input
            type="color"
            aria-label="Accent color"
            value={design.colors.accent}
            onChange={(event) =>
              dispatch({ type: "setColor", key: "accent", value: event.target.value })
            }
            className="h-9 w-14 cursor-pointer rounded border border-line bg-paper p-0.5"
          />
        );
      case "mood":
        return (
          <input
            type="text"
            aria-label="Mood"
            maxLength={80}
            value={design.mood}
            onChange={(event) => dispatch({ type: "setMood", value: event.target.value })}
            className={inputClass}
          />
        );
      case "layout":
        return (
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Alignment"
              value={design.layout.alignment}
              onChange={(event) =>
                dispatch({
                  type: "setAlignment",
                  value: event.target.value as DesignState["layout"]["alignment"],
                })
              }
              className={inputClass}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <select
              aria-label="Spacing"
              value={design.layout.spacing}
              onChange={(event) =>
                dispatch({
                  type: "setSpacing",
                  value: event.target.value as DesignState["layout"]["spacing"],
                })
              }
              className={inputClass}
            >
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="spacious">Spacious</option>
            </select>
          </div>
        );
    }
  }

  return (
    <dl className="divide-y divide-line rounded-md border border-line bg-paper">
      {rows.map((row) => (
        <div key={row.id} className="grid gap-2 px-3 py-3">
          <dt className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {row.label}
            </span>
          </dt>
          <dd className="grid gap-2">
            <span className="text-sm font-medium">{row.value}</span>
            {editor(row.id)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
