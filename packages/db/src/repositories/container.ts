/**
 * The repository container.
 *
 * One object holding every repository, constructed once from a `Db`. Routes and
 * the CLI take the container rather than assembling repositories individually, so
 * a new repository cannot be accidentally constructed against a different
 * database in the same process.
 */

import type { Db } from '../driver.js';
import { createActivityRepo, type ActivityRepo } from './activity.js';
import { createArchiveRepo, type ArchiveRepo } from './archive.js';
import { createCategoriesRepo, type CategoriesRepo } from './categories.js';
import {
  createChecklistTemplatesRepo,
  createContextsRepo,
  createPeopleRepo,
  createRecurrenceRulesRepo,
  type ChecklistTemplatesRepo,
  type ContextsRepo,
  type PeopleRepo,
  type RecurrenceRulesRepo,
} from './reference-data.js';
import { createFieldDefsRepo, type FieldDefsRepo } from './field-defs.js';
import { createItemsRepo, type ItemsRepo } from './items.js';
import { createProjectsRepo, type ProjectsRepo } from './projects.js';
import { createSettingsRepo, type SettingsRepo } from './settings.js';

export interface Repositories {
  activity: ActivityRepo;
  archive: ArchiveRepo;
  categories: CategoriesRepo;
  fieldDefs: FieldDefsRepo;
  items: ItemsRepo;
  projects: ProjectsRepo;
  contexts: ContextsRepo;
  people: PeopleRepo;
  recurrenceRules: RecurrenceRulesRepo;
  checklistTemplates: ChecklistTemplatesRepo;
  settings: SettingsRepo;
}

export interface CreateRepositoriesOptions {
  /** Forwarded to the items repo, e.g. a warning sink in tests. */
  items?: Parameters<typeof createItemsRepo>[1];
}

export function createRepositories(db: Db, options: CreateRepositoriesOptions = {}): Repositories {
  return {
    activity: createActivityRepo(db),
    archive: createArchiveRepo(db),
    categories: createCategoriesRepo(db),
    fieldDefs: createFieldDefsRepo(db),
    items: createItemsRepo(db, options.items),
    projects: createProjectsRepo(db),
    contexts: createContextsRepo(db),
    people: createPeopleRepo(db),
    recurrenceRules: createRecurrenceRulesRepo(db),
    checklistTemplates: createChecklistTemplatesRepo(db),
    settings: createSettingsRepo(db),
  };
}
