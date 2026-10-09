import { describe, expect, it } from 'vitest';
import {
  APP_CONFIG,
  appName,
  assertValidAppConfig,
  detectTimezone,
  formatDocumentTitle,
  type AppConfig,
} from '../src/config/index.js';

/** Recursively strips `readonly` so tests can deliberately build invalid configs. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
type MutableConfig = Mutable<AppConfig>;

/** Structured clone so each test can mutate one field without leaking into others. */
function cloneConfig(): MutableConfig {
  return structuredClone(APP_CONFIG) as MutableConfig;
}

/** Collects validation problems as a single readable string for assertions. */
function problemsFor(config: AppConfig): string {
  try {
    assertValidAppConfig(config);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('APP_CONFIG', () => {
  it('passes its own validation on module load', () => {
    expect(() => assertValidAppConfig()).not.toThrow();
  });

  it('exposes a non-empty identity', () => {
    expect(APP_CONFIG.identity.name).toBeTruthy();
    expect(APP_CONFIG.identity.shortName).toBeTruthy();
    expect(APP_CONFIG.identity.tagline).toBeTruthy();
    expect(APP_CONFIG.identity.description).toBeTruthy();
  });

  it('uses distinct api and web ports', () => {
    expect(APP_CONFIG.defaults.apiPort).not.toBe(APP_CONFIG.defaults.webPort);
  });
});

describe('appName', () => {
  it('returns the configured name', () => {
    expect(appName()).toBe(APP_CONFIG.identity.name);
  });
});

describe('formatDocumentTitle', () => {
  it('returns the bare product name when no page is given', () => {
    expect(formatDocumentTitle()).toBe(APP_CONFIG.identity.name);
  });

  it('suffixes the product name after the page', () => {
    expect(formatDocumentTitle('Inbox')).toBe(`Inbox — ${APP_CONFIG.identity.name}`);
  });

  it('trims surrounding whitespace from the page', () => {
    expect(formatDocumentTitle('  Weekly Review  ')).toBe(
      `Weekly Review — ${APP_CONFIG.identity.name}`,
    );
  });

  it('treats a whitespace-only page as no page', () => {
    expect(formatDocumentTitle('   ')).toBe(APP_CONFIG.identity.name);
  });
});

describe('detectTimezone', () => {
  it('returns a non-empty IANA zone name', () => {
    const zone = detectTimezone();
    expect(zone).toBeTruthy();
    expect(() => new Intl.DateTimeFormat(undefined, { timeZone: zone })).not.toThrow();
  });
});

describe('assertValidAppConfig', () => {
  it('rejects an empty product name', () => {
    const config = cloneConfig();
    config.identity.name = '  ';
    expect(problemsFor(config)).toContain('identity.name must not be empty');
  });

  it('rejects an over-long short name that would break dense UI', () => {
    const config = cloneConfig();
    config.identity.shortName = 'a'.repeat(13);
    expect(problemsFor(config)).toContain('identity.shortName must be 12 characters or fewer');
  });

  it('rejects a CLI name that is not a valid binary name', () => {
    const config = cloneConfig();
    config.identity.cliName = 'My Cool CLI';
    expect(problemsFor(config)).toContain('is not a valid binary name');
  });

  it('rejects a data directory name containing a path separator', () => {
    const config = cloneConfig();
    config.paths.dataDirName = '../escape';
    expect(problemsFor(config)).toContain('must not contain path separators');
  });

  it('rejects a database file name containing a path separator', () => {
    const config = cloneConfig();
    config.paths.databaseFileName = 'sub/gtd.sqlite';
    expect(problemsFor(config)).toContain('must not contain path separators');
  });

  it('rejects an env var name that is not SCREAMING_SNAKE_CASE', () => {
    const config = cloneConfig();
    config.paths.dataDirEnvVar = 'gtdHome';
    expect(problemsFor(config)).toContain('must be SCREAMING_SNAKE_CASE');
  });

  it('rejects an API base path without a leading slash', () => {
    const config = cloneConfig();
    config.paths.apiBasePath = 'api';
    expect(problemsFor(config)).toContain('paths.apiBasePath must start with a forward slash');
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 80.5],
    ['too large', 70_000],
  ])('rejects a %s port', (_label, port) => {
    const config = cloneConfig();
    config.defaults.apiPort = port;
    expect(problemsFor(config)).toContain(
      'defaults.apiPort must be an integer between 1 and 65535',
    );
  });

  it('rejects colliding api and web ports', () => {
    const config = cloneConfig();
    config.defaults.webPort = config.defaults.apiPort;
    expect(problemsFor(config)).toContain('must differ');
  });

  it('rejects an invalid fallback timezone', () => {
    const config = cloneConfig();
    config.defaults.fallbackTimezone = 'Mars/Olympus_Mons';
    expect(problemsFor(config)).toContain('is not a valid IANA zone');
  });

  it('reports every problem at once rather than only the first', () => {
    const config = cloneConfig();
    config.identity.name = '';
    config.identity.cliName = 'bad name';
    config.paths.apiBasePath = 'api';
    const problems = problemsFor(config);
    expect(problems).toContain('identity.name must not be empty');
    expect(problems).toContain('is not a valid binary name');
    expect(problems).toContain('paths.apiBasePath must start with a forward slash');
  });
});
