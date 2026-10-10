// In-memory sliding-window limiter. The app runs as a single PM2 process, so a
// module-level map is enough. It protects the paid API keys from abuse on a
// public URL; it is not a substitute for real auth.
const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000;

function hit(key: string, limit: number, windowMs: number, now: number) {
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);

  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }

  recent.push(now);
  buckets.set(key, recent);
  return { ok: true, retryAfter: 0 };
}

function prune(now: number, windowMs: number) {
  if (buckets.size <= MAX_KEYS) return;
  for (const [key, times] of buckets) {
    if (times.every((time) => now - time >= windowMs)) buckets.delete(key);
  }
}

// nginx sets X-Real-IP to the connecting address and overwrites any client value.
// X-Forwarded-For is client-controlled at its first entry, so it is not used.
function clientKey(request: Request) {
  return request.headers.get("x-real-ip")?.trim().slice(0, 64) || "local";
}

type Limits = {
  /** Requests allowed per client per minute. */
  perClientPerMinute: number;
  /** Requests allowed across all clients per hour. */
  globalPerHour: number;
};

/** Returns a 429 Response when a limit is exceeded, otherwise null. */
export function rateLimited(
  request: Request,
  scope: string,
  limits: Limits,
): Response | null {
  const now = Date.now();
  prune(now, 3_600_000);

  const client = hit(`${scope}:ip:${clientKey(request)}`, limits.perClientPerMinute, 60_000, now);
  const global = client.ok
    ? hit(`${scope}:global`, limits.globalPerHour, 3_600_000, now)
    : { ok: true, retryAfter: 0 };

  if (client.ok && global.ok) return null;

  const retryAfter = Math.max(client.retryAfter, global.retryAfter);
  return Response.json(
    { error: "rate_limited", retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}
