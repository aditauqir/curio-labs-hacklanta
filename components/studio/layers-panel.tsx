"use client";

import type { DesignState } from "@/lib/design-types";
import { buildPoster, type PosterShape, type PosterText } from "@/lib/poster-layout";
import type { PosterEdits } from "@/lib/poster-editor";
import { EyeIcon, LayersIcon } from "./icons";

type Layer = {
  id: string;
  name: string;
  kind: string;
  detail: string;
};

function title(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function textName(item: PosterText) {
  if (item.id.startsWith("headline-")) return "Headline";
  return title(item.id);
}

function shapeDetail(shape: PosterShape) {
  return shape.kind === "line" ? "Line" : shape.kind === "circle" ? "Circle" : "Rectangle";
}

function layersFor(design: DesignState): Layer[] {
  const model = buildPoster(design);
  return [
    ...model.texts.map((item) => ({
      id: item.id,
      name: textName(item),
      kind: "Type",
      detail: item.text || "Empty text",
    })),
    ...model.shapes.map((shape) => ({
      id: shape.id,
      name: title(shape.id),
      kind: "Graphic",
      detail: shapeDetail(shape),
    })),
    {
      id: "background",
      name: "Background",
      kind: "Surface",
      detail: design.colors.background.toUpperCase(),
    },
  ];
}

export function LayersPanel({
  design,
  compact = false,
  posterEdits,
  selectedLayerId,
  onSelectLayer,
  onToggleLayerVisibility,
  onToggleLayerLock,
}: {
  design: DesignState;
  compact?: boolean;
  posterEdits: PosterEdits;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onToggleLayerVisibility: (id: string) => void;
  onToggleLayerLock: (id: string) => void;
}) {
  const layers = layersFor(design);

  return (
    <section
      aria-label="Layers"
      className={`studio-inspector flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel ${
        compact ? "studio-layers-panel-compact" : ""
      }`}
    >
      {!compact ? (
        <div className="sticky top-0 z-10 border-b border-line bg-panel px-5 py-4">
          <p className="studio-reference-kicker">Layers</p>
          <p className="studio-reference-title mt-1 text-lg text-ink">
            {design.projectName || "Untitled poster"}
          </p>
          <p className="mt-1 text-xs text-muted">Editable poster stack</p>
        </div>
      ) : null}

      <div className="studio-layers-body px-5 py-5">
        {!compact ? (
          <div className="studio-layers-summary">
            <span>Poster layers</span>
            <span>{String(layers.length).padStart(2, "0")}</span>
          </div>
        ) : null}
        <ol className="studio-layer-list" aria-label="Poster layers">
          {layers.map((layer, index) => {
            const edit = posterEdits[layer.id];
            const visible = edit?.visible ?? true;
            const locked = edit?.locked ?? layer.id === "background";
            return (
              <li key={layer.id} className="studio-layer-item">
                <button
                  type="button"
                  className={`studio-layer-row ${selectedLayerId === layer.id ? "is-selected" : ""} ${!visible ? "is-hidden" : ""}`}
                  aria-pressed={selectedLayerId === layer.id}
                  onClick={() => onSelectLayer(layer.id)}
                >
                  <span className="studio-layer-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="studio-layer-icon" aria-hidden="true">
                    <LayersIcon />
                  </span>
                  <span className="studio-layer-copy">
                    <strong>{layer.name}</strong>
                    <small>
                      {layer.kind} · {layer.detail}
                    </small>
                  </span>
                </button>
                <div className="studio-layer-actions">
                  <button
                    type="button"
                    className={!visible ? "is-off" : ""}
                    aria-label={`${visible ? "Hide" : "Show"} ${layer.name}`}
                    onClick={() => onToggleLayerVisibility(layer.id)}
                  >
                    <EyeIcon />
                  </button>
                  <button
                    type="button"
                    className={locked ? "is-locked" : ""}
                    aria-label={`${locked ? "Unlock" : "Lock"} ${layer.name}`}
                    onClick={() => onToggleLayerLock(layer.id)}
                  >
                    {locked ? "L" : "·"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        {!compact ? (
          <p className="studio-layers-note">
            Select a layer, drag it on the poster, or use the transform controls. Delete hides it without destroying the source.
          </p>
        ) : null}
      </div>
    </section>
  );
}
