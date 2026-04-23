import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pathToExtension = path.resolve(__dirname, '../dist');
const outDir = path.resolve(__dirname, '../screenshots');

await mkdir(outDir, { recursive: true });

console.log('Launching Chromium with the extension...');
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [
    '--headless=new',
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
  ],
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extensionId = new URL(sw.url()).host;

const frameCss = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    min-height: 100vh !important;
  }
  body {
    background: radial-gradient(ellipse at 30% 20%, #eef3ff, #f6f7f9 55%) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    max-width: none !important;
  }
  #app {
    width: 320px !important;
    box-shadow: 0 24px 72px rgba(15, 17, 21, 0.14), 0 4px 12px rgba(15, 17, 21, 0.08);
    border-radius: 14px;
    background: white;
    overflow: hidden;
    transform: scale(1.7);
    transform-origin: center center;
  }
`;

async function shot(name, configure) {
  await sw.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rules.map((r) => r.id),
    });
  });
  await configure();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(name.url);
  if (name.framed) await page.addStyleTag({ content: frameCss });
  await page.waitForTimeout(500);
  const outPath = path.join(outDir, `${name.file}.png`);
  await page.screenshot({ path: outPath });
  await page.close();
  console.log(`  wrote ${path.relative(process.cwd(), outPath)}`);
}

const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
const optionsUrl = `chrome-extension://${extensionId}/src/options/options.html`;

console.log('Rendering screenshots...');

await shot({ file: '1-popup-blocking-on', url: popupUrl, framed: true }, async () => {
  await sw.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: {
        enabled: true,
        blocklist: [
          'facebook.com',
          'instagram.com',
          'reddit.com',
          'tiktok.com',
          'x.com',
          'youtube.com',
        ],
      },
    });
  });
});

await shot({ file: '2-popup-focus-active', url: popupUrl, framed: true }, async () => {
  await sw.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.sync.set({
      settings: {
        enabled: true,
        blocklist: ['facebook.com', 'instagram.com', 'reddit.com', 'tiktok.com', 'x.com'],
      },
    });
    await chrome.storage.local.set({
      focus: {
        active: true,
        startedAt: now - 17 * 60 * 1000,
        endsAt: now + 43 * 60 * 1000,
        previousEnabled: true,
      },
    });
  });
});

await shot({ file: '3-options-blocklist', url: optionsUrl, framed: false }, async () => {
  await sw.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: {
        enabled: true,
        blocklist: [
          'facebook.com',
          'instagram.com',
          'news.ycombinator.com',
          'reddit.com',
          'tiktok.com',
          'twitter.com',
          'x.com',
          'youtube.com',
        ],
      },
    });
  });
});

await context.close();
console.log(`\nDone. Screenshots in ${path.relative(process.cwd(), outDir)}/`);
