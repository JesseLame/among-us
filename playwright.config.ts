import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
    env: { DATABASE_PATH: './data/e2e.sqlite', PORT: '3002', API_PORT: '3002', VITE_PORT: '5174' },
  },
});
