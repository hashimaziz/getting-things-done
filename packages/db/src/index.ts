export {
  MigrationDriftError,
  bootstrap,
  describePaths,
  type Bootstrapped,
  type BootstrapOptions,
} from './bootstrap.js';
export {
  DatabaseSync,
  openDb,
  openMemoryDb,
  silenceSqliteExperimentalWarning,
  type Db,
  type OpenDbOptions,
  type RunResult,
  type SqlRow,
  type SqlValue,
} from './driver.js';
export {
  ConstraintViolationError,
  DuplicateKeyError,
  InvalidReferenceError,
  SQLITE_CONSTRAINT,
  constraintKind,
  sqliteErrcode,
  translating,
  type ConstraintKind,
  type WriteContext,
} from './errors.js';
export {
  createFieldIndex,
  dropFieldIndex,
  expressionFor,
  indexNameFor,
  needsIndex,
  reconcileFieldIndexes,
  type ReconcileReport,
} from './field-indexes.js';
export { fromBool, nullIfUndefined, readJson, toBool, writeJson } from './json.js';
export {
  assertMigrationIdsAreSane,
  checksumOf,
  currentVersion,
  hasTable,
  migrate,
  type AppliedMigration,
  type MigrationReport,
} from './migrate.js';
export { ensureDataDir, resolvePaths, type ResolveOptions, type ResolvedPaths } from './paths.js';
export {
  DEFAULT_HORIZON_DAYS,
  MAX_OCCURRENCES_PER_RUN,
  createRecurrenceService,
  type AttachSeriesInput,
  type CompleteOccurrenceResult,
  type MaterializeOptions,
  type MaterializeResult,
  type RecurrenceService,
  type RecurrenceServiceOptions,
} from './recurrence-service.js';
export * from './repositories/index.js';
export * from './wipe.js';
export { LATEST_MIGRATION_ID, MIGRATIONS, type Migration } from './schema/migrations.js';
