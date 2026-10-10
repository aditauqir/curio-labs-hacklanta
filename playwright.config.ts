import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: "",
      ELEVENLABS_API_KEY: "",
      GEMINI_API_KEY: "",
      LIBRARY_WRITE_TOKEN: "",
      WHISPER_ENABLED: "false",
    },
  },
});
