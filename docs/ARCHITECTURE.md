# Architecture

GTD is a local-first monorepo. The browser is a client of a small REST API, and the
API and headless CLI share the same repositories and SQLite database.

## Package boundaries

| Package | Owns |
| --- | --- |
| `@gtd/core` | Pure domain types and rules: containers, transitions, field definitions, filters, recurrence, metrics, invariants, and recommendations. |
| `@gtd/db` | SQLite migrations, data-directory resolution, JSON helpers, and repositories. |
| `@gtd/server` | Fastify application, request validation, error mapping, and REST routes. |
| `@gtd/web` | React screens, URL-driven list state, query caching, and presentation. |
| `@gtd/cli` | A thin command parser that opens the shared database and calls repositories directly. |

The dependency direction is `web -> core`, `server -> core + db`, and `cli -> core + db`.
The web package does not import the database or server packages, and the core package has
no I/O dependency.

## Data flow

Writes enter through either the API or CLI and finish in a repository. Repositories own
foreign-key writes, lifecycle transitions, activity logging, completion timestamps, and
recurrence materialization. The API expands items with configured field definitions before
returning them. The web client caches those responses with React Query and invalidates
related prefixes after mutations.

SQLite lives in the directory resolved from `GTD_HOME`, falling back to `~/.gtd`. WAL mode
allows the API and CLI to use the same file. Tests use an in-memory database and inject the
clock where date-sensitive behavior matters.

## Important invariants

- Inbox capture never asks for classification; every capture starts in `inbox`.
- A calendar item needs a hard date/time. A deadline is soft and never places work on the
  calendar.
- Waiting work needs both a person and a follow-up date.
- Completed work is filed in `done`, not deleted. Recurring series definitions and their
  materialized occurrences are kept distinct.
- Checklist templates copy their entries onto a new item; an item never depends on a
  future template edit.
- Filters and sorts are compiled by core into parameterized SQL. The browser does not
  filter a partial page, and neither does the CLI.
- Wiping is a delete of rows, never of the schema. The database stays valid and
  migrated, so setup can be run again immediately. `setup.completed` is deliberately not
  preserved: clearing it is what returns the application to first-run state.

## Setup

The wizard builds a list of requests from its answers (`packages/web/src/setup/plan.ts`) and
executes them in order (`use-setup-wizard.ts`). Two phases, because a category's id does not
exist until it is created: settings, then categories, then fields and contexts addressed at the
ids the category requests actually returned. `setup.completed` is written last, so an interrupted
setup leaves an app that is configured but still asks to be set up.

It offers a default set — five areas of life, their fields, and six contexts — on two routes. One
button jumps straight to the review step, and the same set can be loaded into the steps to edit.
Both routes are previews, not commitments: the review step lists exactly what will be written,
every default carries a template id the wizard replaces with its own, and the danger zone removes
all of it in one action.

## The wipe

`packages/db/src/wipe.ts` deletes every row of user data in one transaction, with foreign
keys enforced and children removed before parents. It refuses to run if the schema
contains a table it does not know how to clear, because a wipe that quietly left a table
behind would destroy data while reporting that it had removed everything.

The API route requires the confirmation phrase `WIPE EVERYTHING`, and the CLI requires the
same phrase via `--confirm`. Both entry points agreeing is deliberate: two ways in with
different safety rules is how someone destroys a week of data with the laxer one.

## Development mode

`pnpm dev:server` runs the server from TypeScript source using Node's type stripping. That
needs a resolve hook, because TypeScript's NodeNext imports name the compiled `.js` files
while only `.ts` exists on disk; `packages/server/src/dev-loader.mjs` maps local `.js`
specifiers back to their sources and leaves package resolution to Node.

`rrule` publishes an ESM build through its `module` field but Node follows the CommonJS
`main`, so `core` accepts either shape at the import site. That is the one place in the
codebase where a dependency's packaging shape is handled, and it is there because a named
import that works under a bundler and fails under Node is otherwise a production outage
that no test catches.

## Testing strategy

Core tests exercise pure rules. Database tests exercise migrations and repositories against
SQLite. Server tests use Fastify injection. Web tests render the SPA in a memory router and
stub the API. Run `pnpm test` for the full suite and `pnpm check` before a commit.
