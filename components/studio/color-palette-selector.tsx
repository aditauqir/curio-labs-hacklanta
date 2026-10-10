"use client";

import type { Dispatch } from "react";
import { colorPalettes } from "@/lib/design-presets";
import type { StudioAction } from "@/lib/design-state";

export function ColorPaletteSelector({
  selectedId,
  dispatch,
}: {
  selectedId: string | null;
  dispatch: Dispatch<StudioAction>;
}) {
  return (
    <ul className="grid gap-3">
      {colorPalettes.map((palette) => {
        const active = palette.id === selectedId;
        const swatches = [
          palette.colors.background,
          palette.colors.foreground,
          palette.colors.accent,
          palette.colors.muted,
        ];
        return (
          <li
            key={palette.id}
            className={`rounded-md border p-3 ${active ? "border-ink bg-paper" : "border-line"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{palette.name}</p>
                <p className="text-xs text-muted">{palette.note}</p>
              </div>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => dispatch({ type: "setPalette", id: palette.id })}
                className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-line text-muted hover:border-ink hover:text-ink"
                }`}
              >
                {active ? "Applied" : "Apply"}
              </button>
            </div>
            <ul className="mt-3 grid grid-cols-4 gap-2">
              {swatches.map((color, index) => (
                <li key={`${palette.id}-${index}`}>
                  <span
                    className="block h-8 rounded border border-line"
                    style={{ backgroundColor: color }}
                  />
                  <span className="mt-1 block font-mono text-[10px] uppercase text-muted">
                    {color}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
