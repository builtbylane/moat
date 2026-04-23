# Moat

A minimalist Chrome extension that blocks a list of sites you choose, with a clean toggle and a one-click **Focus for 1 hour** mode. Built with TypeScript, Vite, and `chrome.declarativeNetRequest` — no background JS runs per request, so blocking is fast and battery-friendly.

- **Toggle** — enable or disable blocking globally.
- **Focus for 1 hour** — forces blocking on for 60 minutes, then restores your previous state. Cancel any time.
- **Light + dark** — follows your system theme automatically.
- **No telemetry. No server. No accounts.** Your blocklist lives in Chrome's sync storage.

## Stack

- TypeScript (strict), Vanilla DOM — no framework.
- Vite + [`@crxjs/vite-plugin`](https://crxjs.dev/) for the MV3 build.
- `chrome.declarativeNetRequest` dynamic rules (evaluated in the browser's network layer).
- Playwright for end-to-end tests.

## Develop

```sh
pnpm install
pnpm build
```

Load the built extension in Chrome:

1. Go to `chrome://extensions/`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and choose the `dist/` folder.

Dev mode with HMR:

```sh
pnpm dev
```

Then load `dist/` as above; the build rewrites on file change.

## Test

Playwright end-to-end tests launch a real (headless) Chromium with the extension installed and drive the UI:

```sh
pnpm test:install   # once
pnpm test
```

Tests cover the popup toggle, blocklist CRUD on the options page, actual request redirection on a blocked host, and focus-mode start/cancel behavior.

## Layout

```
src/
  manifest.ts               MV3 manifest (typed)
  background/
    service-worker.ts       Reconciles DNR rules from storage + alarms
  lib/
    types.ts                Settings, FocusState, message types
    storage.ts              Typed chrome.storage wrapper + host normalization
    blocking.ts             Build & apply DNR dynamic rules
    theme.css               Design tokens (light/dark)
  popup/                    320px popup with toggle + focus button
  options/                  Blocklist management page
  blocked/                  Tiny stub that closes its tab on load (what the DNR rule redirects to)
tests/e2e/                  Playwright specs + fixtures
```

## Data

- `chrome.storage.sync` → `{ settings: { enabled, blocklist: string[] } }`
- `chrome.storage.local` → `{ focus: { active, startedAt, endsAt, previousEnabled } }`
- `chrome.alarms` → `moat:focus-end` fires when focus expires.

All reconciliation lives in the service worker: any storage change triggers `syncRules`, which diffs and updates the dynamic DNR ruleset.

## License

MIT.
