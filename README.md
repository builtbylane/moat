# Moat monorepo

Two workspaces:

```
apps/
├── extension/   # Chrome MV3 extension (TypeScript + Vite)
└── site/        # moat.builtbylane.com — static, no build step
```

## Setup

```sh
pnpm install
```

Node 22 (`.nvmrc`), pnpm 9 (`packageManager`).

## Common commands (from repo root)

- `pnpm build` — build every workspace that has a `build` script.
- `pnpm test` — run the extension's Playwright e2e suite.
- `pnpm type-check` — type-check the extension.
- `pnpm lint` / `pnpm lint:fix` — Biome across the whole repo.
- `pnpm --filter moat dev` — start the extension's Vite dev server (HMR).

## Deployment

- **Extension** — `pnpm --filter moat build` produces `apps/extension/dist/`, which is what you upload to the Chrome Web Store (or load unpacked in `chrome://extensions/` for local testing).
- **Site** — `apps/site/` is a static directory. Cloudflare Pages deploys it directly: no build command, output directory `apps/site`.

## Popup troubleshooting

Build the extension with `pnpm --filter moat build`, then load **`apps/extension/dist/`** in
`chrome://extensions/` using **Developer mode → Load unpacked**. The old root `dist/` directory
is not updated by workspace builds. After rebuilding, click **Reload** on the unpacked extension.

If you installed Moat from the Chrome Web Store, local builds do not update that installation.
`pnpm --filter moat package` creates a versioned ZIP in the repository root for a Web Store update.
To try the fix before publication, disable the store copy and load the unpacked build above.
The unpacked copy has separate settings; export/import your blocklist from Moat’s options page
if available. Keep the store copy installed to retain its saved settings.

## CI

`.github/workflows/ci.yml` installs pnpm + Playwright on every PR and push to `production`, then runs lint → type-check → build → e2e.
