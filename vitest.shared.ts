import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vitest/config';

/** This file sits at the repository root, so its directory *is* the root. */
const repoRoot = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(repoRoot, 'packages');

/**
 * Points every `@gtd/*` import at that package's source rather than its build.
 *
 * Without this, a test in one package silently exercises whichever `dist`
 * happened to be on disk, which is how a bug already fixed in source gets chased
 * twice. That happened for real: a stale `db/dist` produced a baffling
 * `NOT NULL constraint failed: items.is_template` while `src` was already
 * correct.
 *
 * Aliasing to source removes the whole class of problem, and is faster too, since
 * nothing needs rebuilding before a test run. Compiling the real build output is
 * still verified by `pnpm run build`, which the `check` gate runs.
 *
 * The entry point is read from each package's own manifest rather than assumed to
 * be `src/index.ts`, because `cli` and `server` do not have one. Because `tsc`
 * mirrors `src` into `dist`, rewriting the path is a matter of swapping those two
 * segments. Discovered from the filesystem, so adding a package needs no change
 * here.
 */
function workspaceSourceAliases(): Record<string, string> {
  if (!existsSync(packagesDir)) {
    return {};
  }

  const aliases: Record<string, string> = {};

  for (const name of readdirSync(packagesDir)) {
    const packageDir = join(packagesDir, name);
    const manifestPath = join(packageDir, 'package.json');
    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      main?: string;
      exports?: string | Record<string, unknown>;
    };

    const entry = declaredEntryPoint(manifest);
    if (entry === null) {
      // A package with no library entry point, such as the web app, is not
      // importable by others and needs no alias.
      continue;
    }

    const source = join(packageDir, entry.replace(/^.*\/dist\//, 'src/').replace(/\.js$/, '.ts'));
    if (existsSync(source)) {
      aliases[`@gtd/${name}`] = source;
    }
  }

  return aliases;
}

/** The package's library entry point, as declared in its manifest. */
function declaredEntryPoint(manifest: {
  main?: string;
  exports?: string | Record<string, unknown>;
}): string | null {
  if (typeof manifest.exports === 'string') {
    return manifest.exports;
  }
  if (manifest.exports && typeof manifest.exports === 'object') {
    for (const entry of Object.values(manifest.exports)) {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        const nested = (entry as { default?: unknown }).default;
        if (typeof nested === 'string') {
          return nested;
        }
      }
    }
  }
  return manifest.main ?? null;
}

export const workspaceAliases = workspaceSourceAliases();

/** Shared node-environment test configuration for the non-browser packages. */
export function nodeTestConfig(): UserConfig {
  return defineConfig({
    resolve: {
      alias: workspaceAliases,
    },
    test: {
      environment: 'node',
      globals: false,
      passWithNoTests: true,
      include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    },
  });
}
