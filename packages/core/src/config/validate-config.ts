import { APP_CONFIG, type AppConfig } from './app-config.js';

/** Characters npm permits in a bin name, which is what `cliName` becomes. */
const BIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Characters that must not appear in a directory or file name. */
const UNSAFE_PATH_CHARS = /[/\\:*?"<>|]/;

/**
 * Validates the static app config.
 *
 * This runs on module load so that a malformed edit to `app-config.ts` fails
 * immediately and loudly, rather than surfacing later as a confusing CLI, path or
 * port bug. Each rule below corresponds to a place that trusts the value.
 */
export function assertValidAppConfig(config: AppConfig = APP_CONFIG): void {
  const { identity, paths, defaults } = config;
  const problems: string[] = [];

  if (!identity.name.trim()) problems.push('identity.name must not be empty');
  if (!identity.shortName.trim()) problems.push('identity.shortName must not be empty');
  if (identity.shortName.length > 12) {
    problems.push('identity.shortName must be 12 characters or fewer to fit dense UI');
  }
  if (!BIN_NAME_PATTERN.test(identity.cliName)) {
    problems.push(`identity.cliName "${identity.cliName}" is not a valid binary name`);
  }

  if (UNSAFE_PATH_CHARS.test(paths.dataDirName)) {
    problems.push(`paths.dataDirName "${paths.dataDirName}" must not contain path separators`);
  }
  if (UNSAFE_PATH_CHARS.test(paths.databaseFileName)) {
    problems.push(
      `paths.databaseFileName "${paths.databaseFileName}" must not contain path separators`,
    );
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(paths.dataDirEnvVar)) {
    problems.push(`paths.dataDirEnvVar "${paths.dataDirEnvVar}" must be SCREAMING_SNAKE_CASE`);
  }
  if (!paths.apiBasePath.startsWith('/')) {
    problems.push('paths.apiBasePath must start with a forward slash');
  }

  for (const [key, port] of [
    ['defaults.apiPort', defaults.apiPort],
    ['defaults.webPort', defaults.webPort],
  ] as const) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      problems.push(`${key} must be an integer between 1 and 65535`);
    }
  }
  if (defaults.apiPort === defaults.webPort) {
    problems.push('defaults.apiPort and defaults.webPort must differ');
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: defaults.fallbackTimezone });
  } catch {
    problems.push(
      `defaults.fallbackTimezone "${defaults.fallbackTimezone}" is not a valid IANA zone`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid APP_CONFIG:\n  - ${problems.join('\n  - ')}`);
  }
}

assertValidAppConfig();
