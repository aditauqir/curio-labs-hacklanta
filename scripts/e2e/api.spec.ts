import { expect, test } from "@playwright/test";

test.describe("public API contracts", () => {
  test("reports safe capability status without credentials", async ({ request }) => {
    const response = await request.get("/api/status");

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toEqual({
      director: { provider: "demo" },
      voice: { listen: false, transcriber: null, speak: false },
    });
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  test("assigns an instance cookie and falls back without a database", async ({ request }) => {
    const response = await request.get("/api/workspace");

    expect(response.ok()).toBe(true);
    expect(response.headers()["set-cookie"]).toMatch(/curio_instance_id=[0-9a-f-]{36}/i);
    expect(await response.json()).toMatchObject({
      state: null,
      persistent: false,
    });
  });

  test("rejects invalid workspace state before touching persistence", async ({ request }) => {
    const response = await request.put("/api/workspace", {
      data: { state: { invalid: true } },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_state" });
  });

  test("requires a token for shared library writes", async ({ request }) => {
    const response = await request.post("/api/assets", {
      multipart: { kind: "font", name: "test font" },
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  test("validates asset kind and file input", async ({ request }) => {
    const invalidKind = await request.get("/api/assets?kind=not-a-kind");
    expect(invalidKind.status()).toBe(400);
    expect(await invalidKind.json()).toEqual({ error: "invalid_kind" });

    const missingFile = await request.post("/api/files", { multipart: {} });
    expect(missingFile.status()).toBe(400);
    expect(await missingFile.json()).toEqual({ error: "missing_file" });
  });

  test("reports unavailable AI and voice providers without upstream details", async ({ request }) => {
    const director = await request.post("/api/creative-director", { data: {} });
    expect(director.status()).toBe(503);
    expect(await director.json()).toEqual({ error: "not_configured" });

    const transcribe = await request.post("/api/voice/transcribe", { multipart: {} });
    expect(transcribe.status()).toBe(503);
    expect(await transcribe.json()).toEqual({ error: "not_configured" });
  });

  test("validates account credentials before database access", async ({ request }) => {
    const invalid = await request.post("/api/auth", {
      data: { mode: "login", username: "a", password: "short" },
    });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_credentials" });
  });
});
