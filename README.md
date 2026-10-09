# GTD

A digital-first implementation of the [Getting Things Done](https://gettingthingsdone.com/) methodology by David Allen.

Local-first, configurable through code and in-app, backed by a single SQLite file.

## Packages

| Package | Responsibility |
| --- | --- |
| `@gtd/core` | Pure domain logic. No I/O, no database, no UI. Field schema, containers, clarify rules, recurrence, filter compiler, metrics, recommendation providers. |
| `@gtd/db` | SQLite schema, migrations, repositories, data directory resolution. |
| `@gtd/server` | Fastify REST API. Wires `core` + `db`. |
| `@gtd/web` | Vite + React dashboard SPA. Imports `core` only — never `db` or `server`. |
| `@gtd/cli` | Headless `gtd` binary for frictionless capture. |

The dependency rule `web → core` and `server → {core, db}` is deliberate: it keeps the
domain layer portable so future capability providers (e.g. a local LLM) can be added
as new packages without touching existing code.

## Requirements

- Node.js >= 24
- pnpm

## Getting started

```bash
pnpm install
pnpm dev          # builds packages, then runs API + web with hot reload
```

The web app runs on <http://localhost:5173> and proxies `/api` to the API server.
On first run the app presents a setup wizard — nothing is seeded automatically.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Build packages, run API and web in watch mode |
| `pnpm build` | Build all packages and the web bundle |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Build packages, then typecheck everything |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm check` | typecheck + lint + format check + tests. Run this before every commit. |

## Data

SQLite lives in `$GTD_HOME` (default `~/.gtd`). WAL mode is enabled so the CLI and a
running API server can safely share the same file.

## Documentation

- `docs/ARCHITECTURE.md` — package boundaries, data model, design decisions
- `docs/ROADMAP.md` — planned and future features

## License

Private.
