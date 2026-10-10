import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("redirects the entry route to the /home workspace", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("onboarding-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What are you thinking of?" })).toBeVisible();
});

test("uses dedicated director and editor routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/editor");
  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByTestId("editor-screen")).toBeVisible();

  await page.getByRole("button", { name: "Open director" }).click();
  await expect(page).toHaveURL(/\/director$/);
  await expect(page.getByTestId("chat-screen")).toBeVisible();

  await page.getByRole("button", { name: "Open full editor" }).click();
  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByTestId("editor-screen")).toBeVisible();
});

test.describe("studio workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/home");
    await expect(page.getByTestId("onboarding-screen")).toBeVisible();
    await page.getByRole("button", { name: "Open the full studio" }).click();
    await expect(page.getByRole("heading", { name: "CURIO LABS" })).toBeVisible();
  });

  test("renders the mobile workspace and edits the poster", async ({ page }) => {
    await expect(page).toHaveTitle(/Curio Labs/);
    await expect(page.getByRole("tablist", { name: "Workspace panels" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Design canvas" })).toBeVisible();
    await page.getByRole("tab", { name: "Director" }).click();
    await expect(page.getByTestId("editor-chat-box")).toBeVisible();
    await page.getByRole("tab", { name: "Canvas" }).click();

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

  test("exports JPG and layered PSD files from the format picker", async ({ page }) => {
    const format = page.getByRole("combobox", { name: "Export format" });
    await format.click();
    await page.getByRole("option", { name: /JPG/ }).click();

    const jpgDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JPG" }).click();
    const jpgDownload = await jpgDownloadPromise;
    expect(jpgDownload.suggestedFilename()).toMatch(/-poster\.jpg$/);

    await format.click();
    await page.getByRole("option", { name: /PSD/ }).click();
    const psdDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PSD" }).click();
    const psdDownload = await psdDownloadPromise;
    expect(psdDownload.suggestedFilename()).toMatch(/-poster\.psd$/);
    const psdPath = await psdDownload.path();
    expect(psdPath).not.toBeNull();
    if (psdPath) expect((await readFile(psdPath)).subarray(0, 4).toString()).toBe("8BPS");
  });

  test("explains export controls with warm tooltips", async ({ page }) => {
    await page.getByRole("button", { name: "Download brief JSON" }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("Download the editable briefJSON");
  });

  test("sends an onboarding idea to Gemini and applies the editor patch", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("curio-onboarding-complete-v1"));
    await page.route("**/api/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          director: { provider: "gemini" },
          voice: { listen: false, transcriber: null, speak: false },
        }),
      });
    });
    await page.route("**/api/creative-director", async (route) => {
      const body = route.request().postDataJSON() as { message?: string };
      expect(body.message).toBe("Use a blue accent");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "I gave the accent a clear blue signal.",
          patch: { accent: "#1177CC" },
          skipped: [],
          assets: [],
          model: "test-gemini",
        }),
      });
    });

    await page.goto("/home");
    await page.getByLabel("Describe what you are making").fill("Use a blue accent");
    await page.getByRole("button", { name: "Start with this idea" }).click();

    await expect(page.getByText("I gave the accent a clear blue signal.")).toBeVisible();
    await expect(page.getByText("Accent: #1177CC")).toBeVisible();
    await page.getByRole("button", { name: "Open full editor" }).click();
    await expect(page.getByLabel("Accent color", { exact: true })).toHaveValue("#1177cc");
  });
});

test("moves from the start screen into the director and full editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.removeItem("curio-onboarding-complete-v1"));
  await page.goto("/home");
  await expect(page.getByTestId("onboarding-screen")).toBeVisible();

  await page.getByRole("button", { name: "Chat / voice" }).click();
  await expect(page.getByTestId("chat-screen")).toBeVisible();
  await expect(page.getByRole("region", { name: "Creative director" })).toBeVisible();

  await page.getByRole("button", { name: "Open full editor" }).click();
  await expect(page.getByTestId("editor-screen")).toBeVisible();
  await expect(page.getByRole("region", { name: "Design canvas" })).toBeVisible();
});

test("keeps a newer local edit when the remote workspace is older", async ({ page }) => {
  const instanceId = "11111111-1111-4111-8111-111111111111";
  let remoteHeadline = "Remote old";

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ instanceId }) => {
    localStorage.setItem("curio-onboarding-complete-v1", "true");
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

  await page.goto("/home");
  await expect(page.getByLabel("Headline")).toHaveValue("Local newer");
});
