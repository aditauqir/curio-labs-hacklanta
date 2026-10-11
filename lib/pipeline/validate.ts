// Small validation primitives shared by every pipeline stage.
//
// The project already treats model output and stored data as untrusted and
// hand-rolls whitelist validation (see lib/ai-patch.ts and lib/design-state.ts).
// This keeps that convention rather than introducing a schema library, and adds
// one thing those modules lack: a path-aware issue list, so a rejected design
// document can say exactly which element failed and why.

export type Issue = { path: string; message: string };

export type Validated<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export class Collector {
  issues: Issue[] = [];
  // Written out rather than declared as a constructor parameter property:
  // Node's strip-only TypeScript support cannot compile those, and these
  // modules are loaded directly by `node --test`.
  base: string;

  constructor(base = "") {
    this.base = base;
  }

  at(segment: string | number) {
    const path = typeof segment === "number" ? `${this.base}[${segment}]` : this.base ? `${this.base}.${segment}` : segment;
    const child = new Collector(path);
    child.issues = this.issues;
    return child;
  }

  reject(message: string) {
    this.issues.push({ path: this.base || "(root)", message });
    return undefined;
  }

  get ok() {
    return this.issues.length === 0;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bounded plain text with control characters removed. Newlines optional. */
export function text(value: unknown, max: number, options: { newlines?: boolean } = {}) {
  if (typeof value !== "string") return null;
  const pattern = options.newlines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  const cleaned = value.replace(pattern, " ").trim().slice(0, max);
  return cleaned || null;
}

export function num(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

export function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT_HEX = /^#[0-9a-f]{3}$/i;

/** Accepts #RGB or #RRGGBB and normalises to uppercase #RRGGBB. */
export function hexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (HEX.test(trimmed)) return trimmed.toUpperCase();
  if (SHORT_HEX.test(trimmed)) {
    const [, r, g, b] = trimmed.toUpperCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

/** Bounded list of bounded strings. Non-strings are dropped, not rejected. */
export function stringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const cleaned = text(entry, maxLength);
    if (cleaned) out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function identifier(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

/** Deterministic slug, used for element ids derived from names. */
export function slug(value: string, fallback = "item") {
  const cleaned = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}
