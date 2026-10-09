/**
 * Schema migrations.
 *
 * Each migration is applied exactly once, in ascending id order, inside a
 * transaction, and recorded in `schema_migrations` with a checksum. Migrations are
 * never edited after release; a mistake is corrected by adding a new one.
 *
 * Notes on the schema:
 *
 * - Tables are STRICT, so SQLite rejects a value of the wrong type rather than
 *   silently coercing it. On a schema where a mis-typed `container` would make an
 *   item invisible to every query, coercion is a corruption vector.
 * - `items.when_at` holds an instant and `items.deadline_on` holds a calendar
 *   day. The asymmetric names are deliberate: a hard commitment is a point in
 *   time, a deadline is a day.
 * - User-defined field values live in `items.data_json`. Hot fields get real
 *   indexed columns instead, and expression indexes over the JSON blob are
 *   created on demand and tracked in `field_indexes`.
 * - Foreign keys are declared and enforced with `PRAGMA foreign_keys = ON`,
 *   which SQLite does not do by default.
 */

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: /* sql */ `
      -- Categories group items and scope their field definitions. Deliberately
      -- empty on first run: the setup wizard creates the user's own.
      CREATE TABLE categories (
        id           TEXT    PRIMARY KEY,
        key          TEXT    NOT NULL UNIQUE,
        name         TEXT    NOT NULL,
        description  TEXT,
        color        TEXT,
        icon         TEXT,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        is_archived  INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      ) STRICT;

      CREATE TABLE people (
        id           TEXT    PRIMARY KEY,
        name         TEXT    NOT NULL,
        email        TEXT,
        notes        TEXT,
        -- NULL means this person is relevant regardless of category.
        category_id  TEXT    REFERENCES categories(id) ON DELETE SET NULL,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      ) STRICT;

      CREATE INDEX idx_people_category ON people(category_id);
      CREATE INDEX idx_people_name ON people(name COLLATE NOCASE);

      -- Contexts group next actions by the situation required to do them:
      -- @Computer, @Errands, @Calls. Allen's primary recommendation for keeping
      -- a next-actions list usable.
      CREATE TABLE contexts (
        id           TEXT    PRIMARY KEY,
        name         TEXT    NOT NULL,
        category_id  TEXT    REFERENCES categories(id) ON DELETE CASCADE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      ) STRICT;

      CREATE INDEX idx_contexts_category ON contexts(category_id);

      -- A project is any outcome needing more than one action. Deliberately
      -- minimal: no sub-projects, no Natural Planning Model. Those are roadmap
      -- items and are built on top of this table later.
      CREATE TABLE projects (
        id            TEXT    PRIMARY KEY,
        name          TEXT    NOT NULL,
        outcome       TEXT,
        category_id   TEXT    REFERENCES categories(id) ON DELETE SET NULL,
        status        TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'someday', 'completed', 'dropped')),
        review_at     TEXT,
        completed_at  TEXT,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      ) STRICT;

      CREATE INDEX idx_projects_status ON projects(status);
      CREATE INDEX idx_projects_category ON projects(category_id);

      CREATE TABLE recurrence_rules (
        id          TEXT    PRIMARY KEY,
        rrule       TEXT    NOT NULL,
        timezone    TEXT    NOT NULL,
        anchor_date TEXT    NOT NULL,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      ) STRICT;

      CREATE TABLE checklist_templates (
        id              TEXT    PRIMARY KEY,
        name            TEXT    NOT NULL,
        items_json      TEXT    NOT NULL,
        -- Field keys this template is offered for. Empty means it is offered
        -- for any checklist field.
        applies_to_json TEXT    NOT NULL DEFAULT '[]',
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      ) STRICT;

      CREATE TABLE dashboards (
        id          TEXT    PRIMARY KEY,
        key         TEXT    NOT NULL UNIQUE,
        name        TEXT    NOT NULL,
        layout_json TEXT    NOT NULL,
        is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      ) STRICT;

      -- The app must be able to answer "which dashboard opens by default", so
      -- exactly one row may carry the flag. Promoting a dashboard to default is
      -- a single transaction: clear the old one, then set the new one.
      CREATE UNIQUE INDEX idx_dashboards_single_default
        ON dashboards(is_default) WHERE is_default = 1;

      CREATE TABLE items (
        id                     TEXT    PRIMARY KEY,
        category_id            TEXT    NOT NULL REFERENCES categories(id),
        title                  TEXT    NOT NULL,
        container              TEXT    NOT NULL CHECK (container IN (
                                 'inbox', 'next_action', 'calendar', 'waiting',
                                 'someday', 'reference', 'done', 'trash')),
        notes                  TEXT,
        -- Instant. A hard commitment that appears on the calendar.
        when_at                TEXT,
        -- Calendar day. A soft deadline. Never drives the calendar.
        deadline_on            TEXT,
        estimate_min           INTEGER CHECK (estimate_min IS NULL OR estimate_min >= 0),
        project_id             TEXT    REFERENCES projects(id) ON DELETE SET NULL,
        waiting_on_person_id   TEXT    REFERENCES people(id) ON DELETE SET NULL,
        follow_up_at           TEXT,
        -- Context ids. Stored as a JSON array of ids.
        contexts_json          TEXT    NOT NULL DEFAULT '[]',
        recurrence_id          TEXT    REFERENCES recurrence_rules(id) ON DELETE SET NULL,
        -- Set on materialised occurrences of a recurring series.
        parent_item_id         TEXT    REFERENCES items(id) ON DELETE CASCADE,
        occurrence_date        TEXT,
        -- User-defined field values, keyed by field definition key.
        data_json              TEXT    NOT NULL DEFAULT '{}',
        sort_order             INTEGER NOT NULL DEFAULT 0,
        created_at             TEXT    NOT NULL,
        updated_at             TEXT    NOT NULL,
        completed_at           TEXT,
        trashed_at             TEXT
      ) STRICT;

      CREATE INDEX idx_items_container ON items(container);
      CREATE INDEX idx_items_category ON items(category_id, container);
      CREATE INDEX idx_items_project ON items(project_id);
      CREATE INDEX idx_items_waiting_on ON items(waiting_on_person_id);
      CREATE INDEX idx_items_parent ON items(parent_item_id);
      CREATE INDEX idx_items_recurrence ON items(recurrence_id);

      -- Partial indexes, because the calendar and archive queries are hot while
      -- the vast majority of rows are open next actions with no date.
      CREATE INDEX idx_items_when_at ON items(when_at) WHERE container = 'calendar';
      CREATE INDEX idx_items_deadline ON items(deadline_on) WHERE deadline_on IS NOT NULL;
      CREATE INDEX idx_items_completed ON items(completed_at DESC) WHERE container = 'done';
      CREATE INDEX idx_items_follow_up ON items(follow_up_at) WHERE container = 'waiting';

      -- Field definitions. category_id NULL means the field applies to every
      -- category. Two partial unique indexes are needed because SQLite treats
      -- NULLs as distinct in unique indexes, so a single composite index would
      -- not prevent two global fields sharing a key.
      CREATE TABLE field_defs (
        id                 TEXT    PRIMARY KEY,
        category_id        TEXT    REFERENCES categories(id) ON DELETE CASCADE,
        key                TEXT    NOT NULL,
        label              TEXT    NOT NULL,
        description        TEXT,
        type               TEXT    NOT NULL,
        options_json       TEXT    NOT NULL DEFAULT '{"kind":"none"}',
        required           INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
        default_value_json TEXT    NOT NULL DEFAULT 'null',
        group_label        TEXT,
        show_in_table      INTEGER NOT NULL DEFAULT 0 CHECK (show_in_table IN (0, 1)),
        show_in_card       INTEGER NOT NULL DEFAULT 0 CHECK (show_in_card IN (0, 1)),
        filterable         INTEGER NOT NULL DEFAULT 0 CHECK (filterable IN (0, 1)),
        sortable           INTEGER NOT NULL DEFAULT 0 CHECK (sortable IN (0, 1)),
        -- True when values are projected onto first-class columns or indexed
        -- expressions rather than left in data_json.
        is_core            INTEGER NOT NULL DEFAULT 0 CHECK (is_core IN (0, 1)),
        sort_order         INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT    NOT NULL,
        updated_at         TEXT    NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX idx_field_defs_global_key
        ON field_defs(key) WHERE category_id IS NULL;
      CREATE UNIQUE INDEX idx_field_defs_category_key
        ON field_defs(key, category_id) WHERE category_id IS NOT NULL;
      CREATE INDEX idx_field_defs_category ON field_defs(category_id, sort_order);

      -- Append-only history. Powers the completed archive, undo, and every
      -- time-series chart on the dashboard.
      CREATE TABLE activity_log (
        id        TEXT    PRIMARY KEY,
        item_id   TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        verb      TEXT    NOT NULL,
        at        TEXT    NOT NULL,
        from_json TEXT,
        to_json   TEXT
      ) STRICT;

      CREATE INDEX idx_activity_item ON activity_log(item_id, at DESC);
      CREATE INDEX idx_activity_at ON activity_log(at DESC);
      CREATE INDEX idx_activity_verb ON activity_log(verb, at DESC);

      CREATE TABLE settings (
        key         TEXT PRIMARY KEY,
        value_json  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    id: 2,
    name: 'field_index_registry',
    sql: /* sql */ `
      -- Tracks expression indexes created over items.data_json.
      --
      -- A user can mark any field filterable or sortable at any time. Rather
      -- than only supporting indexes over first-class columns, an index is
      -- created on json_extract(data_json, '$.<key>') on demand. The registry
      -- lets the index be dropped again if the field is un-marked, and lets
      -- startup detect an index that is missing from the live schema.
      CREATE TABLE field_indexes (
        field_def_id  TEXT    PRIMARY KEY REFERENCES field_defs(id) ON DELETE CASCADE,
        index_name    TEXT    NOT NULL,
        expression    TEXT    NOT NULL,
        created_at    TEXT    NOT NULL
      ) STRICT;
    `,
  },
  {
    id: 3,
    name: 'recurring_series',
    sql: /* sql */ `
      -- A recurring item is stored twice over: the parent row is the series
      -- definition, and each occurrence is its own row so it can be completed,
      -- deferred or annotated independently.
      --
      -- is_template marks the parent. Without it the parent would appear in every
      -- list alongside its own occurrences, which is both confusing and double
      -- counted in the analytics.
      ALTER TABLE items ADD COLUMN is_template
        INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0, 1));

      -- Partial, because template rows are a tiny minority and the overwhelmingly
      -- common query is "give me everything that is not a template".
      CREATE INDEX idx_items_not_template ON items(container) WHERE is_template = 0;

      -- The invariant that stops the same occurrence being created twice. Without
      -- it, two concurrent materialisations both see the date as missing and
      -- produce duplicate tasks. SQLite treats NULLs as distinct in unique
      -- indexes, so the WHERE clause is what confines this to occurrences.
      CREATE UNIQUE INDEX idx_items_occurrence
        ON items(parent_item_id, occurrence_date) WHERE parent_item_id IS NOT NULL;
    `,
  },
];

export const LATEST_MIGRATION_ID = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.id),
  0,
);
