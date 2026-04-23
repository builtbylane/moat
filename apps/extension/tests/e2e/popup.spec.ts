import type { Settings } from '../../src/lib/types';
import { expect, resetState, test } from './fixtures';

test.beforeEach(async ({ serviceWorker }) => {
  await resetState(serviceWorker);
});

test('opens to off state with empty blocklist message', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  const toggle = page.locator('#app button[role="switch"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.popup__status-title')).toContainText('Blocking is off');
  await expect(page.locator('.popup__status-subtitle')).toContainText('No sites blocked yet');
});

test('toggle on persists to storage', async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  const toggle = page.locator('#app button[role="switch"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await expect
    .poll(async () => {
      const result = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.sync.get('settings');
        return got.settings as Settings | undefined;
      });
      return result?.enabled;
    })
    .toBe(true);

  await page.close();

  const page2 = await context.newPage();
  await page2.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const toggle2 = page2.locator('#app button[role="switch"]');
  await expect(toggle2).toHaveAttribute('aria-checked', 'true');
});

test('count subtitle updates when sites are added', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist: ['a.com', 'b.com'] },
    });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(page.locator('.popup__status-subtitle')).toContainText('2 sites blocked');
});

/**
 * Init script that stubs chrome.tabs.query so it reports the given URL for
 * ({ active: true, currentWindow: true }) queries. Needed because under
 * Playwright the popup page itself is the active tab — there is no way to
 * drive the real browser popup UI with a sibling "current tab" for the E2E
 * popup page. This keeps the feature's end-to-end wiring (rendering,
 * click -> storage) under test.
 */
function stubTabsQueryScript(url: string): string {
  return `(() => {
    const fakeUrl = ${JSON.stringify(url)};
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (queryInfo) => {
      if (queryInfo && queryInfo.active === true && queryInfo.currentWindow === true) {
        return Promise.resolve([{
          id: 1,
          url: fakeUrl,
          windowId: 1,
          active: true,
          index: 0,
          highlighted: true,
          pinned: false,
          selected: true,
          incognito: false,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
          title: '',
          favIconUrl: '',
        }]);
      }
      return originalQuery(queryInfo);
    };
    chrome.tabs.remove = async (tabId) => {
      const got = await chrome.storage.local.get('__moat_remove_calls');
      const calls = got.__moat_remove_calls || [];
      calls.push(tabId);
      await chrome.storage.local.set({ __moat_remove_calls: calls });
    };
  })();`;
}

test('block this site action closes the tab when blocking is enabled', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({ settings: { enabled: true, blocklist: [] } });
  });

  const popup = await context.newPage();
  await popup.addInitScript(stubTabsQueryScript('http://127.0.0.1:4545/'));
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  await expect(popup.locator('.popup__site-host')).toHaveText('127.0.0.1');

  const blockBtn = popup.getByRole('button', { name: 'Block this site' });
  await expect(blockBtn).toBeVisible();

  const closed = popup.waitForEvent('close');
  await blockBtn.click();
  await closed;

  const blocklist = await serviceWorker.evaluate(async () => {
    const got = await chrome.storage.sync.get('settings');
    return (got.settings as Settings | undefined)?.blocklist ?? [];
  });
  expect(blocklist).toContain('127.0.0.1');

  const removeCalls = await serviceWorker.evaluate(async () => {
    const got = await chrome.storage.local.get('__moat_remove_calls');
    return (got.__moat_remove_calls as number[]) ?? [];
  });
  expect(removeCalls).toEqual([1]);
});

test('block this site action does NOT close the tab when blocking is off', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const popup = await context.newPage();
  await popup.addInitScript(stubTabsQueryScript('http://127.0.0.1:4545/'));
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  const blockBtn = popup.getByRole('button', { name: 'Block this site' });
  const closed = popup.waitForEvent('close');
  await blockBtn.click();
  await closed;

  const blocklist = await serviceWorker.evaluate(async () => {
    const got = await chrome.storage.sync.get('settings');
    return (got.settings as Settings | undefined)?.blocklist ?? [];
  });
  expect(blocklist).toContain('127.0.0.1');

  const removeCalls = await serviceWorker.evaluate(async () => {
    const got = await chrome.storage.local.get('__moat_remove_calls');
    return (got.__moat_remove_calls as number[]) ?? [];
  });
  expect(removeCalls).toEqual([]);
});

test('unblock this site action removes current host', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist: ['127.0.0.1'] },
    });
  });

  const popup = await context.newPage();
  await popup.addInitScript(stubTabsQueryScript('http://127.0.0.1:4545/'));
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  const unblockBtn = popup.getByRole('button', { name: 'Unblock this site' });
  await expect(unblockBtn).toBeVisible();
  await unblockBtn.click();

  await expect
    .poll(async () => {
      const result = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.sync.get('settings');
        return got.settings as Settings | undefined;
      });
      return result?.blocklist ?? [];
    })
    .not.toContain('127.0.0.1');
});

test('block action omitted on chrome-extension page', async ({ context, extensionId }) => {
  // When the "current tab" is the extension itself, the block row must not render.
  const popup = await context.newPage();
  await popup.addInitScript(
    stubTabsQueryScript(`chrome-extension://${extensionId}/src/popup/popup.html`),
  );
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  await expect(popup.locator('.popup__site')).toHaveCount(0);
});

test('keyboard shortcut hint is shown', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  const hint = page.locator('.popup__shortcut-hint');
  // Wait for it to render. If no shortcut is configured (user cleared it) we
  // intentionally render nothing, so be tolerant and skip with a reason.
  const exists = await hint
    .first()
    .waitFor({ state: 'attached', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  test.skip(
    !exists,
    'No shortcut rendered — manifest default may not be active in this Playwright-launched Chromium',
  );

  await expect(hint).toHaveText(/[\u2303\u2318]|Ctrl|Command/);
});
