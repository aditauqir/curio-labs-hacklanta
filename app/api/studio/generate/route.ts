import { getAccountContext } from "@/lib/instance";
import { rateLimited } from "@/lib/rate-limit";
import { generateStudioPipeline } from "@/lib/pipeline/studio";
import { fail, ok, pipelineFailure, readJson, withCookie } from "@/lib/pipeline/http";
import { FORMAT_IDS, type FormatId } from "@/lib/pipeline/brief";
import { text } from "@/lib/pipeline/validate";

const MAX_BODY_BYTES = 16 * 1024;

type Body = { brief?: unknown; format?: unknown; variationSeed?: unknown };

/**
 * Runs the from-scratch studio pipeline in one server-only request:
 * Gemini brief + concepts -> TigerData references/textures -> composition ->
 * optional Python raster output.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "studio-generate", { perClientPerMinute: 6, globalPerHour: 120 });
  if (limited) return limited;

  const parsed = await readJson<Body>(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const briefText = text(parsed.value.brief, 4_000, { newlines: true });
  if (!briefText) return fail(400, "invalid_brief");

  const format = typeof parsed.value.format === "string" && (FORMAT_IDS as string[]).includes(parsed.value.format)
    ? (parsed.value.format as FormatId)
    : "print-poster";
  const variationSeed = text(parsed.value.variationSeed, 120);
  const account = await getAccountContext();

  try {
    const result = await generateStudioPipeline({
      briefText,
      formatHint: format,
      instanceId: account.id,
      variationSeed: variationSeed || undefined,
    });
    return withCookie(ok(result), request, account);
  } catch (error) {
    return pipelineFailure(error);
  }
}
