import { NextResponse } from "next/server";
import { logDatabaseFailure } from "@/lib/db";
import { attachInstanceCookie, getInstanceContext } from "@/lib/instance";
import { loadWorkspace, saveWorkspace } from "@/lib/instance-store";
import { sanitizeState } from "@/lib/design-state";

const MAX_STATE_BYTES = 512 * 1024;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const instance = await getInstanceContext();
  try {
    const state = await loadWorkspace(instance.id);
    const response = noStore(NextResponse.json({ instanceId: instance.id, state, persistent: true }));
    if (instance.isNew) attachInstanceCookie(response, request, instance.id);
    return response;
  } catch {
    logDatabaseFailure("load workspace");
    const response = noStore(
      NextResponse.json({ instanceId: instance.id, state: null, persistent: false }),
    );
    if (instance.isNew) attachInstanceCookie(response, request, instance.id);
    return response;
  }
}

export async function PUT(request: Request) {
  const instance = await getInstanceContext();
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_STATE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let payload: { state?: unknown };
  try {
    payload = (await request.json()) as { state?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const state = sanitizeState(payload.state);
  if (!state) return NextResponse.json({ error: "invalid_state" }, { status: 400 });

  try {
    await saveWorkspace(instance.id, state);
    const response = noStore(NextResponse.json({ ok: true }));
    if (instance.isNew) attachInstanceCookie(response, request, instance.id);
    return response;
  } catch {
    logDatabaseFailure("save workspace");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}
