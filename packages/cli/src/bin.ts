#!/usr/bin/env node

/** Headless entry point. Calls the same repositories as the API, not HTTP. */
import { createItemFieldResolver, isContainer } from '@gtd/core';
import { bootstrap, createRepositories } from '@gtd/db';

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
}

export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const parsed = parseArgs(argv);
  if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    stdout.write(helpText());
    return 0;
  }
  let db: ReturnType<typeof bootstrap>['db'] | undefined;
  try {
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
    const output = execute(parsed, repos, resolver);
    write(stdout, output, parsed.json);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.json) write(stdout, { error: message }, true);
    else stderr.write(`gtd: ${message}\n`);
    return 1;
  } finally {
    db?.close();
  }
}

function execute(
  parsed: ParsedArgs,
  repos: ReturnType<typeof createRepositories>,
  resolver: ReturnType<typeof createItemFieldResolver>,
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
      if (!isContainer(container)) throw new Error(`Unknown container "${container}"`);
      return repos.items
        .query({
          resolver,
          filter: null,
          sort: [{ field: 'createdAt', direction: 'desc' }],
          limit: 500,
        })
        .items.filter((item) => item.container === container);
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
    default:
      throw new Error(`Unknown command "${parsed.command}". Try "gtd help".`);
  }
}

function requireArg(parsed: ParsedArgs, index: number, label: string): string {
  const value = parsed.args[index];
  if (!value) throw new Error(`${parsed.command} needs ${label}`);
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const json = args.includes('--json');
  const categoryIndex = args.indexOf('--category');
  const category = categoryIndex >= 0 ? args[categoryIndex + 1] : undefined;
  if (categoryIndex >= 0) args.splice(categoryIndex, 2);
  const containerIndex = args.indexOf('--container');
  const container = containerIndex >= 0 ? args[containerIndex + 1] : undefined;
  if (containerIndex >= 0) args.splice(containerIndex, 2);
  const plain = args.filter((arg) => arg !== '--json');
  return {
    command: plain[0] ?? 'help',
    args: plain.slice(1),
    json,
    ...(category ? { category } : {}),
    ...(container ? { container } : {}),
  };
}

function write(stream: { write(value: string): void }, value: unknown, json: boolean): void {
  if (json) {
    stream.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) stream.write(`${item.id}\t${item.title}\t${item.container}\n`);
    return;
  }
  if (typeof value === 'object' && value !== null && 'id' in value)
    stream.write(`${(value as { id: string }).id}\n`);
  else stream.write(`${JSON.stringify(value)}\n`);
}

function helpText(): string {
  return `GTD headless CLI\n\nUsage:\n  gtd capture <text> [--category <key>] [--json]\n  gtd list [container] [--json]\n  gtd show <id> [--json]\n  gtd move <id> <container> [--json]\n  gtd complete|reopen|trash|restore <id> [--json]\n\nCapture always creates an inbox item; clarification remains a separate decision.\n`;
}

if (import.meta.url === `file://${process.argv[1]}`)
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
