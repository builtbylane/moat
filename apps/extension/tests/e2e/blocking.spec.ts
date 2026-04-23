import { expect, resetState, test } from './fixtures';

test.beforeEach(async ({ serviceWorker }) => {
  await resetState(serviceWorker);
});

test('blocked host closes the tab', async ({ context, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: true, blocklist: ['127.0.0.1'] },
    });
  });

  await expect
    .poll(
      async () =>
        (await serviceWorker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length,
    )
    .toBeGreaterThan(0);

  const page = await context.newPage();
  const closed = page.waitForEvent('close');
  await page.goto('http://127.0.0.1:4545/').catch(() => undefined);
  await closed;
  expect(page.isClosed()).toBe(true);
});

test('toggle off disables blocking', async ({ context, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: true, blocklist: ['127.0.0.1'] },
    });
  });

  await expect
    .poll(
      async () =>
        (await serviceWorker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length,
    )
    .toBeGreaterThan(0);

  const blocked = await context.newPage();
  const closed = blocked.waitForEvent('close');
  await blocked.goto('http://127.0.0.1:4545/').catch(() => undefined);
  await closed;
  expect(blocked.isClosed()).toBe(true);

  await serviceWorker.evaluate(async () => {
    const got = await chrome.storage.sync.get('settings');
    const settings = (got.settings as { enabled: boolean; blocklist: string[] }) ?? {
      enabled: false,
      blocklist: [],
    };
    await chrome.storage.sync.set({
      settings: { ...settings, enabled: false },
    });
  });

  await expect
    .poll(
      async () =>
        (await serviceWorker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length,
    )
    .toBe(0);

  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4545/');
  await expect(page.locator('#hello')).toHaveText('hello from the real site');
});

test('enabling blocking closes existing tabs on blocked hosts', async ({
  context,
  serviceWorker,
}) => {
  const tab = await context.newPage();
  await tab.goto('http://127.0.0.1:4545/');
  await expect(tab.locator('#hello')).toBeVisible();

  const closed = tab.waitForEvent('close');

  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: true, blocklist: ['127.0.0.1'] },
    });
  });

  await closed;
  expect(tab.isClosed()).toBe(true);
});
