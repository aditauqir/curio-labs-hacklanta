import { sanitizeState, sanitizeReferenceTreatment } from "@/lib/design-state";
import { askGemini, GeminiError, isGeminiConfigured, type HistoryItem } from "@/lib/gemini";
import { rateLimited } from "@/lib/rate-limit";
import { getAccountContext } from "@/lib/instance";

const MAX_BODY_CHARS = 20_000;
const MAX_MESSAGE_CHARS = 500;

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function parseHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];

  const items: HistoryItem[] = [];
  for (const entry of raw.slice(-6)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 300);
    if (text) items.push({ role, content: text });
  }
  return items;
}

export async function POST(request: Request) {
  if (!isGeminiConfigured()) return fail(503, "not_configured");

  const limited = rateLimited(request, "director", { perClientPerMinute: 20, globalPerHour: 600 });
  if (limited) return limited;

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return fail(413, "too_large");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null) return fail(400, "invalid_body");

  const { message, design, paletteId, posterEdits, referenceTreatment, history } = body as Record<string, unknown>;

  if (typeof message !== "string") return fail(400, "invalid_message");
  const cleanMessage = message.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!cleanMessage) return fail(400, "empty_message");
  if (cleanMessage.length > MAX_MESSAGE_CHARS) return fail(400, "message_too_long");

  // sanitizeState validates and bounds every field of the design the client sent.
  const state = sanitizeState({ design, selectedPaletteId: paletteId, posterEdits, messages: [] });
  if (!state) return fail(400, "invalid_design");

  try {
    const instance = await getAccountContext();
    const result = await askGemini({
      message: cleanMessage,
      design: state.design,
      paletteId: state.selectedPaletteId,
      posterEdits: state.posterEdits,
      referenceTreatment: sanitizeReferenceTreatment(referenceTreatment),
      history: parseHistory(history),
      instanceId: instance.id,
    });

    return Response.json(
      {
        reply: result.reply,
        patch: result.patch,
        skipped: result.skipped,
        assets: result.assetSuggestions,
        followUps: result.followUps,
        groundingSources: result.groundingSources,
        model: result.model,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GeminiError) {
      // Log only the category and status text. Never log the key, prompt, or response body.
      console.error(`[creative-director] ${error.kind}: ${error.message}`);
      return fail(error.kind === "not_configured" ? 503 : 502, error.kind);
    }
    console.error("[creative-director] unexpected failure");
    return fail(500, "internal");
  }
}
