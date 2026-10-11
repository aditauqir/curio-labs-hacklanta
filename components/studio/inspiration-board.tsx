"use client";

import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import Image from "next/image";
import type { DesignState } from "@/lib/design-types";
import { getFontPair, referenceCards } from "@/lib/design-presets";
import type { StudioAction } from "@/lib/design-state";
import type { ImportedReference } from "@/lib/image-import-client";
import { ColorPaletteSelector } from "./color-palette-selector";
import { CreativeBrief } from "./creative-brief";
import { TypographySelector } from "./typography-selector";

const THUMBNAIL_THEMES = [
  { background: "#E8D9BF", ink: "#2B2723", accent: "#D8784C" },
  { background: "#F7F7F4", ink: "#171717", accent: "#171717" },
  { background: "#151719", ink: "#F2EEE6", accent: "#C9F05D" },
  { background: "#E9E0F2", ink: "#1C1724", accent: "#7D45B7" },
  { background: "#D8E5EB", ink: "#10212A", accent: "#D44B3D" },
  { background: "#F0D8D2", ink: "#351D1B", accent: "#C52F54" },
];

const TEXTURE_STUDIES = [
  { id: "paper", label: "Paper grain", className: "is-paper" },
  { id: "ink", label: "Ink wash", className: "is-ink" },
  { id: "signal", label: "Signal noise", className: "is-signal" },
];

type LoadedLibraryAsset = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceUrl: string | null;
};

type LoadedPipelineAsset = {
  id: string;
  projectId: string;
  projectName: string;
  conceptId: string | null;
  type: string;
  role: string;
  description: string;
  source: string;
  status: string;
  note: string;
};

type DisplayReference = {
  id: string;
  title: string;
  category: string;
  source: string;
  sourceUrl: string;
};

function isLoadedLibraryAsset(value: unknown): value is LoadedLibraryAsset {
  if (typeof value !== "object" || value === null) return false;
  const asset = value as Record<string, unknown>;
  return (
    typeof asset.id === "string" &&
    typeof asset.kind === "string" &&
    typeof asset.name === "string" &&
    (asset.description === null || typeof asset.description === "string") &&
    Array.isArray(asset.tags) &&
    asset.tags.every((tag) => typeof tag === "string") &&
    typeof asset.metadata === "object" &&
    asset.metadata !== null &&
    !Array.isArray(asset.metadata) &&
    (asset.sourceUrl === null || typeof asset.sourceUrl === "string")
  );
}

function isLoadedPipelineAsset(value: unknown): value is LoadedPipelineAsset {
  if (typeof value !== "object" || value === null) return false;
  const asset = value as Record<string, unknown>;
  return (
    typeof asset.id === "string" &&
    typeof asset.projectId === "string" &&
    typeof asset.projectName === "string" &&
    (asset.conceptId === null || typeof asset.conceptId === "string") &&
    typeof asset.type === "string" &&
    typeof asset.role === "string" &&
    typeof asset.description === "string" &&
    typeof asset.source === "string" &&
    typeof asset.status === "string" &&
    typeof asset.note === "string"
  );
}

function referenceCardsFromLibrary(assets: LoadedLibraryAsset[]): DisplayReference[] {
  return assets.map((asset) => {
    const referenceId = typeof asset.metadata.referenceId === "string" ? asset.metadata.referenceId : null;
    const fallback = referenceCards.find(
      (card) => card.id === referenceId || asset.id === `reference:${card.id}`,
    );
    return {
      id: asset.id,
      title: asset.name || fallback?.title || "Curio reference",
      category: asset.description || fallback?.category || "Curio library reference",
      source: fallback?.source || "Curio library",
      sourceUrl: asset.sourceUrl || fallback?.sourceUrl || "",
    };
  });
}

function ReferenceThumb({ index }: { index: number }) {
  const theme = THUMBNAIL_THEMES[index % THUMBNAIL_THEMES.length];
  const geometry = index % 4;

  return (
    <svg
      viewBox="0 0 160 110"
      aria-hidden="true"
      className="block h-auto w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="160" height="110" fill={theme.background} />
      <rect x="8" y="8" width="144" height="94" fill="none" stroke={theme.ink} strokeWidth="1" opacity="0.5" />
      <rect x="16" y="18" width={32 + (index % 3) * 11} height="5" fill={theme.ink} />
      <rect x="16" y="29" width={66 + (index % 4) * 12} height="3" fill={theme.ink} opacity="0.55" />
      {geometry === 0 ? (
        <>
          <circle cx="116" cy="61" r={25 + (index % 3) * 5} fill="none" stroke={theme.accent} strokeWidth="4" />
          <circle cx="116" cy="61" r="7" fill={theme.accent} />
        </>
      ) : null}
      {geometry === 1 ? (
        <>
          <rect x="18" y="49" width="74" height="13" fill={theme.ink} />
          <rect x="18" y="68" width="47" height="13" fill={theme.accent} />
          <rect x="104" y="40" width="23" height="48" fill={theme.accent} opacity="0.85" />
        </>
      ) : null}
      {geometry === 2 ? (
        <>
          <rect x="16" y="45" width="6" height="49" fill={theme.accent} />
          <path d="M34 88 L78 36 L126 88 Z" fill="none" stroke={theme.accent} strokeWidth="4" />
          <circle cx="126" cy="22" r="13" fill={theme.ink} />
        </>
      ) : null}
      {geometry === 3 ? (
        <>
          <rect x="17" y="46" width="115" height="37" fill={theme.accent} opacity="0.9" />
          <rect x="27" y="55" width="92" height="8" fill={theme.background} />
          <rect x="27" y="69" width="55" height="5" fill={theme.ink} />
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
  const [libraryAssets, setLibraryAssets] = useState<LoadedLibraryAsset[]>([]);
  const [pipelineAssets, setPipelineAssets] = useState<LoadedPipelineAsset[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/assets", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("library"))))
      .then((json: { assets?: unknown; pipelineAssets?: unknown }) => {
        const assets = Array.isArray(json.assets) ? json.assets.filter(isLoadedLibraryAsset) : [];
        const loadedPipelineAssets = Array.isArray(json.pipelineAssets)
          ? json.pipelineAssets.filter(isLoadedPipelineAsset)
          : [];
        setLibraryAssets(assets);
        setPipelineAssets(loadedPipelineAssets);
        setLibraryStatus(assets.length > 0 ? "ready" : "fallback");
      })
      .catch(() => setLibraryStatus("fallback"));

    return () => controller.abort();
  }, []);

  const libraryReferences = referenceCardsFromLibrary(libraryAssets.filter((asset) => asset.kind === "reference"));
  const visibleReferenceCards = libraryReferences.length > 0 ? libraryReferences : referenceCards;
  const loadedFonts = libraryAssets.filter((asset) => asset.kind === "font");
  const loadedPalettes = libraryAssets.filter((asset) => asset.kind === "palette");
  const loadedReferences = libraryAssets.filter((asset) => asset.kind === "reference");
  const loadedAssetCount = libraryAssets.length + pipelineAssets.length;
  const libraryLabel =
    libraryStatus === "ready"
      ? `${loadedAssetCount} loaded`
      : libraryStatus === "loading"
        ? "Loading"
        : pipelineAssets.length > 0
          ? `${pipelineAssets.length} pipeline loaded`
          : "Local fallback";

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
        <div className="studio-compact-reference-section" aria-labelledby="compact-library-heading">
          <div className="studio-compact-reference-section-heading">
            <span id="compact-library-heading">Loaded assets</span>
            <span>{libraryLabel}</span>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Loaded Curio assets">
            {[...loadedFonts.slice(0, 2), ...loadedPalettes.slice(0, 2), ...loadedReferences.slice(0, 2)].map((asset) => (
              <li key={asset.id} className="rounded-full border border-line px-2 py-1 text-[10px] text-muted">
                {asset.name}
              </li>
            ))}
            {pipelineAssets.slice(0, 4).map((asset) => (
              <li
                key={`${asset.projectId}:${asset.id}`}
                className="rounded-full border border-line px-2 py-1 text-[10px] text-muted"
                title={`${asset.description} · ${asset.source} · ${asset.status}`}
              >
                {asset.projectName} · {asset.role}
              </li>
            ))}
            {libraryStatus === "fallback" ? (
              <li className="text-[10px] text-muted">Using curated local presets</li>
            ) : null}
          </ul>
        </div>
        <div className="studio-compact-reference-section" aria-labelledby="compact-references-heading">
          <div className="studio-compact-reference-section-heading">
            <span id="compact-references-heading">References</span>
            <span>Studies</span>
          </div>
          <ul className="studio-compact-reference-grid" aria-label="Reference studies">
            {visibleReferenceCards.slice(0, 4).map((card) => (
              <li key={card.id}>
                <a href={card.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${card.title}`}>
                  <span className="studio-compact-reference-placeholder" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="studio-compact-reference-section" aria-labelledby="compact-textures-heading">
          <div className="studio-compact-reference-section-heading">
            <span id="compact-textures-heading">Textures</span>
            <span>Surface cues</span>
          </div>
          <ul className="studio-compact-texture-grid" aria-label="Texture studies">
            {TEXTURE_STUDIES.map((texture) => (
              <li key={texture.id}>
                <span className={`studio-compact-texture-swatch ${texture.className}`} aria-hidden="true" />
                <span>{texture.label}</span>
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
        note={`${visibleReferenceCards.length} ${libraryStatus === "ready" ? "library assets loaded from Curio" : "curated local"} references. Curio uses its own thumbnails; open a card for the source search.`}
      >
        <ul className="grid gap-3">
          {visibleReferenceCards.map((card, index) => (
            <li key={card.id} className="overflow-hidden rounded-md border border-line bg-paper">
              <ReferenceThumb index={index} />
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
