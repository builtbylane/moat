import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PRESETS } from '../../src/lib/presets';
import type { Settings } from '../../src/lib/types';
import { expect, resetState, test } from './fixtures';

test.beforeEach(async ({ serviceWorker }) => {
  await resetState(serviceWorker);
});

test('empty state is shown initially', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator('.empty')).toHaveText('No sites blocked yet — add one above.');
});

test('add + remove flow', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  await page.locator('#moat-add-input').fill('example.com');
  await page.getByRole('button', { name: 'Add' }).click();

  const host = page.locator('.list__host', { hasText: 'example.com' });
  await expect(host).toBeVisible();

  const row = page.locator('.list__item', { has: host });
  await row.getByRole('button', { name: /Remove/ }).click();

  await expect(page.locator('.empty')).toBeVisible();
});

test('Enter submits', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  const input = page.locator('#moat-add-input');
  await input.fill('foo.com');
  await input.press('Enter');

  await expect(page.locator('.list__host', { hasText: 'foo.com' })).toBeVisible();
});

test('normalization', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  const input = page.locator('#moat-add-input');
  await input.fill('  https://www.EXAMPLE.com/path?x=1  ');
  await page.getByRole('button', { name: 'Add' }).click();

  const rows = page.locator('.list__host');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveText('example.com');
});

test('duplicate is silently ignored', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  const input = page.locator('#moat-add-input');
  const addButton = page.getByRole('button', { name: 'Add' });

  await input.fill('dup.com');
  await addButton.click();
  await expect(page.locator('.list__host', { hasText: 'dup.com' })).toBeVisible();

  await input.fill('dup.com');
  await addButton.click();

  // Wait for any re-render to settle, then assert only one row.
  await expect(page.locator('.list__host')).toHaveCount(1);
  await expect(page.locator('#moat-add-error')).toHaveText('');
});

test('invalid input shows error', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  await page.locator('#moat-add-input').fill('not a host');
  await page.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('#moat-add-error')).toHaveText(/doesn.+t look like a domain/i);
  await expect(page.locator('.list__host')).toHaveCount(0);
});

test('export produces JSON with the blocklist', async ({ context, extensionId, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist: ['a.com', 'b.com'] },
    });
  });

  const page = await context.newPage();

  // Intercept Blob content before the extension uses URL.createObjectURL so the
  // anchor download would otherwise trigger a real download. We also replace
  // the anchor click handler so that it does nothing, keeping the test hermetic.
  await page.addInitScript(() => {
    const w = window as unknown as {
      __moatExportedJson?: string;
    };
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
      if (blob instanceof Blob) {
        void blob.text().then((text) => {
          w.__moatExportedJson = text;
        });
      }
      return originalCreate(blob);
    };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download === 'moat-blocklist.json') return;
      return origClick.apply(this);
    };
  });

  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  // Wait for blocklist to render before exporting.
  await expect(page.locator('.list__host')).toHaveCount(2);

  await page.getByRole('button', { name: 'Export blocklist' }).click();

  await expect
    .poll(async () => {
      return await page.evaluate(
        () => (window as unknown as { __moatExportedJson?: string }).__moatExportedJson,
      );
    })
    .toBeTruthy();

  const json = await page.evaluate(
    () => (window as unknown as { __moatExportedJson?: string }).__moatExportedJson as string,
  );

  const parsed = JSON.parse(json) as {
    moat: number;
    exportedAt: string;
    blocklist: string[];
  };
  expect(parsed.moat).toBe(1);
  expect(typeof parsed.exportedAt).toBe('string');
  expect(parsed.blocklist).toEqual(['a.com', 'b.com']);
});

test('import merges a JSON file into the list', async ({ context, extensionId, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist: ['a.com'] },
    });
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moat-import-'));
  const filePath = path.join(tmpDir, 'import.json');
  await fs.writeFile(
    filePath,
    JSON.stringify({ moat: 1, blocklist: ['c.com', 'd.com', 'https://WWW.E.com/path'] }),
  );

  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await expect(page.locator('.list__host')).toHaveCount(1);

    await page.locator('#moat-import-input').setInputFiles(filePath);

    await expect(page.locator('.list__host')).toHaveCount(4);
    const hosts = await page.locator('.list__host').allTextContents();
    expect(hosts).toEqual(['a.com', 'c.com', 'd.com', 'e.com']);

    const stored = await serviceWorker.evaluate(async () => {
      const got = await chrome.storage.sync.get('settings');
      return got.settings as Settings | undefined;
    });
    expect(stored?.blocklist).toEqual(['a.com', 'c.com', 'd.com', 'e.com']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('preset Social adds the expected hosts', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  await page.locator('.chip[data-preset="Social"]').click();

  const social = PRESETS[0];
  if (!social) throw new Error('Social preset missing');
  await expect(page.locator('.list__host')).toHaveCount(social.hosts.length);

  const rendered = await page.locator('.list__host').allTextContents();
  for (const host of social.hosts) {
    expect(rendered).toContain(host);
  }
});

test('preset chip is marked as added when everything is present', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const social = PRESETS[0];
  if (!social) throw new Error('Social preset missing');

  const seed = [...social.hosts].sort();
  await serviceWorker.evaluate(async (blocklist: string[]) => {
    await chrome.storage.sync.set({
      settings: { enabled: false, blocklist },
    });
  }, seed);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  const chip = page.locator('.chip[data-preset="Social"]');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toHaveClass(/chip--added/);
});
