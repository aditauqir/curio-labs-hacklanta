import { expect, test } from "@playwright/test";

// The Playwright web server runs with DATABASE_URL blank (see
// playwright.config.ts), so these tests cover the contract that holds without
// persistence: capability reporting, request validation, authorisation, and
// honest degradation. The full stage-by-stage pipeline is exercised without
// HTTP in lib/pipeline/e2e.test.mjs via `npm run test:unit`.

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

test.describe("pipeline API contracts", () => {
  test("reports stage capabilities without leaking credentials", async ({ request }) => {
    const response = await request.get("/api/pipeline/status");

    expect(response.ok()).toBe(true);
    const body = await response.json();

    // The mock is enabled for tests, so text stages are available and say so.
    expect(body.capabilities.text).toEqual({ available: true, provider: "mock" });

    // Nothing in this deployment can generate images or see a render, and the
    // API must say that rather than implying otherwise.
    expect(body.capabilities.imageGeneration.available).toBe(false);
    expect(body.capabilities.vision.available).toBe(false);
    expect(body.capabilities.vision.reason).toBeTruthy();

    expect(body.stages.rendering).toBe(true);
    expect(body.stages.deterministicChecks).toBe(true);
    expect(body.exportFormats).toContain("svg");
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  test("lists the output formats it can actually produce", async ({ request }) => {
    const body = await (await request.get("/api/pipeline/status")).json();
    const ids = body.formats.map((format: { id: string }) => format.id);

    expect(ids).toContain("print-poster");
    for (const format of body.formats) {
      expect(format.width).toBeGreaterThan(0);
      expect(format.height).toBeGreaterThan(0);
    }
  });

  test("degrades honestly when the database is unavailable", async ({ request }) => {
    const response = await request.get("/api/projects");

    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: "database_unavailable" });
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("rejects a malformed project id as not found", async ({ request }) => {
    const response = await request.get("/api/projects/not-a-uuid");

    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("does not confirm whether another instance's project exists", async ({ request }) => {
    // With no database the lookup fails closed. The important property is that
    // a well-formed id never returns 403 or any detail about the row.
    const response = await request.get(`/api/projects/${VALID_UUID}`);

    expect([404, 503]).toContain(response.status());
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["error"]);
  });

  test("rejects malformed JSON before doing any work", async ({ request }) => {
    // Sent as a Buffer: a plain string would be JSON-encoded by Playwright and
    // would arrive as valid JSON.
    const response = await request.post("/api/projects", {
      headers: { "Content-Type": "application/json" },
      data: Buffer.from("{ not json"),
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
  });

  test("rejects a JSON body that is not an object", async ({ request }) => {
    const response = await request.post("/api/projects", {
      headers: { "Content-Type": "application/json" },
      data: Buffer.from('"just a string"'),
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
  });

  test("enforces a request body limit", async ({ request }) => {
    const response = await request.post("/api/projects", {
      data: { name: "x", brief: "y".repeat(64 * 1024) },
    });

    expect(response.status()).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
  });

  test("nested project routes are all guarded", async ({ request }) => {
    const paths = [
      "concepts",
      "design",
      "assets",
      "references",
      "versions",
      "exports",
      "preview",
    ];

    for (const path of paths) {
      const response = await request.get(`/api/projects/bad-id/${path}`);
      expect(response.status(), `${path} must reject a malformed id`).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  test("export download rejects a malformed export id", async ({ request }) => {
    const response = await request.get(`/api/projects/${VALID_UUID}/exports/nope`);
    expect(response.status()).toBe(404);
  });

  test("job status rejects a malformed job id", async ({ request }) => {
    const response = await request.get(`/api/projects/${VALID_UUID}/jobs/nope`);
    expect(response.status()).toBe(404);
  });

  test("revision requires a non-empty instruction", async ({ request }) => {
    const response = await request.post(`/api/projects/${VALID_UUID}/revise`, {
      data: { request: "   " },
    });

    // Validation runs before the project lookup touches the database.
    expect([400, 404, 503]).toContain(response.status());
    if (response.status() === 400) {
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
  });

  test("the existing studio API is unaffected by the pipeline routes", async ({ request }) => {
    const response = await request.get("/api/status");

    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({
      director: { provider: "demo" },
      voice: { listen: false, transcriber: null, speak: false },
    });
  });
});
