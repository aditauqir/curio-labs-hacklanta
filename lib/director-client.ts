import type { AssetSuggestion, ChatMessage, DesignState, ReferenceTreatment } from "./design-types";
import { validatePatch, type AiPatch } from "./ai-patch";
import type { PosterEdits } from "./poster-editor";

export type DirectorReply = {
  reply: string;
  patch: AiPatch;
  skipped: string[];
  model: string;
  assets: AssetSuggestion[];
  followUps: string[];
  groundingSources: Array<{ title: string; url: string }>;
};

export class DirectorError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

// The server tries two models at 9s each, so give it slightly longer than that.
const CLIENT_TIMEOUT_MS = 25_000;

export async function askDirector(input: {
  message: string;
  design: DesignState;
  paletteId: string | null;
  posterEdits: PosterEdits;
  history: ChatMessage[];
  referenceTreatment: ReferenceTreatment;
}): Promise<DirectorReply> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  // The seeded sample conversation is not something the user actually said.
  const history = input.history
    .filter((message) => !message.id.startsWith("seed-"))
    .slice(-6)
    .map(({ role, content }) => ({ role, content }));

  try {
    const response = await fetch("/api/creative-director", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        design: input.design,
        paletteId: input.paletteId,
        posterEdits: input.posterEdits,
        referenceTreatment: input.referenceTreatment,
        history,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new DirectorError(response.status, body?.error ?? "request_failed");
    }

    const json = (await response.json()) as Partial<DirectorReply> | null;
    // Validate again on the client: the server is trusted, but the check is cheap.
    const { patch } = validatePatch(json?.patch);

    return {
      reply: typeof json?.reply === "string" ? json.reply : "Done.",
      patch,
      skipped: Array.isArray(json?.skipped)
        ? json.skipped.filter((entry): entry is string => typeof entry === "string")
        : [],
      model: typeof json?.model === "string" ? json.model : "gemini",
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
      followUps: Array.isArray(json?.followUps)
        ? json.followUps.filter((entry): entry is string => typeof entry === "string").slice(0, 3)
        : [],
      groundingSources: Array.isArray(json?.groundingSources)
        ? json.groundingSources.filter(
            (source): source is { title: string; url: string } =>
              typeof source === "object" &&
              source !== null &&
              typeof source.title === "string" &&
              /^https?:\/\//i.test(typeof source.url === "string" ? source.url : ""),
          ).slice(0, 12)
        : [],
    };
  } finally {
    window.clearTimeout(timer);
  }
}
