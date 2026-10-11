"use client";

import type { Dispatch } from "react";
import type { DesignState } from "@/lib/design-types";
import type { StudioAction } from "@/lib/design-state";
import type { PosterEdits } from "@/lib/poster-editor";
import type { ImportedReference } from "@/lib/image-import-client";
import { PanelLeftIcon } from "./icons";
import { InspirationBoard } from "./inspiration-board";
import { LayersPanel } from "./layers-panel";

export function StudioInspector({
  referenceOpen,
  layersOpen,
  importedReference,
  design,
  selectedPaletteId,
  dispatch,
  posterEdits,
  layerOrder,
  selectedLayerId,
  onSelectLayer,
  onToggleLayerVisibility,
  onToggleLayerLock,
  onDeleteLayer,
  onReorderLayer,
  onToggleReference,
  onToggleLayers,
}: {
  referenceOpen: boolean;
  layersOpen: boolean;
  importedReference: ImportedReference | null;
  design: DesignState;
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
  posterEdits: PosterEdits;
  layerOrder: string[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onToggleLayerVisibility: (id: string) => void;
  onToggleLayerLock: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayer: (id: string, direction: "up" | "down") => void;
  onToggleReference: () => void;
  onToggleLayers: () => void;
}) {
  return (
    <div className={`studio-inspector-shell ${referenceOpen && layersOpen ? "is-split" : ""}`}>
      {referenceOpen ? (
        <section className="studio-inspector-pane studio-inspector-reference-pane">
          <div className="studio-inspector-pane-heading">
            <span>Reference</span>
            <button type="button" onClick={onToggleReference} aria-label="Hide reference panel" title="Hide reference panel">
              <PanelLeftIcon />
            </button>
          </div>
          <InspirationBoard
            design={design}
            selectedPaletteId={selectedPaletteId}
            dispatch={dispatch}
            compact
            importedReference={importedReference}
          />
        </section>
      ) : null}
      {layersOpen ? (
        <section className="studio-inspector-pane studio-inspector-layers-pane">
          <div className="studio-inspector-pane-heading">
            <span>Layers</span>
            <button type="button" onClick={onToggleLayers} aria-label="Hide layers panel" title="Hide layers panel">
              <PanelLeftIcon />
            </button>
          </div>
          <LayersPanel
            design={design}
            compact={referenceOpen}
            posterEdits={posterEdits}
            layerOrder={layerOrder}
            selectedLayerId={selectedLayerId}
            onSelectLayer={onSelectLayer}
            onToggleLayerVisibility={onToggleLayerVisibility}
            onToggleLayerLock={onToggleLayerLock}
            onDeleteLayer={onDeleteLayer}
            onReorderLayer={onReorderLayer}
          />
        </section>
      ) : null}
    </div>
  );
}
