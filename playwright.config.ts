import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5174';
// Every spec also runs with the Space look saved on the device, so its axe checks cover both themes.
const space = { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: 'home-theme', value: 'space' }] }] };

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'space', use: { ...devices['Desktop Chrome'], storageState: space }, testIgnore: /themes\.spec/ },
  ],
  webServer: {
    command: 'npm run dev', url: baseURL, reuseExistingServer: false,
    env: { DATABASE_PATH: './data/e2e.sqlite', PORT: '3002', API_PORT: '3002', VITE_PORT: '5174' },
  },
});
