import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Sql } from "postgres";

export const INSTANCE_COOKIE = "curio_instance_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isInstanceId(value: string) {
  return UUID.test(value);
}

export async function getInstanceContext() {
  const jar = await cookies();
  const stored = jar.get(INSTANCE_COOKIE)?.value;
  return {
    id: stored && isInstanceId(stored) ? stored : randomUUID(),
    isNew: !stored || !isInstanceId(stored),
  };
}

export async function ensureInstance(sql: Sql, instanceId: string) {
  await sql`
    INSERT INTO curio_instances (id)
    VALUES (${instanceId}::uuid)
    ON CONFLICT (id) DO NOTHING
  `;
}

export function attachInstanceCookie(response: NextResponse, request: Request, instanceId: string) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwardedProto === "https" || new URL(request.url).protocol === "https:";

  response.cookies.set(INSTANCE_COOKIE, instanceId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
