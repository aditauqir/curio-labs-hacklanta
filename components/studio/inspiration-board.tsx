"use client";

import type { Dispatch, ReactNode } from "react";
import type { DesignState } from "@/lib/design-types";
import { referenceCards } from "@/lib/design-presets";
import type { StudioAction } from "@/lib/design-state";
import { ColorPaletteSelector } from "./color-palette-selector";
import { CreativeBrief } from "./creative-brief";
import { TypographySelector } from "./typography-selector";

function ReferenceThumb({ id }: { id: string }) {
  return (
    <svg
      viewBox="0 0 160 110"
      aria-hidden="true"
      className="block h-auto w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      {id === "late-set" ? (
        <>
          <rect width="160" height="110" fill="#E8D9BF" />
          <rect x="6" y="6" width="148" height="98" fill="none" stroke="#2B2723" strokeWidth="1" />
          <circle cx="112" cy="62" r="30" fill="none" stroke="#D8784C" strokeWidth="4" />
          <circle cx="112" cy="62" r="20" fill="none" stroke="#D8784C" strokeWidth="1.5" />
          <circle cx="112" cy="62" r="6" fill="#D8784C" />
          <rect x="16" y="24" width="52" height="8" fill="#2B2723" />
          <rect x="16" y="38" width="36" height="8" fill="#2B2723" />
        </>
      ) : null}
      {id === "paper-studies" ? (
        <>
          <rect width="160" height="110" fill="#F7F7F4" />
          <rect x="14" y="14" width="132" height="1" fill="#171717" opacity="0.4" />
          <rect x="14" y="30" width="30" height="5" fill="#171717" />
          <rect x="14" y="44" width="104" height="14" fill="#171717" />
          <rect x="14" y="62" width="70" height="14" fill="#171717" />
          <rect x="14" y="96" width="132" height="1" fill="#171717" opacity="0.4" />
        </>
      ) : null}
      {id === "signal-noise" ? (
        <>
          <rect width="160" height="110" fill="#151719" />
          <rect width="7" height="110" fill="#C9F05D" />
          <circle cx="132" cy="26" r="26" fill="none" stroke="#C9F05D" strokeWidth="3" opacity="0.6" />
          <rect x="22" y="30" width="108" height="16" fill="#F2EEE6" />
          <rect x="40" y="52" width="90" height="16" fill="#C9F05D" />
          <rect x="7" y="100" width="153" height="10" fill="#C9F05D" />
        </>
      ) : null}
    </svg>
  );
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="border-b border-line px-5 py-5 last:border-b-0">
      <h3
        id={id}
        className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted"
      >
        {title}
      </h3>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function InspirationBoard({
  design,
  selectedPaletteId,
  dispatch,
}: {
  design: DesignState;
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
}) {
  return (
    <section
      aria-label="Inspiration board"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel"
    >
      <Section
        id="brief-heading"
        title="Creative brief"
        note="These decisions drive the canvas. Edit any one without changing the others."
      >
        <CreativeBrief
          design={design}
          selectedPaletteId={selectedPaletteId}
          dispatch={dispatch}
        />
      </Section>

      <Section id="typography-heading" title="Typography">
        <TypographySelector selectedId={design.typography.id} dispatch={dispatch} />
      </Section>

      <Section id="palette-heading" title="Color palettes">
        <ColorPaletteSelector selectedId={selectedPaletteId} dispatch={dispatch} />
      </Section>

      <Section
        id="references-heading"
        title="Visual references"
        note="Original placeholders for the demo. Real references arrive with the research integration."
      >
        <ul className="grid gap-3">
          {referenceCards.map((card) => (
            <li key={card.id} className="overflow-hidden rounded-md border border-line bg-paper">
              <ReferenceThumb id={card.id} />
              <div className="border-t border-line px-3 py-2.5">
                <p className="text-sm font-medium">{card.title}</p>
                <p className="text-xs text-muted">{card.category}</p>
                <p className="mt-1 text-[11px] text-muted">{card.source}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
