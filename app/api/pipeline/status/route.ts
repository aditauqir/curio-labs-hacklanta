import { connection } from "next/server";
import { aiCapabilities } from "@/lib/ai/provider";
import { FORMATS } from "@/lib/pipeline/brief";

// Reports what the pipeline can actually do, never the credentials behind it.
// connection() opts out of prerendering, matching app/api/status/route.ts:
// cacheComponents is on, so without it this would freeze at build time when CI
// has no keys and report "not configured" forever.
export async function GET() {
  await connection();
  const capabilities = aiCapabilities();

  return Response.json(
    {
      capabilities,
      stages: {
        brief: capabilities.text.available,
        concepts: capabilities.text.available,
        references: true,
        assetPlanning: true,
        composition: true,
        rendering: true,
        deterministicChecks: true,
        creativeCritique: capabilities.text.available,
        revision: capabilities.text.available,
        export: true,
      },
      formats: Object.entries(FORMATS).map(([id, format]) => ({ id, ...format })),
      exportFormats: ["svg", "json"],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
