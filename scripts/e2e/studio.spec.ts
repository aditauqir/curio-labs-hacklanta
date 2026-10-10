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
