import { GeminiError, isGeminiConfigured, suggestStarterPrompts } from "@/lib/gemini";
import { rateLimited } from "@/lib/rate-limit";

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!isGeminiConfigured()) return fail(503, "not_configured");

  const limited = rateLimited(request, "onboarding-suggestions", { perClientPerMinute: 4, globalPerHour: 120 });
  if (limited) return limited;

  try {
    const result = await suggestStarterPrompts();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GeminiError) {
      console.error(`[onboarding-suggestions] ${error.kind}: ${error.message}`);
      return fail(error.kind === "not_configured" ? 503 : 502, error.kind);
    }
    console.error(
      "[onboarding-suggestions] unexpected failure",
      error instanceof Error ? error.message.slice(0, 160) : "unknown error",
    );
    return fail(500, "internal");
  }
}
