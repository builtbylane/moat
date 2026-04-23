import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list']],
  webServer: {
    command: 'node tests/e2e/static-server.js',
    url: 'http://127.0.0.1:4545/',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
});
