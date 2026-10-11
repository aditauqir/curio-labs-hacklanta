// Server-only bridge for the deterministic Python raster engine.
//
// The Python source currently lives on the Vultr asset server, but that host
// does not expose an HTTP renderer. Keep the integration explicit and
// environment-configured so local development never claims that SVG or a
// reference image was produced by Python when it was not.

import type { Concept } from "./concepts.ts";
import type { StructuredBrief } from "./brief.ts";

const MAX_RENDER_RESPONSE_BYTES = 25 * 1024 * 1024;

export type PythonPipelineStatus = {
  available: boolean;
  provider: "python-raster-engine" | null;
  reason?: string;
};

export type PythonPipelineAsset = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  url: string;
};

export type PythonPipelineInput = {
  brief: StructuredBrief;
  concept: Concept;
  references: PythonPipelineAsset[];
  textures: PythonPipelineAsset[];
};

export type PythonPipelineResult = PythonPipelineStatus & {
  outputAssetId: string | null;
  outputUrl: string | null;
};

function configuredUrl() {
  const value = process.env.CURIO_PYTHON_PIPELINE_URL?.trim();
  return value && /^https?:\/\//i.test(value) ? value : null;
}

export function pythonPipelineStatus(): PythonPipelineStatus {
  if (configuredUrl()) {
    return { available: true, provider: "python-raster-engine" };
  }

  return {
    available: false,
    provider: null,
    reason:
      "The Python raster engine source is present on the asset server, but no renderer URL is configured for this app.",
  };
}

function safeAssetId(value: unknown): string | null {
  return typeof value === "string" && value.length <= 200 && /^[a-zA-Z0-9:_-]+$/.test(value) ? value : null;
}

function safeUrl(value: unknown): string | null {
  return typeof value === "string" && value.length <= 2_000 && /^https?:\/\//i.test(value) ? value : null;
}

/**
 * Calls the real Python renderer when CURIO_PYTHON_PIPELINE_URL is configured.
 * The contract is deliberately narrow: the renderer receives structured
 * metadata and returns an already-published TigerData asset id or URL.
 */
export async function runPythonPipeline(input: PythonPipelineInput): Promise<PythonPipelineResult> {
  const url = configuredUrl();
  if (!url) return { ...pythonPipelineStatus(), outputAssetId: null, outputUrl: null };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: input.brief,
        concept: input.concept,
        references: input.references,
        textures: input.textures,
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_RENDER_RESPONSE_BYTES) {
      return {
        available: false,
        provider: "python-raster-engine",
        reason: "The Python renderer returned an oversized response.",
        outputAssetId: null,
        outputUrl: null,
      };
    }

    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !raw) {
      return {
        available: false,
        provider: "python-raster-engine",
        reason: "The configured Python renderer did not return a usable result.",
        outputAssetId: null,
        outputUrl: null,
      };
    }

    const outputAssetId = safeAssetId(raw.outputAssetId);
    const outputUrl = safeUrl(raw.outputUrl);
    if (!outputAssetId && !outputUrl) {
      return {
        available: false,
        provider: "python-raster-engine",
        reason: "The configured Python renderer returned no published output asset.",
        outputAssetId: null,
        outputUrl: null,
      };
    }

    return { available: true, provider: "python-raster-engine", outputAssetId, outputUrl };
  } catch {
    return {
      available: false,
      provider: "python-raster-engine",
      reason: "The configured Python renderer could not be reached.",
      outputAssetId: null,
      outputUrl: null,
    };
  }
}
