import { expect, test } from "@playwright/test";

test.describe("studio workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CURIO LABS" })).toBeVisible();
  });

  test("renders the mobile workspace and edits the poster", async ({ page }) => {
    await expect(page).toHaveTitle(/Curio Labs/);
    await expect(page.getByRole("tablist", { name: "Workspace panels" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Design canvas" })).toBeVisible();

    const headline = page.getByLabel("Headline");
    await headline.fill("Late Night Sessions");
    await expect(headline).toHaveValue("Late Night Sessions");

    await page.getByRole("group", { name: "Visual direction" }).getByRole("button", { name: "Modern Minimal" }).click();
    await expect(
      page.getByRole("group", { name: "Visual direction" }).getByRole("button", { name: "Modern Minimal" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("switches panels and applies a local director edit", async ({ page }) => {
    await page.getByRole("tab", { name: "Director" }).click();
    await expect(page.getByRole("region", { name: "Creative director" })).toBeVisible();
    await expect(page.getByText(/Demo mode:/)).toBeVisible();

    await page.getByLabel("Message the creative director").fill("Use a blue accent");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Demo rules")).toBeVisible();
    await expect(page.getByText("Accent: blue")).toBeVisible();

    await page.getByRole("tab", { name: "Inspiration" }).click();
    await expect(page.getByRole("region", { name: "Inspiration board" })).toBeVisible();
  });

  test("exports the editable brief as JSON", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Brief JSON" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/-brief\.json$/);
  });
});

test("keeps a newer local edit when the remote workspace is older", async ({ page }) => {
  const instanceId = "11111111-1111-4111-8111-111111111111";
  let remoteHeadline = "Remote old";

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ instanceId }) => {
    const key = `studio-workspace-v1:${instanceId}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.parse("2026-10-10T01:00:00.000Z"),
        state: {
          design: { headline: "Local newer" },
          messages: [],
          selectedPaletteId: null,
        },
      }),
    );
  }, { instanceId });
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          instanceId,
          state: { design: { headline: remoteHeadline }, messages: [], selectedPaletteId: null },
          updatedAt: "2026-10-10T00:00:00.000Z",
          persistent: true,
        }),
      });
      return;
    }

    const body = route.request().postDataJSON() as { state?: { design?: { headline?: string } } };
    remoteHeadline = body.state?.design?.headline ?? remoteHeadline;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, updatedAt: "2026-10-10T02:00:00.000Z" }),
    });
  });

  await page.goto("/");
  await expect(page.getByLabel("Headline")).toHaveValue("Local newer");
});
