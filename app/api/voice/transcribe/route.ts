import { MAX_AUDIO_BYTES } from "@/lib/elevenlabs";
import { rateLimited } from "@/lib/rate-limit";
import { isTranscriptionConfigured, transcribe } from "@/lib/transcribe";
import { VoiceError } from "@/lib/voice-error";

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isTranscriptionConfigured()) return fail(503, "not_configured");

  const limited = rateLimited(request, "transcribe", { perClientPerMinute: 12, globalPerHour: 200 });
  if (limited) return limited;

  // Reject oversized uploads from the header before reading the body into memory.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 4096) return fail(413, "too_large");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "invalid_form");
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) return fail(400, "missing_audio");
  if (audio.size === 0) return fail(400, "empty_audio");
  if (audio.size > MAX_AUDIO_BYTES) return fail(413, "too_large");
  if (!audio.type.startsWith("audio/") && audio.type !== "video/webm") {
    return fail(415, "unsupported_type");
  }

  try {
    const { text, provider } = await transcribe(audio);
    return Response.json({ text, provider }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof VoiceError) {
      return fail(error.kind === "not_configured" ? 503 : 502, error.kind);
    }
    console.error("[transcribe] unexpected failure");
    return fail(500, "internal");
  }
}
