import { defineConfig, devices } from '@playwright/test';
// Phone profiles run in Chromium. The phone is a Capacitor web view, so one engine
// is the target; WebKit and native shells are checked elsewhere.
const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13'];
const { defaultBrowserType: _android, ...pixel } = devices['Pixel 7'];
export default defineConfig({
    testDir: 'test/phone',
    testMatch: '*.spec.ts',
    reporter: 'list',
    projects: [
        { name: 'iphone-13', use: { ...iphone } },
        { name: 'pixel-7', use: { ...pixel } },
    ],
});
