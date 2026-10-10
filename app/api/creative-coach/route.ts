import { sanitizeState } from "@/lib/design-state";
import { askGeminiCoach, GeminiError, isGeminiConfigured } from "@/lib/gemini";
import { getAccountContext } from "@/lib/instance";
import { rateLimited } from "@/lib/rate-limit";

const MAX_BODY_CHARS = 16_000;
const MAX_QUESTION_CHARS = 240;

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isGeminiConfigured()) return fail(503, "not_configured");

  const limited = rateLimited(request, "coach", { perClientPerMinute: 12, globalPerHour: 240 });
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

  const raw = body as Record<string, unknown>;
  const state = sanitizeState({ design: raw.design, selectedPaletteId: null, messages: [] });
  if (!state) return fail(400, "invalid_design");

  const question = typeof raw.question === "string"
    ? raw.question.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, MAX_QUESTION_CHARS)
    : undefined;

  try {
    const instance = await getAccountContext();
    const result = await askGeminiCoach({
      design: state.design,
      question,
      instanceId: instance.id,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GeminiError) {
      console.error(`[creative-coach] ${error.kind}: ${error.message}`);
      return fail(error.kind === "not_configured" ? 503 : 502, error.kind);
    }
    console.error("[creative-coach] unexpected failure");
    return fail(500, "internal");
  }
}
