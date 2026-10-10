#!/usr/bin/env node

/**
 * Headless entry point.
 *
 * Calls the same repositories as the API rather than making HTTP requests, so the CLI
 * works with the server stopped, and so the lifecycle rules are enforced in exactly one
 * place. `capture` is intentionally one decision: text goes to the inbox, because
 * deciding what a thing is while capturing is what stops people capturing.
 */

import { createItemFieldResolver, isContainer, type FilterNode } from '@gtd/core';
import { WIPE_CONFIRMATION, bootstrap, createRepositories, wipeAllData, type Db } from '@gtd/db';
import { pathToFileURL } from 'node:url';

export interface CliOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  stdout?: { write(value: string): void };
  stderr?: { write(value: string): void };
}

interface ParsedArgs {
  command: string;
  args: string[];
  json: boolean;
  category?: string;
  container?: string;
  limit: number;
  confirm?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let db: Db | undefined;
  // Hoisted out of the try so the error path can honour `--json` even when parsing
  // itself is what failed.
  let wantsJson = argv.includes('--json');

  try {
    /*
     * Parsing inside the try. It throws on a malformed flag, and outside the try that
     * escape would surface as a stack trace instead of a message and a non-zero exit —
     * which is precisely the wrong behaviour for a command meant to be run from a
     * script.
     */
    const parsed = parseArgs(argv);
    wantsJson = parsed.json;

    if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
      stdout.write(helpText());
      return 0;
    }

    const boot = bootstrap({
      strictMigrations: true,
      ...(options.env ? { env: options.env } : {}),
      ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    });
    db = boot.db;
    const repos = createRepositories(db);
    const definitions = repos.fieldDefs.listAll();
    const resolver = createItemFieldResolver({
      fieldTypes: definitions.map((definition) => ({ key: definition.key, type: definition.type })),
    });
    const output = execute(parsed, repos, resolver, db);
    write(stdout, output, parsed.json);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson) {
      write(stdout, { error: message }, true);
    } else {
      stderr.write(`gtd: ${message}\n`);
    }
    return 1;
  } finally {
    db?.close();
  }
}

function execute(
  parsed: ParsedArgs,
  repos: ReturnType<typeof createRepositories>,
  resolver: ReturnType<typeof createItemFieldResolver>,
  db: Db,
): unknown {
  switch (parsed.command) {
    case 'capture': {
      const title = parsed.args.join(' ').trim();
      if (title === '') throw new Error('capture needs text, for example: gtd capture "Call Sam"');
      const categories = repos.categories.list();
      const category =
        parsed.category === undefined
          ? categories.length === 1
            ? categories[0]
            : undefined
          : (repos.categories.getByKey(parsed.category) ??
            repos.categories.getById(parsed.category));
      if (!category)
        throw new Error(
          categories.length === 0
            ? 'No category exists. Create one in the web setup first.'
            : 'Capture needs --category <key> when more than one category exists.',
        );
      return repos.items.create({ categoryId: category.id, title, container: 'inbox' });
    }
    case 'show': {
      const item = repos.items.getById(requireArg(parsed, 0, 'item id'));
      if (!item) throw new Error(`No item with id "${parsed.args[0]}"`);
      return item;
    }
    case 'list': {
      const container = parsed.container ?? parsed.args[0] ?? 'inbox';
      if (!isContainer(container)) {
        throw new Error(
          `Unknown container "${container}". One of: inbox, next_action, calendar, waiting, someday, reference, done, trash`,
        );
      }

      /*
       * Filtered by the query engine, not by fetching rows and filtering them here.
       *
       * The earlier version fetched the first 500 items and dropped the ones in other
       * containers in JavaScript, which is wrong in a way that never announces itself:
       * with more than 500 items it silently reports fewer items than exist, with no
       * indication that anything is missing. A command meant for scripts cannot do
       * that.
       */
      const filter: FilterNode = {
        kind: 'condition',
        field: 'container',
        operator: 'equals',
        value: container,
      };

      const result = repos.items.query({
        resolver,
        filter,
        sort: [{ field: 'createdAt', direction: 'desc' }],
        limit: parsed.limit,
      });

      return { total: result.total, items: result.items };
    }
    case 'move': {
      const id = requireArg(parsed, 0, 'item id');
      const target = requireArg(parsed, 1, 'destination container');
      if (!isContainer(target)) throw new Error(`Unknown container "${target}"`);
      return repos.items.setContainer(id, target);
    }
    case 'complete':
      return repos.items.complete(requireArg(parsed, 0, 'item id'));
    case 'reopen':
      return repos.items.reopen(requireArg(parsed, 0, 'item id'));
    case 'trash':
      return repos.items.trash(requireArg(parsed, 0, 'item id'));
    case 'restore':
      return repos.items.restore(requireArg(parsed, 0, 'item id'));
    case 'reset': {
      /*
       * The same confirmation phrase the web application requires. A CLI that wipes
       * everything without one would be a way to destroy a week of data by mistyping a
       * command, and the two entry points should not disagree about what is safe.
       */
      if (parsed.confirm !== WIPE_CONFIRMATION) {
        throw new Error(`reset needs --confirm "${WIPE_CONFIRMATION}"`);
      }
      const report = wipeAllData(db);
      return { wiped: report.totalRemoved, tables: report.tables };
    }
    default:
      throw new Error(`Unknown command "${parsed.command}". Try "gtd help".`);
  }
}

function requireArg(parsed: ParsedArgs, index: number, label: string): string {
  const value = parsed.args[index];
  if (!value) throw new Error(`${parsed.command} needs ${label}`);
  return value;
}

/**
 * Parses the arguments.
 *
 * Flags are removed as they are read rather than by index arithmetic. The earlier
 * version spliced two entries wherever it found `--category`, so a flag with no value —
 * `gtd capture --category` — silently consumed the following argument, turning a typo
 * into a different command. Consuming only when a value actually follows it means the
 * missing value becomes the error it is.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let json = false;
  let limit = DEFAULT_LIMIT;
  let category: string | undefined;
  let container: string | undefined;
  let confirm: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--category' || arg === '--container' || arg === '--confirm' || arg === '--limit') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      if (arg === '--category') category = value;
      else if (arg === '--container') container = value;
      else if (arg === '--confirm') confirm = value;
      else {
        const parsedLimit = Number(value);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
          throw new Error('--limit needs a positive whole number');
        }
        // Capped rather than honoured: this is an interactive command, and the honest
        // response to "give me everything" is a limit and a message, not a page of
        // output that scrolls away.
        limit = Math.min(parsedLimit, MAX_LIMIT);
      }
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option "${arg}"`);
    }

    positional.push(arg);
  }

  return {
    command: positional[0] ?? 'help',
    args: positional.slice(1),
    json,
    limit,
    ...(category === undefined ? {} : { category }),
    ...(container === undefined ? {} : { container }),
    ...(confirm === undefined ? {} : { confirm }),
  };
}

/**
 * Human-readable output.
 *
 * One line per row, tab separated, so `gtd list | cut -f2` works. An item is printed
 * with its title and container rather than its id alone: a `show` command that prints
 * an id is a command that saves the caller nothing.
 */
function write(stream: { write(value: string): void }, value: unknown, json: boolean): void {
  if (json) {
    stream.write(`${JSON.stringify(value)}\n`);
    return;
  }

  if (isListResult(value)) {
    for (const item of value.items) {
      stream.write(`${item.id}\t${item.container}\t${item.title}\n`);
    }
    if (value.items.length === 0) {
      stream.write('(nothing)\n');
    } else if (value.total > value.items.length) {
      // Say so rather than letting the output be read as the whole truth.
      stream.write(`(${value.items.length} of ${value.total} shown; use --limit to see more)\n`);
    }
    return;
  }

  if (isItem(value)) {
    stream.write(`${value.id}\t${value.container}\t${value.title}\n`);
    return;
  }

  if (typeof value === 'object' && value !== null) {
    stream.write(`${JSON.stringify(value)}\n`);
    return;
  }

  stream.write(`${String(value)}\n`);
}

interface CliItem {
  id: string;
  title: string;
  container: string;
}

function isItem(value: unknown): value is CliItem {
  return typeof value === 'object' && value !== null && 'title' in value && 'container' in value;
}

function isListResult(value: unknown): value is { items: CliItem[]; total: number } {
  return typeof value === 'object' && value !== null && 'items' in value && 'total' in value;
}

function helpText(): string {
  return `GTD headless CLI\n\nUsage:\n  gtd capture <text> [--category <key>] [--json]\n  gtd list [container] [--json]\n  gtd show <id> [--json]\n  gtd move <id> <container> [--json]\n  gtd complete|reopen|trash|restore <id> [--json]\n  gtd reset --confirm "${WIPE_CONFIRMATION}"\n\nFlags: --json, --limit <n>, --category <key>, --container <name>, --confirm <phrase>\n\nCapture always creates an inbox item; clarification remains a separate decision.\n`;
}

/**
 * Runs only when invoked directly.
 *
 * Compared as URLs rather than by string-building one. The string form breaks as soon
 * as the path contains a space, a percent sign, or a symlink, and it fails *silently*:
 * the process exits zero having done nothing, which looks exactly like success.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
