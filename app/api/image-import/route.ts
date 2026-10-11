import { GeminiError, analyzeImageReference, isGeminiConfigured } from "@/lib/gemini";
import { rateLimited } from "@/lib/rate-limit";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isGeminiConfigured()) return fail(503, "not_configured");

  const limited = rateLimited(request, "image-import", { perClientPerMinute: 8, globalPerHour: 120 });
  if (limited) return limited;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES + 8 * 1024) return fail(413, "too_large");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "invalid_form");
  }

  const image = form.get("image");
  if (!(image instanceof File)) return fail(400, "missing_image");
  if (image.size === 0) return fail(400, "empty_image");
  if (image.size > MAX_IMAGE_BYTES) return fail(413, "too_large");
  if (!image.type.startsWith("image/")) return fail(415, "unsupported_type");

  try {
    const result = await analyzeImageReference(image);
    return Response.json(
      { ...result.analysis, model: result.model },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GeminiError) {
      console.error(`[image-import] ${error.kind}: ${error.message}`);
      return fail(error.kind === "not_configured" ? 503 : 502, error.kind);
    }
    console.error("[image-import] unexpected failure");
    return fail(500, "internal");
  }
}
