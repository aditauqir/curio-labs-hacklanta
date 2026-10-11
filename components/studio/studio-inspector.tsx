"use client";

import type { Dispatch } from "react";
import type { DesignState } from "@/lib/design-types";
import type { StudioAction } from "@/lib/design-state";
import type { PosterEdits } from "@/lib/poster-editor";
import { LayersIcon, PanelRightIcon } from "./icons";
import { InspirationBoard } from "./inspiration-board";
import { LayersPanel } from "./layers-panel";

export type InspectorTab = "layers" | "reference";

export function StudioInspector({
  activeTab,
  design,
  selectedPaletteId,
  dispatch,
  posterEdits,
  selectedLayerId,
  onSelectLayer,
  onToggleLayerVisibility,
  onToggleLayerLock,
  onTabChange,
}: {
  activeTab: InspectorTab;
  design: DesignState;
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
  posterEdits: PosterEdits;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onToggleLayerVisibility: (id: string) => void;
  onToggleLayerLock: (id: string) => void;
  onTabChange: (tab: InspectorTab) => void;
}) {
  return (
    <div className="studio-inspector-shell">
      {activeTab === "layers" ? (
        <div className="studio-inspector-tabs" role="tablist" aria-label="Inspector views">
          <button
            type="button"
            role="tab"
            aria-selected
            className="is-active"
            onClick={() => onTabChange("layers")}
          >
            <LayersIcon />
            <span>Layers</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            onClick={() => onTabChange("reference")}
          >
            <PanelRightIcon />
            <span>Reference</span>
          </button>
        </div>
      ) : null}

      {activeTab === "layers" ? (
        <LayersPanel
          design={design}
          posterEdits={posterEdits}
          selectedLayerId={selectedLayerId}
          onSelectLayer={onSelectLayer}
          onToggleLayerVisibility={onToggleLayerVisibility}
          onToggleLayerLock={onToggleLayerLock}
        />
      ) : (
        <div className="studio-inspector-reference-stack">
          <InspirationBoard
            design={design}
            selectedPaletteId={selectedPaletteId}
            dispatch={dispatch}
            compact
          />
          <div className="studio-inspector-layers-dock">
            <div className="studio-inspector-dock-heading">
              <span>Layers</span>
              <button type="button" onClick={() => onTabChange("layers")}>
                Open
              </button>
            </div>
            <LayersPanel
              design={design}
              compact
              posterEdits={posterEdits}
              selectedLayerId={selectedLayerId}
              onSelectLayer={onSelectLayer}
              onToggleLayerVisibility={onToggleLayerVisibility}
              onToggleLayerLock={onToggleLayerLock}
            />
          </div>
        </div>
      )}
    </div>
  );
}
