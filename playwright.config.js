import { defineConfig } from '@playwright/test';

const basePath = process.env.BASE_PATH || '/uzbek-alifbo/';
const address = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  use: {
    baseURL: address + basePath,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --base ${basePath}`,
    url: address + basePath,
  },
});
