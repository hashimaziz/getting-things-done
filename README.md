# GTD

A local-first implementation of David Allen's [Getting Things Done](https://gettingthingsdone.com/)
methodology: capture, clarify, organize, reflect, engage — backed by a single SQLite file on
your own machine.

Everything lives in one place. A React dashboard, a small REST API and a headless CLI all read
and write the same database, so you can throw a thought at the terminal in two seconds and work
through it properly in the browser when you have time.

## What it is

GTD here is not a to-do list with GTD branding. The parts of Allen's method that other apps skip
are the parts this one treats as rules:

- **Capture never asks a question.** Anything you capture lands in the inbox as-is. Deciding
  what a thing *is* while capturing is exactly what stops people capturing.
- **Clarify is a decision tree, not a form.** The questions are asked in Allen's order and the
  ones already answered are skipped, because a clarifying conversation that reads five questions
  to get one answer is a form with better manners.
- **The calendar is sacred.** It holds only hard commitments bound to a date and time. A soft
  deadline is a field on the item and never puts work on the calendar.
- **Waiting For needs a person and a follow-up date.** Delegated work with no chase date is work
  you will quietly never do.
- **Done is filed, not deleted.** Completed work goes to `done` with a completion timestamp, and
  every item carries an activity trail.
- **The review is a sequence, not a list.** Allen calls the weekly review the single critical
  success factor for the whole system. Each step takes you to the list it applies to, because a
  review you scroll past is not a review.

## Features

Everything below is implemented and reachable from the app today.

**Workflow**

- Inbox capture from the web (`/capture`) or the CLI, with capture tips and no classification step
- Guided clarify flow with the two-minute rule, delegation, deadlines and next actions
- Eight containers: Inbox, Next Actions, Calendar, Waiting For, Someday/Maybe, Reference, Done,
  Trash
- Weekly review at `/review`, walking through inbox, next actions, calendar, waiting, projects,
  checklists and someday in order, with progress and a review timestamp
- Calendar at `/calendar`, showing hard commitments only
- Archive at `/archive`: completed items with working facets, sort on every column, and restore
- Activity log per item, plus a completion-throughput view

**Configuration**

- First-run setup wizard that offers a default set — five areas of life with their own field
  definitions, and six contexts — or a two-area starting point to build from
- Categories with descriptions and colours, each owning its own field definitions
- Fourteen field types (`text`, `longtext`, `number`, `duration`, `select`, `multiselect`,
  `priority`, `boolean`, `date`, `datetime`, `person`, `people`, `checklist`, `url`), each
  configurable for requiredness, table visibility, filterability and sortability
- Reference data: people, contexts and projects
- Checklist templates at `/settings/templates` — using a template copies its steps onto the item,
  so editing a template never rewrites past work
- Recurring items with nine presets (daily, every weekday, weekly, fortnightly, monthly,
  quarterly, yearly, first and last day of the month) or a raw RRULE; occurrences are real rows
  you can complete, defer and annotate individually
- Configurable keyboard shortcuts with a command palette (`mod+k` by default)
- Light and dark themes, timezone, week start

**Dashboard**

- Composable widget dashboard: add, remove, resize, drag to arrange, with keyboard-accessible
  moves
- Widgets over system health, inbox backlog, overdue and waiting counts, throughput chart,
  breakdowns by category, container and project, next-step and overdue recommendations, the
  waiting list, recent completions

**Analysis**

- System health metrics and invariant checks: projects without a next action, waiting-for without
  a follow-up date, calendar items without a date, stale inbox items
- A deterministic recommendation provider that scores work using Allen's four engagement criteria
  and always explains itself. The provider seam is built so a local model can be added later
  without displacing the rule-based baseline

## Packages

A pnpm workspace of five packages. The dependency direction is `web → core`,
`server → core + db`, `cli → core + db`.

| Package | Responsibility |
| --- | --- |
| `@gtd/core` | Pure domain logic. No I/O, no database, no UI. Containers and their invariants, the clarify decision tree, field types and definitions, the filter/sort compiler, recurrence, metrics, recommendation providers. |
| `@gtd/db` | SQLite schema and migrations, repositories, activity logging, recurrence materialization, data directory resolution, the wipe. Uses Node's built-in `node:sqlite`, so there is no native module to compile. |
| `@gtd/server` | Fastify REST API. Request validation with Zod, error mapping, field expansion. |
| `@gtd/web` | Vite + React 19 SPA. Imports `core` only — never `db` or `server`. |
| `@gtd/cli` | Headless `gtd` binary. Calls the same repositories as the API, so it works with the server stopped and the lifecycle rules live in exactly one place. |

The rule is deliberate: keeping the domain layer free of I/O is what lets the browser and the
terminal share it, and what will let a local model be added as a new package without touching
existing code.

## Tech stack

TypeScript everywhere, strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
Node's built-in SQLite, Fastify 5, Zod 4, `rrule` for calendar arithmetic, `date-fns` for dates.
React 19, React Router 7, TanStack Query, Zustand, Radix UI, Tailwind 4, Recharts on the front
end. Vitest throughout. ESLint and Prettier. No runtime dependencies on the server beyond those
listed above.

## Prerequisites

- **Node.js >= 24** (the SQLite driver is `node:sqlite`; the server dev mode uses Node's native
  TypeScript type stripping)
- **pnpm** — `corepack enable` if you do not have it. The repo pins `pnpm@12.10.1` via
  `packageManager`.

## Install

```bash
pnpm install
```

## Run it

### Development

```bash
pnpm dev
```

That builds the library packages, then starts the API and the web dev server together with hot
reload. Open <http://localhost:5173>.

The Vite dev server proxies `/api` to the API on <http://127.0.0.1:4319>. On first run the app has
no data and no configuration, so it presents the setup wizard — nothing is seeded behind your
back.

Run the halves separately if you prefer:

```bash
pnpm dev:server    # API only, from TypeScript source
pnpm dev:web       # web UI only, expects the API on 127.0.0.1:4319
```

### Production

```bash
pnpm build                                    # all packages + the web bundle
pnpm --filter=@gtd/server start               # API on http://127.0.0.1:4319
pnpm --filter=@gtd/web preview                # static bundle on http://localhost:4173
```

Be aware: `vite preview` does **not** proxy `/api` (there is no `preview.proxy` in
`packages/web/vite.config.ts`), so the built bundle needs a reverse proxy in front of the API to
work. The API itself only serves `/api/*`; it does not serve the web bundle. The server is
loopback-only by default and takes `GTD_HOST`/`GTD_PORT` to change that.

## Using it

### Web UI

| Route | What it is |
| --- | --- |
| `/` and `/dashboard` | The widget dashboard |
| `/capture` | Frictionless inbox capture |
| `/clarify` | The clarify flow |
| `/list/:container` | Any container: `inbox`, `next_action`, `calendar`, `waiting`, `someday`, `reference`, `done`, `trash` |
| `/item/:id` | One item: fields, checklist, recurrence, activity |
| `/calendar` | Hard commitments |
| `/review` | The weekly review |
| `/archive` | Completed items and the activity log |
| `/settings` | Application settings, categories, field definitions, reference data, and the danger zone |
| `/settings/templates` | Checklist templates |
| `/settings/dashboards` | Dashboard layouts |
| `/settings/shortcuts` | Keyboard bindings |

Filtering and sorting go through the same compiler on both sides of the wire: a request becomes
parameterised SQL in `core`, so the browser never filters a partial page and neither does the CLI.

Default shortcuts: `mod+k` command palette, `c` capture, `n` new item, `i` inbox, `a` next
actions, `d` calendar, `r` review, `t` theme. All rebindable at `/settings/shortcuts`.

`/projects` is routed but shows a "not built yet" placeholder — project review and natural planning
are on the roadmap, not in the code.

### CLI

The CLI is not installed globally, so there is no bare `gtd` on your `PATH`. Build once, then
invoke through pnpm:

```bash
pnpm build                        # once, compiles packages/cli to dist
pnpm gtd capture "buy milk"       # --silent drops pnpm's own command line
pnpm gtd list inbox
pnpm gtd show <id>
pnpm gtd move <id> next_action
pnpm gtd complete <id>
pnpm gtd reopen <id>
pnpm gtd trash <id>
pnpm gtd restore <id>
pnpm gtd reset --preview
pnpm gtd reset --confirm "WIPE EVERYTHING"
```

`pnpm cli ...` is an alias for the same thing, and `node packages/cli/dist/bin.js ...` works if you
would rather bypass pnpm entirely. For a bare `gtd`, put this in your shell profile:

```bash
alias gtd='pnpm --silent gtd'
```

Flags: `--json` for machine-readable output, `--limit <n>` (default 50, capped at 500),
`--category <key>`, `--container <name>`, `--preview`, `--confirm <phrase>`.

`capture` needs a category, because an item cannot belong to nothing. With exactly one category
configured it is inferred; with several, pass `--category`. With none configured, run the web
setup first.

`reset` deletes every row of user data — including settings — in one transaction with foreign keys
enforced, and leaves the schema and migrations intact, so the app comes back as first-run with the
wizard waiting. `--preview` reports the row counts per table and needs no confirmation phrase
precisely because it changes nothing; the real wipe requires the phrase in full. The web danger
zone requires the same phrase. Two entry points disagreeing about what is safe is how someone
loses a week of work.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `GTD_HOME` | `~/.gtd` | Directory holding the database. A relative path resolves against the current working directory, not `$HOME`. |
| `GTD_PORT` | `4319` | Port the API binds to. |
| `GTD_HOST` | `127.0.0.1` | Interface the API binds to. Loopback by default, deliberately: the app is single-user and the data is personal. |

The database file is `gtd.sqlite` inside the data directory, created with mode `0700` on first
run. WAL mode is enabled, which is what lets the CLI and a running server share the same file.
Migrations run automatically at startup; both entry points run them with checksum verification, so
editing a shipped migration fails loudly rather than corrupting an existing database.

Everything else — timezone, week start, categories, field definitions, contexts, people, projects,
dashboard layouts, theme, shortcuts — is configured in the app and stored in the database, not in
files. The only settings that are environment-dependent are the three above.

## Data

```
$GTD_HOME/gtd.sqlite     # default: ~/.gtd/gtd.sqlite
```

One file. Back it up by copying it, and only while nothing is running, or use SQLite's own backup
mechanism. The directory and file are created on first run and are git-ignored.

To keep a throwaway or second store, point `GTD_HOME` somewhere else:

```bash
GTD_HOME=/tmp/gtd-scratch pnpm dev
```

## Testing

```bash
pnpm test          # the whole suite
pnpm test:watch    # watch mode
pnpm typecheck     # builds the packages, then typechecks everything
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm check         # typecheck + lint + format:check + test — run this before every commit
```

Core tests exercise the pure rules, database tests exercise migrations and repositories against
SQLite, server tests use Fastify injection, and web tests render the SPA in a memory router with a
stubbed API. The clock is injected wherever date-sensitive behaviour matters.

### Tests do not read `dist`

Vitest aliases every `@gtd/*` import to that package's **source** rather than its build output, so
a test in one package can never accidentally exercise a stale build of another. Without it, a bug
already fixed in `src` gets chased again because `db/dist` is what got imported — which happened,
twice, in the same afternoon.

That is also why `pnpm test` does not build first: there is nothing to build for a test run. The
real build output is still verified, because `pnpm typecheck` builds every package before checking
it, and `pnpm check` runs `typecheck`.

The aliases are derived from each package's own manifest, so adding a package needs no change.
`test/harness.test.ts` guards the arrangement and fails if the alias is removed.

## Project structure

```
GTD/
├── packages/
│   ├── core/     domain logic, no I/O
│   ├── db/       SQLite, migrations, repositories
│   ├── server/   Fastify API
│   ├── web/      Vite + React SPA
│   └── cli/      headless gtd binary
├── docs/
│   ├── ARCHITECTURE.md   package boundaries, data model, design decisions
│   └── ROADMAP.md        planned and future features
├── test/         guards for the workspace test harness itself
├── package.json  workspace root, scripts
└── pnpm-workspace.yaml
```

## Troubleshooting

**The API prints `Restarting 'src/main.ts'` several times at startup.** Expected. `pnpm dev`
builds the library packages and then starts the API under `node --watch`, which sees the freshly
written build output and re-spawns a few times before settling. It stabilises on its own — if it
does not, stop and rerun `pnpm dev`.

**`--experimental-loader` or SQLite warnings in the terminal.** Expected. Dev mode uses Node's
type stripping with a resolve hook, and `node:sqlite` is still marked experimental. The CLI
suppresses the SQLite warning specifically.

**The CLI says no category exists.** Correct behaviour. An item must belong to a category, and a
fresh database has none. Finish the web setup wizard, or check whether `GTD_HOME` points somewhere
other than where you ran the wizard.

**The web UI loads but every request 404s.** The dev proxy targets `127.0.0.1:4319` hard-coded. If
you set `GTD_PORT`, either change the proxy in `packages/web/vite.config.ts` or unset `GTD_PORT`.

**The production bundle cannot reach the API.** `vite preview` serves static files and does not
proxy `/api`. Put a reverse proxy in front of the API, or run `pnpm dev`.

**`MigrationDriftError`.** A migration that already shipped was edited. Restore it and add a new
one. The app refuses to start rather than apply a changed migration to an existing database.

**A second clone wants its own data.** `GTD_HOME` is read per process by both the server and the
CLI, so it is safe to point them at different directories.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — package boundaries, data flow, invariants, the
  wipe, development mode, testing strategy
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what is implemented and what is planned

## License

Private. All packages are marked `"private": true` in their manifests and no license file is
granted; all rights reserved.