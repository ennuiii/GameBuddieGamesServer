import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for testing the unified game server
 * Tests both the server API and the ClueScale client integration
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid conflicts
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Web server configuration
  webServer: [
    {
      command: 'npx tsx watch core/server.ts',
      port: 3001,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        NODE_ENV: 'test',
      },
    },
    {
      command: 'cd ../ClueScale/client && npm run dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
