"use client";

import type { Dispatch, ReactNode } from "react";
import Image from "next/image";
import type { DesignState } from "@/lib/design-types";
import { getFontPair, referenceCards } from "@/lib/design-presets";
import type { StudioAction } from "@/lib/design-state";
import type { ImportedReference } from "@/lib/image-import-client";
import { referenceLooks, type ReferenceLook } from "@/lib/reference-looks";
import { ColorPaletteSelector } from "./color-palette-selector";
import { CreativeBrief } from "./creative-brief";
import { TypographySelector } from "./typography-selector";

/** A CSS preview of a look: its screen as a dot or line field, or its gradient map. */
function lookSwatchStyle(look: ReferenceLook) {
  const { background, foreground, accent } = look.palette;
  if (!look.screen) {
    return { background: `radial-gradient(circle at 68% 62%, ${foreground} 0 12%, ${accent} 30%, ${background} 62%)` };
  }
  const field = look.screen.asset.includes("line")
    ? `repeating-linear-gradient(0deg, ${foreground} 0 1px, transparent 1px 4px)`
    : `radial-gradient(circle, ${foreground} 0 32%, transparent 36%) 0 0 / 5px 5px`;
  return { background: `${field}, ${background}` };
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
  compact = false,
  importedReference,
}: {
  design: DesignState;
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
  compact?: boolean;
  importedReference?: ImportedReference | null;
}) {
  const fontPair = getFontPair(design.typography.id);

  if (compact) {
    return (
      <section aria-label="Reference" className="studio-compact-reference">
        {importedReference ? (
          <div className="studio-compact-imported-reference">
            <Image
              src={importedReference.previewUrl}
              alt={`Imported reference: ${importedReference.filename}`}
              width={52}
              height={52}
              unoptimized
            />
            <div>
              <span>Imported reference</span>
              <p>{importedReference.summary}</p>
            </div>
          </div>
        ) : null}
        <div className="studio-compact-reference-heading">
          <p>Reference</p>
          <span>{design.projectName || "Untitled poster"}</span>
        </div>
        <div className="studio-compact-reference-section" aria-labelledby="compact-fonts-heading">
          <div className="studio-compact-reference-section-heading">
            <span id="compact-fonts-heading">Fonts</span>
            <span>Current pairing</span>
          </div>
          <div className="studio-compact-fonts" aria-label="Current fonts">
            <span>{fontPair.heading}</span>
            <span>{fontPair.body}</span>
          </div>
        </div>
        <div className="studio-compact-reference-section" aria-labelledby="compact-references-heading">
          <div className="studio-compact-reference-section-heading">
            <span id="compact-references-heading">References</span>
            <span>Image assets</span>
          </div>
          <ul className="studio-compact-reference-grid" aria-label="Reference image assets">
            {referenceCards.map((card) => (
              <li key={card.id}>
                <a href={card.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${card.title}`} title={`${card.title} · ${card.category}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static native-scale crop; resizing would smear the screen */}
                  <img className="studio-compact-reference-placeholder" src={card.thumbnail} alt="" loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="studio-compact-reference-section" aria-labelledby="compact-textures-heading">
          <div className="studio-compact-reference-section-heading">
            <span id="compact-textures-heading">Looks</span>
            <span>Screen, paper, grain</span>
          </div>
          <ul className="studio-compact-texture-grid" aria-label="Reference looks">
            {referenceLooks.map((look) => (
              <li key={look.id}>
                <button
                  type="button"
                  className="studio-compact-look"
                  aria-pressed={design.lookId === look.id}
                  title={look.summary}
                  onClick={() => dispatch({ type: "setLook", id: look.id })}
                >
                  <span className="studio-compact-texture-swatch" style={lookSwatchStyle(look)} aria-hidden="true" />
                  <span>{look.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Inspiration board"
      className="studio-inspector flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel"
    >
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-5 py-4">
        <p className="studio-reference-kicker">Reference</p>
        <p className="studio-reference-title mt-1 text-lg text-ink">
          {design.projectName || "Untitled poster"}
        </p>
        <p className="mt-1 text-xs text-muted">
          {design.styleLabel} · {design.mood}
        </p>
      </div>
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
        note={`${referenceCards.length} image assets from curio/assets that the reference looks are built from. Open a card for the full-size file.`}
      >
        <ul className="grid gap-3">
          {referenceCards.map((card) => (
            <li key={card.id} className="overflow-hidden rounded-md border border-line bg-paper">
              {/* eslint-disable-next-line @next/next/no-img-element -- static native-scale crop; resizing would smear the screen */}
              <img src={card.thumbnail} alt="" loading="lazy" className="block aspect-[16/11] w-full object-cover" />
              <div className="border-t border-line px-3 py-2.5">
                <p className="text-sm font-medium">{card.title}</p>
                <p className="text-xs text-muted">{card.category}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted">{card.source}</p>
                  <a
                    href={card.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-medium text-ink underline decoration-line underline-offset-2 hover:opacity-60"
                  >
                    Open ↗
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
