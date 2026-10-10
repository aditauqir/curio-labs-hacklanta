"use client";

import type { Dispatch } from "react";
import type { ChatMessage, DesignState } from "@/lib/design-types";
import type { StudioAction } from "@/lib/design-state";
import { CreativeBrief } from "./creative-brief";
import { CreativeDirector } from "./creative-director";
import { Poster } from "./poster";

export function ChatScreen({
  design,
  messages,
  selectedPaletteId,
  dispatch,
  initialPrompt,
  onBack,
  onOpenEditor,
}: {
  design: DesignState;
  messages: ChatMessage[];
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
  initialPrompt: string | null;
  onBack: () => void;
  onOpenEditor: () => void;
}) {
  return (
    <main className="chat-screen" data-testid="chat-screen">
      <header className="chat-screen-header">
        <button type="button" className="chat-screen-brand" onClick={onBack}>
          <span className="brand-dot" aria-hidden="true" />
          <span>CURIO LABS</span>
        </button>
        <div className="chat-screen-title">
          <span>Director session</span>
          <span className="chat-screen-title-detail">{design.styleLabel}</span>
        </div>
        <button type="button" className="chat-screen-editor-link" onClick={onOpenEditor}>
          Open full editor
          <span aria-hidden="true">-&gt;</span>
        </button>
      </header>

      <div className="chat-screen-grid">
        <aside className="chat-context-card chat-context-card-poster" aria-label="Current direction">
          <div className="chat-context-kicker">Current direction</div>
          <div className="chat-context-poster">
            <Poster design={design} />
          </div>
          <div className="chat-context-copy">
            <p>{design.styleLabel}</p>
            <span>{design.mood}</span>
          </div>
        </aside>

        <div className="chat-screen-main">
          <CreativeDirector
            messages={messages}
            design={design}
            selectedPaletteId={selectedPaletteId}
            dispatch={dispatch}
            initialPrompt={initialPrompt}
          />
        </div>

        <aside className="chat-context-card chat-context-card-brief" aria-label="Direction summary">
          <div className="chat-context-kicker">Direction summary</div>
          <p className="chat-context-heading">Make the vague part useful.</p>
          <p className="chat-context-note">
            Ask for a mood, type, color, or one precise change. Curio keeps the rest of the design
            intact.
          </p>
          <div className="chat-context-brief">
            <CreativeBrief
              design={design}
              selectedPaletteId={selectedPaletteId}
              dispatch={dispatch}
            />
          </div>
          <button type="button" className="chat-context-action" onClick={onOpenEditor}>
            Tune the poster in the editor
            <span aria-hidden="true">-&gt;</span>
          </button>
        </aside>
      </div>
    </main>
  );
}
