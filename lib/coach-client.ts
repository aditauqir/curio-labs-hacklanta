import type { AssetSuggestion, DesignState } from "./design-types";

export type CoachReply = {
  feedback: string;
  focus: "hierarchy" | "alignment" | "spacing" | "contrast" | "type";
  model: string;
  usedTool: boolean;
  assets: AssetSuggestion[];
};

export class CoachError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function askCoach(input: { design: DesignState; question?: string }): Promise<CoachReply> {
  const response = await fetch("/api/creative-coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(18_000),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new CoachError(response.status, body?.error ?? "request_failed");
  }

  const json = (await response.json()) as Partial<CoachReply> | null;
  return {
    feedback: typeof json?.feedback === "string" ? json.feedback : "The layout has a clear starting point.",
    focus:
      json?.focus === "alignment" ||
      json?.focus === "spacing" ||
      json?.focus === "contrast" ||
      json?.focus === "type"
        ? json.focus
        : "hierarchy",
    model: typeof json?.model === "string" ? json.model : "gemini",
    usedTool: json?.usedTool === true,
    assets: Array.isArray(json?.assets)
      ? json.assets.filter(
          (asset): asset is AssetSuggestion =>
            typeof asset === "object" &&
            asset !== null &&
            typeof asset.id === "string" &&
            typeof asset.kind === "string" &&
            typeof asset.name === "string" &&
            (asset.description === null || typeof asset.description === "string"),
        )
      : [],
  };
}
