/**
 * Turning a recurring series into actual items.
 *
 * A series is stored twice over: one template row carrying the rule and the fields
 * occurrences inherit, and one row per occurrence so each can be completed,
 * deferred or annotated on its own. This module owns creating those rows.
 *
 * Materialising ahead rather than expanding on read is a deliberate trade. A
 * calendar built from a live expansion cannot be edited, cannot carry a note, and
 * shows a different set of items in two places at once. Occurrences that are real
 * rows behave like real rows.
 *
 * Three consequences are handled here rather than left to callers:
 *
 * - **History is not backfilled.** The window starts at today, not at the anchor
 *   date, so attaching a daily rule to an item does not suddenly produce a month
 *   of overdue tasks the user never intended to create.
 * - **De-duplication is by date.** Existing occurrence dates are read first, and a
 *   unique index on (parent, date) backs it up, so two runs cannot duplicate.
 * - **The template disappears from every list.** It is a series definition, not a
 *   task, and leaving it visible would double-count the series in every count and
 *   chart.
 */

import {
  addDays,
  expandOccurrences,
  nextOccurrenceAfter,
  parseRecurrence,
  type IsoDate,
  type Item,
  type Occurrence,
  type RecurrenceSpec,
} from '@gtd/core';
import type { ItemsRepo } from './repositories/items.js';
import { constraintKind, InvalidReferenceError } from './errors.js';
import type { RecurrenceRulesRepo } from './repositories/reference-data.js';

export const DEFAULT_HORIZON_DAYS = 60;

/**
 * Ceiling on occurrences created in one run.
 *
 * The horizon is the real bound; this is a backstop against a misconfigured rule
 * writing thousands of rows in one request. Hitting it is reported, not hidden.
 */
export const MAX_OCCURRENCES_PER_RUN = 200;

export interface MaterializeOptions {
  /**
   * How many days of occurrences to create, counting today as the first.
   *
   * So a horizon of 1 means today only, and 60 means today plus the next 59 days.
   * Counting today as one of the days is what makes the number mean what someone
   * reading it expects.
   */
  horizonDays?: number;
  /** First day to consider. Defaults to today, which is why history is skipped. */
  from?: IsoDate;
}

export interface MaterializeResult {
  parentId: string;
  created: Item[];
  /** Occurrences in the window that already existed and were left alone. */
  skipped: number;
  /** True when the run stopped at MAX_OCCURRENCES_PER_RUN. */
  truncated: boolean;
}

export interface CompleteOccurrenceResult {
  occurrence: Item;
  /** A fresh occurrence for the next period, if the series continues. */
  next: Item | null;
}

export interface AttachSeriesInput {
  /** A recurrence string. A DTSTART is optional here and supplied if absent. */
  rrule: string;
  timezone?: string;
  anchorDate?: IsoDate;
  timeOfDay?: { hour: number; minute: number } | null;
  until?: IsoDate | null;
  count?: number | null;
  horizonDays?: number;
}

export interface RecurrenceService {
  /**
   * Turns an existing item into a recurring series and creates its first
   * occurrences.
   */
  attachSeries(itemId: string, input: AttachSeriesInput): { item: Item; created: number };
  /** Removes the rule and every occurrence of a series. */
  detachSeries(itemId: string): void;
  /** A series template's rule, parsed and validated. */
  specFor(templateId: string): RecurrenceSpec;
  /** Creates any missing occurrences within the horizon. */
  materialize(templateId: string, options?: MaterializeOptions): MaterializeResult;
  /** Runs materialisation for every series in the database. */
  materializeAll(options?: MaterializeOptions): MaterializeResult[];
  /**
   * Completes an occurrence and ensures the next one exists.
   *
   * Takes no horizon: the next occurrence is materialised individually rather than
   * topping up the whole window, because the point is to guarantee the series does
   * not run out, not to refill a horizon that a later run will handle anyway.
   */
  completeOccurrence(occurrenceId: string): CompleteOccurrenceResult;
  /** The already-materialised occurrences of a series, oldest first. */
  occurrences(templateId: string): Item[];
}

export interface RecurrenceServiceOptions {
  items: ItemsRepo;
  rules: RecurrenceRulesRepo;
  /** Zone used when a rule does not name one, and to resolve "today". */
  defaultTimezone: string;
  /** Clock injection point, so a run is reproducible in tests. */
  now?: () => IsoDate;
}

function defaultToday(): IsoDate {
  return new Date().toISOString().slice(0, 10) as IsoDate;
}

export function createRecurrenceService(options: RecurrenceServiceOptions): RecurrenceService {
  const { items, rules, defaultTimezone } = options;
  const today = options.now ?? defaultToday;

  function requireTemplate(templateId: string): Item {
    const template = items.getById(templateId);
    if (!template) {
      throw new InvalidReferenceError('Item', 'id', 'item');
    }
    if (!template.isTemplate || !template.recurrenceId) {
      throw new InvalidReferenceError('Item', 'recurrence', 'recurring series');
    }
    return template;
  }

  function specFor(templateId: string): RecurrenceSpec {
    const template = requireTemplate(templateId);
    const rule = rules.getById(template.recurrenceId as string);
    if (!rule) {
      throw new InvalidReferenceError('Item', 'recurrence', 'recurrence rule');
    }
    return parseRecurrence(rule.rrule, { defaultTimezone: rule.timezone || defaultTimezone });
  }

  /**
   * Injects a DTSTART when the caller supplied a bare RRULE.
   *
   * The rule format requires a DTSTART, because without one "every Monday" has no
   * defined phase. A person picking "every 2 weeks" should not have to think about
   * what anchors it, so the start they already gave for the item is used.
   */
  function withDtstart(rrule: string, anchorDate: IsoDate, timezone: string): string {
    if (/^\s*DTSTART/im.test(rrule)) {
      return rrule;
    }
    const body = rrule.replace(/^\s*RRULE:/i, '');
    return `DTSTART;TZID=${timezone}:${anchorDate.replace(/-/g, '')}T000000\nRRULE:${body}`;
  }

  /**
   * The inheritable shape of an occurrence.
   *
   * `deadlineOn` is deliberately not copied. A soft deadline on the template would
   * place every future occurrence past due the moment it was created, which
   * means nothing for a task that repeats.
   */
  function occurrenceInput(template: Item, occurrence: Occurrence, ruleId: string) {
    return {
      categoryId: template.categoryId,
      title: template.title,
      notes: template.notes,
      estimateMinutes: template.estimateMinutes,
      contextIds: template.contextIds,
      projectId: template.projectId,
      data: template.data,
      recurrenceId: ruleId,
      parentItemId: template.id,
      occurrenceDate: occurrence.date,
      // A timed series is a hard commitment and belongs on the calendar. An
      // all-day series is a next action, because "some time this week" is not an
      // appointment.
      container: (occurrence.at === null ? 'next_action' : 'calendar') as Item['container'],
      whenAt: occurrence.at,
    };
  }

  function materialize(
    templateId: string,
    materializeOptions: MaterializeOptions = {},
  ): MaterializeResult {
    const spec = specFor(templateId);
    const template = requireTemplate(templateId);
    const ruleId = template.recurrenceId as string;

    const horizonDays = materializeOptions.horizonDays ?? DEFAULT_HORIZON_DAYS;
    // From today rather than the anchor date, so attaching a rule never backfills
    // a backlog.
    const from = materializeOptions.from ?? today();
    // Inclusive of both ends, so the window holds `horizonDays` days in total.
    const to = addDays(from, Math.max(horizonDays - 1, 0));

    const expanded = expandOccurrences(spec, {
      start: from,
      end: to,
      // One extra, purely to detect whether the backstop was hit.
      limit: MAX_OCCURRENCES_PER_RUN + 1,
    });
    const truncated = expanded.length > MAX_OCCURRENCES_PER_RUN;
    const wanted = truncated ? expanded.slice(0, MAX_OCCURRENCES_PER_RUN) : expanded;

    const existing = new Set(items.occurrenceDatesOf(templateId));
    const created: Item[] = [];

    for (const occurrence of wanted) {
      if (existing.has(occurrence.date)) {
        continue;
      }
      try {
        created.push(items.create(occurrenceInput(template, occurrence, ruleId)));
        existing.add(occurrence.date);
      } catch (error) {
        // The unique index on (parent, date) is the real guarantee against two
        // runs racing. Losing that race is a skipped occurrence, not a failure.
        if (constraintKind(error) === 'unique') {
          existing.add(occurrence.date);
          continue;
        }
        throw error;
      }
    }

    return {
      parentId: templateId,
      created,
      skipped: wanted.length - created.length,
      truncated,
    };
  }

  return {
    attachSeries(itemId, input) {
      const template = items.getById(itemId);
      if (!template) {
        throw new InvalidReferenceError('Item', 'id', 'item');
      }
      if (template.isTemplate) {
        throw new InvalidReferenceError('Item', 'id', 'recurring series');
      }

      const timezone = input.timezone ?? defaultTimezone;
      const anchorDate = input.anchorDate ?? today();

      // Validated before storing, so a malformed rule fails where the user made
      // it rather than silently on the next background run.
      const parsed = parseRecurrence(withDtstart(input.rrule, anchorDate, timezone), {
        defaultTimezone: timezone,
      });

      const stored = rules.create({
        rrule: parsed.rrule,
        timezone: parsed.timezone,
        anchorDate: parsed.anchorDate,
      });

      // The template is the row the user already created, kept in place and
      // re-pointed at the rule. Creating a second row instead would orphan
      // anything already referencing the original id.
      items.update(itemId, { recurrenceId: stored.id });
      const marked = items.setTemplateFlag(itemId, true);

      const result = materialize(itemId, {
        ...(input.horizonDays === undefined ? {} : { horizonDays: input.horizonDays }),
        // A series starting in the future must not create occurrences before it
        // begins; materialising from today handles that, since expandOccurrences
        // will not yield anything earlier than the anchor.
      });

      return { item: marked, created: result.created.length };
    },

    detachSeries(itemId) {
      const template = items.getById(itemId);
      if (!template) {
        throw new InvalidReferenceError('Item', 'id', 'item');
      }
      // Occurrences first. The parent delete cascades anyway, but being explicit
      // means a failure part-way leaves the series coherent rather than orphaned.
      items.deleteOccurrencesOf(itemId);
      if (template.recurrenceId) {
        rules.remove(template.recurrenceId);
      }
      items.update(itemId, { recurrenceId: null });
      items.setTemplateFlag(itemId, false);
    },

    specFor,

    materialize,

    materializeAll(materializeOptions = {}) {
      return items
        .listTemplates()
        .filter((template) => template.recurrenceId !== null)
        .map((template) => materialize(template.id, materializeOptions));
    },

    completeOccurrence(occurrenceId) {
      const occurrence = items.getById(occurrenceId);
      if (!occurrence) {
        throw new InvalidReferenceError('Item', 'id', 'item');
      }
      if (!occurrence.parentItemId) {
        throw new InvalidReferenceError('Item', 'parent_item_id', 'recurring occurrence');
      }

      const completed = items.complete(occurrenceId);
      const spec = specFor(occurrence.parentItemId);

      const upcoming = nextOccurrenceAfter(spec, occurrence.occurrenceDate ?? today());
      if (!upcoming) {
        return { occurrence: completed, next: null };
      }

      // The next occurrence is ensured eagerly. The alternative is a series that
      // quietly runs out the moment the last materialised occurrence is completed.
      const result = materialize(occurrence.parentItemId, {
        from: upcoming.date,
        horizonDays: 1,
      });

      const next =
        result.created[0] ??
        items
          .occurrencesOf(occurrence.parentItemId)
          .find((candidate) => candidate.occurrenceDate === upcoming.date) ??
        null;

      return { occurrence: completed, next };
    },

    occurrences(templateId) {
      return items.occurrencesOf(templateId);
    },
  };
}
