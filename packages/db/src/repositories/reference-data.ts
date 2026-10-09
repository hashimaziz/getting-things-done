/**
 * Small reference-data repositories: people, contexts, recurrence rules and
 * checklist templates. They share a shape, so they are implemented together.
 */

import {
  newId,
  nowIso,
  type ChecklistTemplate,
  type ChecklistTemplateEntry,
  type Context,
  type CreateChecklistTemplateInput,
  type CreateContextInput,
  type CreatePersonInput,
  type CreateRecurrenceRuleInput,
  type IsoDate,
  type IsoDateTime,
  type Person,
  type RecurrenceRule,
  type UpdateChecklistTemplatePatch,
  type UpdateContextPatch,
  type UpdatePersonPatch,
  type UpdateRecurrenceRulePatch,
} from '@gtd/core';
import type { Db } from '../driver.js';
import { readJson, writeJson } from '../json.js';

/* --------------------------------------------------------------------- people */

interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  notes: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

const PERSON_COLUMNS = 'id, name, email, notes, category_id, created_at, updated_at';

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    notes: row.notes,
    categoryId: row.category_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PeopleRepo {
  list(): Person[];
  getById(id: string): Person | null;
  /** Case-insensitive substring match, for the person picker. */
  search(term: string): Person[];
  create(input: CreatePersonInput): Person;
  update(id: string, patch: UpdatePersonPatch): Person;
  remove(id: string): void;
}

export function createPeopleRepo(db: Db): PeopleRepo {
  const repo: PeopleRepo = {
    list(): Person[] {
      return db
        .all<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM people ORDER BY name COLLATE NOCASE`)
        .map(toPerson);
    },

    getById(id: string): Person | null {
      const row = db.get<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ?`, id);
      return row ? toPerson(row) : null;
    },

    search(term: string): Person[] {
      // Escaped because LIKE treats _ and % as wildcards. A search for "a_b"
      // should not match "axb".
      const escaped = term.replace(/([\\%_])/g, '\\$1');
      return db
        .all<PersonRow>(
          `SELECT ${PERSON_COLUMNS} FROM people
           WHERE name LIKE ? ESCAPE '\\' OR (email IS NOT NULL AND email LIKE ? ESCAPE '\\')
           ORDER BY name COLLATE NOCASE LIMIT 50`,
          `%${escaped}%`,
          `%${escaped}%`,
        )
        .map(toPerson);
    },

    create(input: CreatePersonInput): Person {
      const id = newId();
      const timestamp = nowIso();
      db.run(
        `INSERT INTO people (${PERSON_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.name.trim(),
        input.email ?? null,
        input.notes ?? null,
        input.categoryId ?? null,
        timestamp,
        timestamp,
      );
      const created = repo.getById(id);
      if (!created) {
        throw new Error('Person insert reported success but the row could not be read back');
      }
      return created;
    },

    update(id: string, patch: UpdatePersonPatch): Person {
      const assignments: string[] = [];
      const params: Array<string | number | null> = [];
      const set = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) return;
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('name', patch.name?.trim());
      set('email', patch.email);
      set('notes', patch.notes);
      set('category_id', patch.categoryId);

      if (assignments.length > 0) {
        assignments.push('updated_at = ?');
        params.push(nowIso(), id);
        db.run(`UPDATE people SET ${assignments.join(', ')} WHERE id = ?`, ...params);
      }

      const updated = repo.getById(id);
      if (!updated) {
        throw new PersonNotFoundError(id);
      }
      return updated;
    },

    remove(id: string): void {
      db.run('DELETE FROM people WHERE id = ?', id);
    },
  };

  return repo;
}

export class PersonNotFoundError extends Error {
  constructor(personId: string) {
    super(`No person with id "${personId}"`);
    this.name = 'PersonNotFoundError';
  }
}

/* ------------------------------------------------------------------- contexts */

interface ContextRow {
  id: string;
  name: string;
  category_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const CONTEXT_COLUMNS = 'id, name, category_id, sort_order, created_at, updated_at';

function toContext(row: ContextRow): Context {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ContextsRepo {
  list(categoryId?: string | null): Context[];
  getById(id: string): Context | null;
  create(input: CreateContextInput): Context;
  update(id: string, patch: UpdateContextPatch): Context;
  remove(id: string): void;
}

export function createContextsRepo(db: Db): ContextsRepo {
  const repo: ContextsRepo = {
    list(categoryId?: string | null): Context[] {
      const sql =
        categoryId === undefined
          ? `SELECT ${CONTEXT_COLUMNS} FROM contexts ORDER BY sort_order, name COLLATE NOCASE`
          : `SELECT ${CONTEXT_COLUMNS} FROM contexts
             WHERE category_id IS NULL OR category_id = ?
             ORDER BY sort_order, name COLLATE NOCASE`;
      const rows =
        categoryId === undefined ? db.all<ContextRow>(sql) : db.all<ContextRow>(sql, categoryId);
      return rows.map(toContext);
    },

    getById(id: string): Context | null {
      const row = db.get<ContextRow>(`SELECT ${CONTEXT_COLUMNS} FROM contexts WHERE id = ?`, id);
      return row ? toContext(row) : null;
    },

    create(input: CreateContextInput): Context {
      const id = newId();
      const timestamp = nowIso();
      db.run(
        `INSERT INTO contexts (${CONTEXT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        input.name.trim(),
        input.categoryId ?? null,
        input.sortOrder ?? 0,
        timestamp,
        timestamp,
      );
      const created = repo.getById(id);
      if (!created) {
        throw new Error('Context insert reported success but the row could not be read back');
      }
      return created;
    },

    update(id: string, patch: UpdateContextPatch): Context {
      const assignments: string[] = [];
      const params: Array<string | number | null> = [];
      const set = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) return;
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('name', patch.name?.trim());
      set('category_id', patch.categoryId);
      set('sort_order', patch.sortOrder);

      if (assignments.length > 0) {
        assignments.push('updated_at = ?');
        params.push(nowIso(), id);
        db.run(`UPDATE contexts SET ${assignments.join(', ')} WHERE id = ?`, ...params);
      }

      const updated = repo.getById(id);
      if (!updated) {
        throw new ContextNotFoundError(id);
      }
      return updated;
    },

    remove(id: string): void {
      db.run('DELETE FROM contexts WHERE id = ?', id);
    },
  };

  return repo;
}

export class ContextNotFoundError extends Error {
  constructor(contextId: string) {
    super(`No context with id "${contextId}"`);
    this.name = 'ContextNotFoundError';
  }
}

/* ------------------------------------------------------------ recurrence rules */

interface RecurrenceRow {
  id: string;
  rrule: string;
  timezone: string;
  anchor_date: string;
  created_at: string;
  updated_at: string;
}

const RECURRENCE_COLUMNS = 'id, rrule, timezone, anchor_date, created_at, updated_at';

function toRecurrence(row: RecurrenceRow): RecurrenceRule {
  return {
    id: row.id,
    rrule: row.rrule,
    timezone: row.timezone,
    anchorDate: row.anchor_date as IsoDate,
    createdAt: row.created_at as IsoDateTime,
    updatedAt: row.updated_at as IsoDateTime,
  };
}

export interface RecurrenceRulesRepo {
  getById(id: string): RecurrenceRule | null;
  create(input: CreateRecurrenceRuleInput): RecurrenceRule;
  update(id: string, patch: UpdateRecurrenceRulePatch): RecurrenceRule;
  remove(id: string): void;
}

export function createRecurrenceRulesRepo(db: Db): RecurrenceRulesRepo {
  const repo: RecurrenceRulesRepo = {
    getById(id: string): RecurrenceRule | null {
      const row = db.get<RecurrenceRow>(
        `SELECT ${RECURRENCE_COLUMNS} FROM recurrence_rules WHERE id = ?`,
        id,
      );
      return row ? toRecurrence(row) : null;
    },

    create(input: CreateRecurrenceRuleInput): RecurrenceRule {
      const id = newId();
      const timestamp = nowIso();
      db.run(
        `INSERT INTO recurrence_rules (${RECURRENCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        input.rrule,
        input.timezone,
        input.anchorDate,
        timestamp,
        timestamp,
      );
      const created = repo.getById(id);
      if (!created) {
        throw new Error(
          'Recurrence rule insert reported success but the row could not be read back',
        );
      }
      return created;
    },

    update(id: string, patch: UpdateRecurrenceRulePatch): RecurrenceRule {
      const assignments: string[] = [];
      const params: Array<string | number | null> = [];
      const set = (column: string, value: string | undefined): void => {
        if (value === undefined) return;
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('rrule', patch.rrule);
      set('timezone', patch.timezone);
      set('anchor_date', patch.anchorDate);

      if (assignments.length > 0) {
        assignments.push('updated_at = ?');
        params.push(nowIso(), id);
        db.run(`UPDATE recurrence_rules SET ${assignments.join(', ')} WHERE id = ?`, ...params);
      }

      const updated = repo.getById(id);
      if (!updated) {
        throw new RecurrenceRuleNotFoundError(id);
      }
      return updated;
    },

    remove(id: string): void {
      db.run('DELETE FROM recurrence_rules WHERE id = ?', id);
    },
  };

  return repo;
}

export class RecurrenceRuleNotFoundError extends Error {
  constructor(ruleId: string) {
    super(`No recurrence rule with id "${ruleId}"`);
    this.name = 'RecurrenceRuleNotFoundError';
  }
}

/* -------------------------------------------------------- checklist templates */

interface ChecklistTemplateRow {
  id: string;
  name: string;
  items_json: string;
  applies_to_json: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const CHECKLIST_COLUMNS =
  'id, name, items_json, applies_to_json, sort_order, created_at, updated_at';

function toChecklistTemplate(row: ChecklistTemplateRow): ChecklistTemplate {
  return {
    id: row.id,
    name: row.name,
    entries: readJson<ChecklistTemplateEntry[]>(row.items_json, []),
    appliesTo: readJson<string[]>(row.applies_to_json, []),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ChecklistTemplatesRepo {
  list(): ChecklistTemplate[];
  getById(id: string): ChecklistTemplate | null;
  create(input: CreateChecklistTemplateInput): ChecklistTemplate;
  update(id: string, patch: UpdateChecklistTemplatePatch): ChecklistTemplate;
  remove(id: string): void;
}

export function createChecklistTemplatesRepo(db: Db): ChecklistTemplatesRepo {
  const repo: ChecklistTemplatesRepo = {
    list(): ChecklistTemplate[] {
      return db
        .all<ChecklistTemplateRow>(
          `SELECT ${CHECKLIST_COLUMNS} FROM checklist_templates ORDER BY sort_order, name COLLATE NOCASE`,
        )
        .map(toChecklistTemplate);
    },

    getById(id: string): ChecklistTemplate | null {
      const row = db.get<ChecklistTemplateRow>(
        `SELECT ${CHECKLIST_COLUMNS} FROM checklist_templates WHERE id = ?`,
        id,
      );
      return row ? toChecklistTemplate(row) : null;
    },

    create(input: CreateChecklistTemplateInput): ChecklistTemplate {
      const id = newId();
      const timestamp = nowIso();
      db.run(
        `INSERT INTO checklist_templates (${CHECKLIST_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.name.trim(),
        writeJson(input.entries),
        writeJson(input.appliesTo ?? []),
        input.sortOrder ?? 0,
        timestamp,
        timestamp,
      );
      const created = repo.getById(id);
      if (!created) {
        throw new Error(
          'Checklist template insert reported success but the row could not be read back',
        );
      }
      return created;
    },

    update(id: string, patch: UpdateChecklistTemplatePatch): ChecklistTemplate {
      const assignments: string[] = [];
      const params: Array<string | number | null> = [];
      const set = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) return;
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      set('name', patch.name?.trim());
      set('items_json', patch.entries === undefined ? undefined : writeJson(patch.entries));
      set(
        'applies_to_json',
        patch.appliesTo === undefined ? undefined : writeJson(patch.appliesTo),
      );
      set('sort_order', patch.sortOrder);

      if (assignments.length > 0) {
        assignments.push('updated_at = ?');
        params.push(nowIso(), id);
        db.run(`UPDATE checklist_templates SET ${assignments.join(', ')} WHERE id = ?`, ...params);
      }

      const updated = repo.getById(id);
      if (!updated) {
        throw new ChecklistTemplateNotFoundError(id);
      }
      return updated;
    },

    remove(id: string): void {
      db.run('DELETE FROM checklist_templates WHERE id = ?', id);
    },
  };

  return repo;
}

export class ChecklistTemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`No checklist template with id "${templateId}"`);
    this.name = 'ChecklistTemplateNotFoundError';
  }
}
