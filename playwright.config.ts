import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // E2E only needs the web app at :3001. The SDK packages it depends on are
    // already built by the CI "Build" step, so start just the web dev server
    // rather than `turbo dev` (which spins up every SDK's tsup --watch and races
    // build vs watch on the same tsup temp config). Scoping here also avoids the
    // persistent-task concurrency limit entirely.
    command: 'npm run dev --workspace=@bugwatch/web',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
