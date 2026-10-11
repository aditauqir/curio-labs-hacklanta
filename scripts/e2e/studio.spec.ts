import { expect, test } from "@playwright/test";

test("redirects the entry route to the /home workspace", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("onboarding-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What are you thinking of?" })).toBeVisible();
});

test("uses the app and editor routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/editor");
  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByTestId("editor-screen")).toBeVisible();

  await page.goto("/director");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("onboarding-screen")).toBeVisible();

  await page.goto("/app");
  await expect(page.getByTestId("onboarding-screen")).toBeVisible();
  await page.getByRole("button", { name: /Open current workspace/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("editor-screen")).toBeVisible();
});

test.describe("studio workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/home");
    await expect(page.getByTestId("onboarding-screen")).toBeVisible();
    await page.getByRole("button", { name: /Open current workspace/ }).click();
    await expect(page.getByTestId("editor-screen")).toBeVisible();
    await expect(page.getByRole("region", { name: "Design canvas" })).toBeVisible();
  });

  test("renders the desktop workspace and edits the poster", async ({ page }) => {
    await expect(page).toHaveTitle(/Curio Labs/);
    await expect(page.getByRole("region", { name: "Design canvas" })).toBeVisible();

    await page.getByRole("button", { name: "Open color properties" }).click();
    await expect(page.getByRole("region", { name: "Poster properties" })).toBeVisible();
    const headline = page.getByRole("textbox", { name: /^Headline Press Enter/ });
    await headline.fill("Late Night Sessions");
    await expect(headline).toHaveValue("Late Night Sessions");
  });

  test("uses the chat and reference panels to apply a local edit", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Chat workspace" })).toBeVisible();

    await page.getByLabel("Describe a change").fill("Use a blue accent");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Accent: blue")).toBeVisible();

    await expect(page.getByRole("region", { name: "Reference" })).toBeVisible();
  });

  test("applies a natural-language modern request to the canvas", async ({ page }) => {
    await page.getByLabel("Describe a change").fill("make it look more modern");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("Direction: Berlin Swiss ivory")).toBeVisible();
    await expect(page.getByLabel("After Image poster, Berlin Swiss ivory direction")).toBeVisible();
  });

  test("exports the current poster from the canvas action bar", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("toolbar", { name: "Canvas actions" }).getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/-poster\.png$/);
  });

  test("keeps the poster format picker available beside the canvas", async ({ page }) => {
    const format = page.getByRole("combobox", { name: "Export format" });
    await format.click();
    await page.getByRole("option", { name: /JPG/ }).click();
    await expect(format).toHaveText("JPG");

    await format.click();
    await page.getByRole("option", { name: /PSD/ }).click();
    await expect(format).toHaveText("PSD");
  });

  test("explains canvas actions with tooltips", async ({ page }) => {
    await page.getByRole("toolbar", { name: "Canvas actions" }).getByRole("button", { name: "Export" }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("Export");
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
    await page.getByRole("button", { name: "Open color properties" }).click();
    await expect(page.getByRole("textbox", { name: /^Accent color/ })).toHaveValue("#1177cc");
  });
});

test("moves from the start screen into the app workspace", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.removeItem("curio-onboarding-complete-v1"));
  await page.goto("/home");
  await expect(page.getByTestId("onboarding-screen")).toBeVisible();

  await page.getByRole("button", { name: /Warm identity/ }).click();
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
  await page.getByRole("button", { name: /Open current workspace/ }).click();
  await page.getByRole("button", { name: "Open color properties" }).click();
  await expect(page.getByRole("textbox", { name: /^Headline Press Enter/ })).toHaveValue("Local newer");
});
