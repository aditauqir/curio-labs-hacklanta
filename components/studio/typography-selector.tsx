"use client";

import type { Dispatch } from "react";
import { fontPairs } from "@/lib/design-presets";
import type { StudioAction } from "@/lib/design-state";

export function TypographySelector({
  selectedId,
  dispatch,
}: {
  selectedId: string;
  dispatch: Dispatch<StudioAction>;
}) {
  return (
    <ul className="grid gap-2">
      {fontPairs.map((pair) => {
        const active = pair.id === selectedId;
        return (
          <li key={pair.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => dispatch({ type: "setFontPair", id: pair.id })}
              className={`flex w-full items-center gap-4 rounded-md border px-3 py-3 text-left transition-colors ${
                active ? "border-ink bg-paper" : "border-line hover:border-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className="w-12 text-3xl leading-none"
                style={{ fontFamily: pair.headingFont, fontWeight: pair.headingWeight }}
              >
                Aa
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{pair.name}</span>
                <span className="text-xs text-muted">{pair.label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
