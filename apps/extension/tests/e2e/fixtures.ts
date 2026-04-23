import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, test as base, chromium, type Worker } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pathToExtension = path.resolve(__dirname, '../../dist');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature requires destructuring placeholder
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        '--headless=new',
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export const expect = base.expect;

export async function resetState(sw: Worker): Promise<void> {
  await sw.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.alarms.clearAll();
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: [],
    });
  });
}
