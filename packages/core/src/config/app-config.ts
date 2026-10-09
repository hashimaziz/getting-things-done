/**
 * Single source of truth for static application identity and fixed defaults.
 *
 * Nothing in this repository may hardcode the product name, the CLI binary name,
 * the data directory name, or the ports. Everything imports from here instead, so
 * rebranding the app or moving its defaults is a one-file edit.
 *
 * Only genuinely immutable values belong here. Anything a user should be able to
 * change at runtime (timezone, theme, shortcuts, categories, field definitions)
 * belongs in the database via the settings table.
 */

export interface AppIdentity {
  /** Full product name. Used in page titles and the settings header. */
  readonly name: string;
  /** Compact name for dense UI: sidebar header, window titles, favicon label. */
  readonly shortName: string;
  /** One-line positioning statement shown on the dashboard header and empty states. */
  readonly tagline: string;
  /** Longer prose used by the document meta description and CLI help output. */
  readonly description: string;
  /** Name of the installed CLI binary. Must be a valid npm bin name. */
  readonly cliName: string;
}

export interface AppPaths {
  /** Directory name created under the user's home directory. Must not contain separators. */
  readonly dataDirName: string;
  /** File name of the SQLite database inside the data directory. */
  readonly databaseFileName: string;
  /** Environment variable that overrides the data directory location. */
  readonly dataDirEnvVar: string;
  /** URL path the web client prefixes all API requests with. */
  readonly apiBasePath: string;
}

export interface AppDefaults {
  /** Port the Fastify API binds to. Loopback only by default. */
  readonly apiPort: number;
  /** Interface the API binds to. Kept on loopback: this app is single-user and local. */
  readonly apiHost: string;
  /** Port the Vite dev server binds to. */
  readonly webPort: number;
  /** Timezone used when the runtime cannot report one. */
  readonly fallbackTimezone: string;
}

export interface AppConfig {
  readonly identity: AppIdentity;
  readonly paths: AppPaths;
  readonly defaults: AppDefaults;
}

export const APP_CONFIG: AppConfig = {
  identity: {
    name: 'GTD',
    shortName: 'GTD',
    tagline: 'Stress-free productivity: capture, clarify, organize, reflect, engage.',
    description:
      'A digital implementation of the Getting Things Done methodology, with a configurable dashboard over a single local SQLite database.',
    cliName: 'gtd',
  },
  paths: {
    dataDirName: '.gtd',
    databaseFileName: 'gtd.sqlite',
    dataDirEnvVar: 'GTD_HOME',
    apiBasePath: '/api',
  },
  defaults: {
    apiPort: 4319,
    apiHost: '127.0.0.1',
    webPort: 5173,
    fallbackTimezone: 'UTC',
  },
} as const;

/** Convenience accessor for the product name. Prefer this over `APP_CONFIG.identity.name` at call sites. */
export function appName(): string {
  return APP_CONFIG.identity.name;
}

/**
 * Builds a document title for a given page.
 *
 * Passing an empty page yields the bare product name, which is what a tab with
 * no specific view open should show.
 */
export function formatDocumentTitle(page?: string): string {
  const trimmed = page?.trim();
  return trimmed ? `${trimmed} — ${APP_CONFIG.identity.name}` : APP_CONFIG.identity.name;
}

/** Best-effort detection of the host IANA timezone, falling back to the configured default. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || APP_CONFIG.defaults.fallbackTimezone;
  } catch {
    return APP_CONFIG.defaults.fallbackTimezone;
  }
}
