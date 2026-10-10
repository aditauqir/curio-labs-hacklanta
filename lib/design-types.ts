export type DesignDirection = "vintage" | "minimal" | "experimental";
export type TextAlignment = "left" | "center" | "right";
export type Spacing = "compact" | "normal" | "spacious";

export type DesignState = {
  projectName: string;
  venue: string;
  headline: string;
  subtitle: string;
  date: string;
  time: string;
  footer: string;
  direction: DesignDirection;
  styleLabel: string;
  mood: string;
  typography: {
    id: string;
    label: string;
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
  };
  colors: {
    background: string;
    foreground: string;
    accent: string;
    muted: string;
  };
  layout: {
    alignment: TextAlignment;
    spacing: Spacing;
  };
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** "example" is the seeded demo conversation, "demo" is the local rule engine. */
  source?: "example" | "demo";
  suggestions?: DesignDirection[];
  changes?: string[];
};

export type PersistedStudioState = {
  design: DesignState;
  messages: ChatMessage[];
  /** null when the colors no longer match a curated palette. */
  selectedPaletteId: string | null;
};
