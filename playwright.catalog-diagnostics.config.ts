import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "catalog-diagnostics.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:3517", serviceWorkers: "block" },
  webServer: {
    command: "npm run dev -- --port 3517",
    url: "http://localhost:3517",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SENTRY_DSN: "http://public@localhost:3517/1",
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: "catalog-diagnostics-test",
      SENTRY_ENVIRONMENT: "catalog-diagnostics-test",
    },
  },
});
