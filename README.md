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

## CI

`.github/workflows/ci.yml` installs pnpm + Playwright on every PR and push to `production`, then runs lint → type-check → build → e2e.
