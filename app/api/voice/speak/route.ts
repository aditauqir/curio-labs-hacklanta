import { isElevenLabsConfigured, MAX_SPEAK_CHARS, speak } from "@/lib/elevenlabs";
import { rateLimited } from "@/lib/rate-limit";
import { VoiceError } from "@/lib/voice-error";

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isElevenLabsConfigured()) return fail(503, "not_configured");

  const limited = rateLimited(request, "speak", { perClientPerMinute: 20, globalPerHour: 300 });
  if (limited) return limited;

  const raw = await request.text().catch(() => "");
  if (raw.length > 4000) return fail(413, "too_large");

  let text: unknown;
  try {
    text = (JSON.parse(raw) as { text?: unknown }).text;
  } catch {
    return fail(400, "invalid_json");
  }

  if (typeof text !== "string") return fail(400, "invalid_text");
  const clean = text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return fail(400, "empty_text");
  // Cap characters: ElevenLabs bills per character.
  const bounded = clean.slice(0, MAX_SPEAK_CHARS);

  try {
    const upstream = await speak(bounded);
    return new Response(upstream.body, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof VoiceError) {
      console.error(`[speak] ${error.kind}: ${error.message}`);
      return fail(error.kind === "not_configured" ? 503 : 502, error.kind);
    }
    console.error("[speak] unexpected failure");
    return fail(500, "internal");
  }
}
