import type { FocusState, Settings } from '../../src/lib/types';
import { expect, resetState, test } from './fixtures';

test.beforeEach(async ({ serviceWorker }) => {
  await resetState(serviceWorker);
});

test('starts focus, forces blocking on, shows countdown', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // Seed a blocklist so DNR rules can be produced when focus engages.
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist: ['127.0.0.1'] },
    });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  await page.getByRole('button', { name: 'Start focus' }).click();

  const endFocusButton = page.getByRole('button', { name: 'End focus' });
  await expect(endFocusButton).toBeVisible();

  const time = page.locator('.focus-card__time');
  await expect(time).toBeVisible();
  await expect(time).toHaveText(/^\d{2}:\d{2}$/);

  await expect
    .poll(async () => {
      const focus = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.local.get('focus');
        return got.focus as FocusState | undefined;
      });
      return focus?.active === true && focus.endsAt > Date.now() + 59 * 60 * 1000;
    })
    .toBe(true);

  const alarm = await serviceWorker.evaluate(async () => chrome.alarms.get('moat:focus-end'));
  expect(alarm).toBeTruthy();
  expect(alarm?.name).toBe('moat:focus-end');

  await expect
    .poll(
      async () =>
        (await serviceWorker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length,
    )
    .toBeGreaterThanOrEqual(1);
});

test('cancel focus restores previous enabled state', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist: ['127.0.0.1'] },
    });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  await page.getByRole('button', { name: 'Start focus' }).click();

  await expect
    .poll(async () => {
      const focus = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.local.get('focus');
        return got.focus as FocusState | undefined;
      });
      return focus?.active === true;
    })
    .toBe(true);

  await page.getByRole('button', { name: 'End focus' }).click();

  await expect
    .poll(async () => {
      const focus = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.local.get('focus');
        return got.focus as FocusState | undefined;
      });
      return focus ?? null;
    })
    .toBeNull();

  const settings = await serviceWorker.evaluate(async () => {
    const got = await chrome.storage.sync.get('settings');
    return got.settings as Settings | undefined;
  });
  expect(settings?.enabled).toBe(false);

  await expect
    .poll(
      async () =>
        (await serviceWorker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length,
    )
    .toBe(0);
});

test('selecting 15m duration starts a 15-minute focus', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist: ['127.0.0.1'] },
    });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  // Pick the 15m segment in the duration picker, then Start focus.
  await page.locator('.duration-picker [role="radio"]', { hasText: '15m' }).click();
  await page.getByRole('button', { name: 'Start focus' }).click();

  await expect
    .poll(async () => {
      const focus = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.local.get('focus');
        return got.focus as FocusState | undefined;
      });
      if (!focus?.active) return false;
      const duration = focus.endsAt - focus.startedAt;
      const fifteenMin = 15 * 60 * 1000;
      return duration >= fifteenMin - 500 && duration <= fifteenMin + 500;
    })
    .toBe(true);

  // The countdown should show 14: or 15: (clock may have moved a bit).
  const time = page.locator('.focus-card__time');
  await expect(time).toBeVisible();
  await expect(time).toHaveText(/^(14|15):\d{2}$/);
});

test('default segment is 1h', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  const oneHour = page.locator('.duration-picker [role="radio"]', { hasText: '1h' });
  await expect(oneHour).toHaveAttribute('aria-checked', 'true');
});
