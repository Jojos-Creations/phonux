import { defineConfig, devices } from '@playwright/test';
// Phone profiles. The phone is a Capacitor web view: WebKit (WKWebView) on iPhone and Chromium
// (System WebView) on Android, so both engines are targets. PHONE_PROJECTS names the projects to run;
// an unknown name fails the run, so a missing browser is never skipped silently.
const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13'];
const { defaultBrowserType: _android, ...pixel } = devices['Pixel 7'];
const projects = [
    { name: 'iphone-13', use: { ...iphone } },
    { name: 'pixel-7', use: { ...pixel } },
    { name: 'iphone-13-webkit', use: { ...iphone, browserName: 'webkit' } },
];
const chosen = (process.env.PHONE_PROJECTS ?? 'iphone-13,pixel-7').split(',').map((name) => name.trim());
for (const name of chosen) {
    if (!projects.some((project) => project.name === name))
        throw new Error(`PHONE_PROJECTS names an unknown project: ${name}`);
}
export default defineConfig({
    testDir: 'test/phone',
    testMatch: '*.spec.ts',
    reporter: 'list',
    projects: projects.filter((project) => chosen.includes(project.name)),
});
