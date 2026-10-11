"use client";

import type { DesignState } from "@/lib/design-types";
import { buildPoster, normalizeLayerOrder, type PosterShape, type PosterText } from "@/lib/poster-layout";
import type { PosterEdits } from "@/lib/poster-editor";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  LayersIcon,
  LockIcon,
  LockOpenIcon,
  TrashIcon,
} from "./icons";

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

function layersFor(design: DesignState, layerOrder: string[]): Layer[] {
  const model = buildPoster(design);
  const layers = [
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
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  return normalizeLayerOrder(model, layerOrder)
    .map((id) => layersById.get(id))
    .filter((layer): layer is Layer => Boolean(layer));
}

export function LayersPanel({
  design,
  compact = false,
  posterEdits,
  layerOrder,
  selectedLayerId,
  onSelectLayer,
  onToggleLayerVisibility,
  onToggleLayerLock,
  onDeleteLayer,
  onReorderLayer,
}: {
  design: DesignState;
  compact?: boolean;
  posterEdits: PosterEdits;
  layerOrder: string[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onToggleLayerVisibility: (id: string) => void;
  onToggleLayerLock: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayer: (id: string, direction: "up" | "down") => void;
}) {
  const layers = layersFor(design, layerOrder);

  return (
    <section
      aria-label="Layers"
      className={`studio-inspector flex min-h-0 flex-1 flex-col overflow-y-auto ${
        compact ? "studio-layers-panel-compact" : ""
      }`}
      style={{ backgroundColor: "#0c0c0c" }}
    >
      {!compact ? (
        <div
          className="sticky top-0 z-10 border-b border-line px-5 py-4"
          style={{ backgroundColor: "#0c0c0c" }}
        >
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
                    aria-label={`Move ${layer.name} up`}
                    title={`Move ${layer.name} up`}
                    disabled={layer.id === "background" || index === 0}
                    onClick={() => onReorderLayer(layer.id, "up")}
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${layer.name} down`}
                    title={`Move ${layer.name} down`}
                    disabled={layer.id === "background" || index >= layers.length - 2}
                    onClick={() => onReorderLayer(layer.id, "down")}
                  >
                    <ArrowDownIcon />
                  </button>
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
                    title={`${locked ? "Unlock" : "Lock"} ${layer.name}`}
                    onClick={() => onToggleLayerLock(layer.id)}
                  >
                    {locked ? <LockIcon /> : <LockOpenIcon />}
                  </button>
                  <button
                    type="button"
                    className="is-delete"
                    aria-label={`Delete ${layer.name}`}
                    title={layer.id === "background" ? "Background cannot be deleted" : `Delete ${layer.name}`}
                    disabled={layer.id === "background"}
                    onClick={() => onDeleteLayer(layer.id)}
                  >
                    <TrashIcon />
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
