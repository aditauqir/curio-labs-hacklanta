"use client";

import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";

export function TldrawBoard() {
  return (
    <div className="tldraw-board-embed" aria-label="Embedded freeform idea board">
      <Tldraw hideUi={false} persistenceKey="curio-idea-board" />
    </div>
  );
}
