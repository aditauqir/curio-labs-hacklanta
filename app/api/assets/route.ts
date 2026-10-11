import { NextResponse } from "next/server";
import { logDatabaseFailure } from "@/lib/db";
import { getAccountContext } from "@/lib/instance";
import { listInstancePipelineAssets, type PipelineAssetSummary } from "@/lib/pipeline/store";
import {
  createLibraryAsset,
  LIBRARY_KINDS,
  listLibraryAssets,
  type JsonObject,
  type LibraryKind,
} from "@/lib/library";

const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function authorized(request: Request) {
  const configured = process.env.LIBRARY_WRITE_TOKEN?.trim();
  return Boolean(configured && request.headers.get("x-library-token") === configured);
}

function safeText(value: FormDataEntryValue | null, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind && !(LIBRARY_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  try {
    const instance = await getAccountContext();
    const assets = await listLibraryAssets(kind as LibraryKind | undefined, 60, instance.id);
    let pipelineAssets: PipelineAssetSummary[] = [];
    if (!kind) {
      try {
        pipelineAssets = await listInstancePipelineAssets(instance.id);
      } catch {
        // Keep the legacy library usable while a deployment is migrating the
        // pipeline tables.
        logDatabaseFailure("list pipeline assets");
      }
    }
    return NextResponse.json(
      { assets, pipelineAssets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    logDatabaseFailure("list library assets");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

/** Shared library writes remain token-gated; account-owned assets are scoped below. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_ASSET_BYTES + 16 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const kind = safeText(form.get("kind"), 20);
  const name = safeText(form.get("name"), 160);
  if (!(LIBRARY_KINDS as readonly string[]).includes(kind) || !name) {
    return NextResponse.json({ error: "invalid_asset" }, { status: 400 });
  }

  const file = form.get("file");
  if (file instanceof File && file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  let metadata: Record<string, unknown> = {};
  const rawMetadata = safeText(form.get("metadata"), 20_000);
  if (rawMetadata) {
    try {
      const parsed = JSON.parse(rawMetadata);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("object required");
      metadata = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_metadata" }, { status: 400 });
    }
  }

  try {
    const instance = await getAccountContext();
    const stored = await createLibraryAsset({
      kind: kind as LibraryKind,
      name,
      description: safeText(form.get("description"), 500) || null,
      tags: safeText(form.get("tags"), 2_000)
        .split(",")
        .map((tag) => tag.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 30),
      metadata: metadata as JsonObject,
      sourceUrl: safeText(form.get("sourceUrl"), 2_000) || null,
      contentType: file instanceof File ? file.type || "application/octet-stream" : null,
      data: file instanceof File ? Buffer.from(await file.arrayBuffer()) : null,
      ownerInstanceId: instance.id,
    });
    return NextResponse.json({ asset: stored }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    logDatabaseFailure("save library asset");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}
