import { expect, test } from './fixtures';

test('toolbar action opens its configured popup', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await serviceWorker.evaluate(() => chrome.action.openPopup());
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: [chrome.runtime.ContextType.POPUP],
        });
        return contexts.map((context) => context.documentUrl);
      }),
    )
    .toContain(await serviceWorker.evaluate(() => chrome.action.getPopup({})));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const [popup] = chrome.extension.getViews({ type: 'popup' });
        const toggle = popup?.document.querySelector('[role="switch"]');
        return !!toggle && toggle.getBoundingClientRect().height > 0;
      }),
    )
    .toBe(true);
});

test('popup has visible content before JavaScript starts', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setScriptExecutionDisabled', { value: true });
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(page.locator('#app')).toContainText('Moat');
  await expect(page.getByRole('link', { name: 'Manage blocked sites' })).toBeVisible();
});

test('unresponsive optional APIs do not prevent popup startup', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    chrome.tabs.query = () => new Promise(() => {});
    chrome.commands.getAll = () => new Promise(() => {});
  });
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(page.getByRole('switch')).toBeVisible();
  await page.getByRole('switch').click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

test('storage failure offers retry and recovers', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const get = chrome.storage.sync.get.bind(chrome.storage.sync);
    chrome.storage.sync.get = () => {
      chrome.storage.sync.get = get;
      return Promise.reject(new Error('Storage unavailable'));
    };
  });
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(page.getByRole('alert')).toContainText('Couldn’t load');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('switch')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a stalled storage read times out and can be retried', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.clock.install();
  await page.addInitScript(() => {
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = () => {
      chrome.storage.local.get = get;
      return new Promise<never>(() => {});
    };
  });
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(page.getByText('Loading your settings…')).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('switch')).toBeVisible();
});

test('failed actions show an error and keep controls usable', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    chrome.runtime.sendMessage = () => Promise.reject(new Error('Background unavailable'));
    chrome.storage.sync.set = () => Promise.reject(new Error('Storage quota exceeded'));
  });
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await page.getByRole('button', { name: 'Start focus' }).click();
  await expect(page.getByRole('alert')).toContainText('Background unavailable');
  await expect(page.getByRole('button', { name: 'Start focus' })).toBeEnabled();
  await page.getByRole('switch').click();
  await expect(page.getByRole('alert')).toContainText('Storage quota exceeded');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('duration picker keeps keyboard focus after selection', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await page.getByRole('radio', { name: '1h', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '2h' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('radio', { name: '15m' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('radio', { name: '2h' })).toBeFocused();
});

test('invalid saved data does not break the popup or blocking rules', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: {
        enabled: true,
        blocklist: [null, 123, {}, 'not a host', 'https://www.example.com/path', 'example.com'],
      },
    });
    await chrome.storage.local.set({ focus: { active: true, endsAt: 'invalid' } });
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.popup__status-subtitle')).toHaveText('1 site blocked');
  await expect(page.getByRole('button', { name: 'Start focus' })).toBeVisible();
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () =>
        (await chrome.declarativeNetRequest.getDynamicRules()).map(
          (rule) => rule.condition.urlFilter,
        ),
      ),
    )
    .toEqual(['||example.com^']);
});

test('focus mode shows an enabled switch and preserves focus across timer ticks', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await page.getByRole('button', { name: 'Start focus' }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  const end = page.getByRole('button', { name: 'End focus' });
  await end.focus();
  await page.clock.fastForward(3000);
  await expect(end).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
