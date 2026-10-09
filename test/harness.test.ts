import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceAliases } from '../vitest.shared.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * These guard the test harness itself.
 *
 * The alias that points `@gtd/*` at source is load-bearing: without it a test in
 * one package silently runs against whichever `dist` happens to be on disk, and
 * you chase a bug that was already fixed in source. That is not hypothetical, it
 * cost an afternoon. If someone removes the alias, these fail loudly instead.
 */

describe('workspace source aliases', () => {
  it('maps every importable package to its source entry point', () => {
    // The web app has no library entry point, so it is deliberately absent.
    expect(Object.keys(workspaceAliases).sort()).toEqual([
      '@gtd/cli',
      '@gtd/core',
      '@gtd/db',
      '@gtd/server',
    ]);
  });

  it('points at a real file for each alias', () => {
    for (const [name, target] of Object.entries(workspaceAliases)) {
      expect(existsSync(target), `${name} -> ${target}`).toBe(true);
      expect(target).toContain(join('src'));
    }
  });

  it('never points at a build directory', () => {
    for (const target of Object.values(workspaceAliases)) {
      expect(target).not.toContain(`${join('packages', 'dist')}`);
      expect(target).not.toMatch(/[/\\]dist[/\\]/);
    }
  });
});

describe('package layout', () => {
  it('gives every workspace package a src and a package.json', () => {
    for (const name of Object.keys(workspaceAliases)) {
      const shortName = name.replace('@gtd/', '');
      const dir = join(repoRoot, 'packages', shortName);
      expect(existsSync(join(dir, 'package.json')), `${shortName} package.json`).toBe(true);
      expect(existsSync(join(dir, 'src')), `${shortName} src`).toBe(true);
    }
  });

  it('gives every importable package a build script', () => {
    for (const name of Object.keys(workspaceAliases)) {
      const shortName = name.replace('@gtd/', '');
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, 'packages', shortName, 'package.json'), 'utf8'),
      ) as { scripts?: Record<string, string> };

      // The web app is bundled by Vite rather than compiled by tsc, so it is the
      // one package with no `build` script. Everything else must be compilable,
      // since the typecheck gate builds it before checking.
      if (shortName === 'web') {
        expect(manifest.scripts?.build).toBeTruthy();
        continue;
      }
      expect(manifest.scripts?.build, `${shortName} build script`).toBeTruthy();
    }
  });
});

describe('root scripts', () => {
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('has a check gate that builds before testing', () => {
    // The gate must compile the build output as well as the source, since that is
    // what ships. The test run itself no longer needs a build thanks to the alias.
    expect(root.scripts.check).toContain('typecheck');
    expect(root.scripts.check).toContain('test');
    expect(root.scripts.typecheck).toContain('build:packages');
  });

  it('does not require a build before tests', () => {
    // If this ever goes back to building first, the alias is doing nothing.
    expect(root.scripts.test).not.toContain('build');
  });
});
