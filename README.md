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
| `pnpm test` | Run all tests. No build needed first, see below |
| `pnpm typecheck` | Build packages, then typecheck everything |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm check` | typecheck + lint + format check + tests. Run this before every commit |

### Tests do not read `dist`

Vitest is configured to alias every `@gtd/*` import to that package's **source**,
so a test in one package can never accidentally exercise a stale build of another.
Without it, a bug already fixed in `src` gets chased again because `db/dist` is
what got imported — which happened, twice, in the same afternoon.

That is also why `pnpm test` does not build first: there is nothing to build for a
test run. Compiling the real build output is still verified, because `pnpm check`
runs `typecheck`, which builds every package before checking it.

The aliases are derived from each package's own manifest, so adding a package needs
no change. `test/harness.test.ts` guards the arrangement and fails if the alias is
removed.


## CLI

The CLI runs from the repository. It is not installed globally, so it is invoked through
pnpm — there is no bare `gtd` on your `PATH`:

```bash
pnpm build                       # once, to compile packages/cli to dist
pnpm gtd capture "buy milk"      # add --silent to drop pnpm's own command line
pnpm gtd list inbox
pnpm gtd reset --preview
pnpm gtd reset --confirm "WIPE EVERYTHING"
```

`pnpm cli ...` is an alias for the same thing, and `node packages/cli/dist/bin.js ...` works
if you prefer to bypass pnpm. To get a bare `gtd`, put this in your shell profile:

```bash
alias gtd='pnpm --silent gtd'
```

`reset` empties every table of user data, including all settings, and leaves the schema
and migrations intact — the app comes back as first-run, with the setup wizard waiting.
`--preview` reports what would go without touching anything, and needs no confirmation
phrase precisely because it changes nothing. The actual wipe requires the phrase in full.

## Data

SQLite lives in `$GTD_HOME` (default `~/.gtd`). WAL mode is enabled so the CLI and a
running API server can safely share the same file.

## Documentation

- `docs/ARCHITECTURE.md` — package boundaries, data model, design decisions
- `docs/ROADMAP.md` — planned and future features

## License

Private.
