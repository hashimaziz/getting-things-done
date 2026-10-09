/**
 * Recommendations.
 *
 * This is the seam where a local language model will eventually be plugged in,
 * so the shape matters more than the behaviour. Two rules make that possible:
 *
 * 1. **Every recommendation must justify itself.** A recommendation without a
 *    `reason` is indistinguishable from noise, and noise is what makes people
 *    ignore a system that tries to help. It does not matter whether the reason
 *    came from a deterministic rule or from a model reading the data; a model that
 *    cannot say why it suggested something has not earned the right to suggest it.
 *
 * 2. **Providers are interchangeable and named.** The deterministic provider ships
 *    now and is the baseline any future model provider has to beat. A model
 *    provider cannot quietly replace it, because the registry can serve both and a
 *    caller has to ask for one by name.
 *
 * The shipped provider is entirely deterministic. That is not a placeholder: it is
 * Allen's own four-criteria engagement model expressed as scoring, it is what runs
 * when no model is available, and it is the thing a model's output gets measured
 * against.
 */

import { daysBetween, type IsoDate } from '../dates/index.js';
import type { Category, Context, Item, Person, Project } from '../entities.js';
import { getFieldTypeSpec, type FieldDefinition } from '../fields/index.js';
import type { SystemViolation } from '../invariants.js';

/** What the caller wants to know about. */
export type RecommendationFocus =
  'what_next' | 'overdue' | 'waiting' | 'stalled_projects' | 'daily_review' | 'schedule';

export interface RecommendationContext {
  today: IsoDate;
  timezone: string;
  focus: RecommendationFocus;
  /** Cap on how many recommendations to return. */
  limit?: number;
  /**
   * The situation the user is actually in, which is Allen's first engagement
   * criterion. Null means "not stated", not "everywhere".
   */
  contextIds?: string[] | null;
  /** Minutes available. Null means unconstrained. */
  timeAvailableMinutes?: number | null;
  /** How much capacity the user has. Null means unconstrained. */
  energy?: 'low' | 'medium' | 'high' | null;
}

/** The snapshot every provider reads. Supplied by the caller, so providers are pure. */
export interface RecommendationData {
  items: readonly Item[];
  projects: readonly Project[];
  people: readonly Person[];
  contexts: readonly Context[];
  categories: readonly Category[];
  /** Already-computed invariant violations, so providers do not each re-derive them. */
  violations: readonly SystemViolation[];
  /**
   * Definitions for the category the items belong to, so a provider can read a
   * user's own priority scale rather than hardcoding one.
   */
  definitions?: readonly FieldDefinition[];
}

export type RecommendationKind =
  'suggest_action' | 'flag_risk' | 'propose_schedule' | 'ask_question';

export interface Recommendation {
  /** Stable within one response, so the UI can key and de-duplicate on it. */
  id: string;
  kind: RecommendationKind;
  title: string;
  detail: string;
  /** Why this was suggested. Required; a recommendation without one is not sent. */
  reason: string;
  /** 0 to 1. The shipped provider is confident; a model should be calibrated. */
  confidence: number;
  /** The item this concerns, when there is one. */
  itemId?: string;
  /** Machine-readable labels for grouping and filtering. */
  tags: string[];
  /** Lower sorts first. */
  rank: number;
}

export interface RecommendationProvider {
  readonly id: string;
  readonly label: string;
  /**
   * True when the provider needs a model loaded. Callers use it to avoid paying
   * the load cost for a request that only wants a deterministic answer.
   */
  readonly requiresModel: boolean;
  suggest(context: RecommendationContext, data: RecommendationData): Promise<Recommendation[]>;
}

export class UnknownProviderError extends Error {
  constructor(providerId: string) {
    super(`No recommendation provider with id "${providerId}"`);
    this.name = 'UnknownProviderError';
  }
}

/**
 * The set of available providers.
 *
 * A caller must name the one it wants. That is deliberate friction: swapping the
 * engine should be a visible decision, not something that happens because a model
 * happened to be loaded.
 */
export class RecommendationRegistry {
  private readonly providers = new Map<string, RecommendationProvider>();

  register(provider: RecommendationProvider): this {
    if (this.providers.has(provider.id)) {
      throw new Error(`A recommendation provider with id "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: string): RecommendationProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new UnknownProviderError(id);
    }
    return provider;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  /** Provider ids in registration order, for a settings screen. */
  list(): Array<{ id: string; label: string; requiresModel: boolean }> {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      label: provider.label,
      requiresModel: provider.requiresModel,
    }));
  }
}

/* ------------------------------------------------------ reading the data */

/**
 * Reads a user's own priority scale.
 *
 * Their `priority` field may order low-to-high or high-to-low, and may not exist
 * at all. Guessing the direction wrong inverts every priority-based ranking, so
 * this reads the configured choice order and treats it as authoritative.
 */
function priorityWeight(
  item: Item,
  definitions: readonly FieldDefinition[],
): { weight: number; label: string } | null {
  const definition = definitions.find((entry) => entry.type === 'priority');
  if (!definition) {
    return null;
  }
  const options = definition.options;
  if (options.kind !== 'choices') {
    return null;
  }
  const value = item.data[definition.key];
  if (typeof value !== 'string') {
    return null;
  }
  const choice = options.choices.find((entry: { value: string }) => entry.value === value);
  if (!choice) {
    return null;
  }
  return { weight: choice.order, label: choice.label };
}

function estimateOf(item: Item): number | null {
  if (item.estimateMinutes !== null && item.estimateMinutes > 0) {
    return item.estimateMinutes;
  }
  // Fall back to a configured duration field, since a user may have made their
  // own rather than using the core one.
  const value = item.data.estimate_minutes ?? item.data.estimate;
  return typeof value === 'number' && value > 0 ? value : null;
}

function isActionable(item: Item): boolean {
  return item.container === 'next_action' || item.container === 'calendar';
}

/**
 * Scores an item against the four engagement criteria.
 *
 * Allen's criteria are context, time available, energy and priority. Only priority
 * is a property of the item; the other three come from the situation, which is why
 * they are applied as adjustments here rather than baked into the score.
 */
interface Scored {
  item: Item;
  score: number;
  reasons: string[];
}

function scoreItem(
  item: Item,
  context: RecommendationContext,
  data: RecommendationData,
): Scored | null {
  const reasons: string[] = [];
  let score = 0;

  // Priority, read from the user's own scale.
  const priority = priorityWeight(item, data.definitions ?? []);
  if (priority) {
    // Lower order is more urgent in this app's default scale, so invert it: the
    // first choice is the highest weight.
    score += Math.max(0, 20 - priority.weight * 5);
    if (priority.weight <= 1) {
      reasons.push(`marked ${priority.label}`);
    }
  }

  // Deadline pressure.
  if (item.deadlineOn !== null) {
    const days = daysBetween(context.today, item.deadlineOn);
    if (days !== null) {
      if (days < 0) {
        score += 100 + Math.min(30, -days);
        reasons.push(`overdue by ${-days} day${-days === 1 ? '' : 's'}`);
      } else if (days === 0) {
        score += 70;
        reasons.push('due today');
      } else if (days <= 2) {
        score += 55;
        reasons.push(`due in ${days} day${days === 1 ? '' : 's'}`);
      } else if (days <= 7) {
        score += 30;
        reasons.push(`due in ${days} days`);
      } else {
        // Further off than a week, so mildly *less* urgent than the default.
        score -= 10;
      }
    }
  }

  // A hard commitment today is, by definition, today's work.
  if (item.container === 'calendar' && item.whenAt?.slice(0, 10) === context.today) {
    score += 60;
    reasons.push('on the calendar today');
  }

  // Ageing: something nobody has touched in months needs a decision, not a nudge.
  const age = daysBetween(item.createdAt.slice(0, 10), context.today);
  if (age !== null) {
    score += Math.min(25, Math.floor(age / 7));
    if (age >= 30) {
      reasons.push(`not touched for ${age} days`);
    }
  }

  // Time available. An item that cannot fit in the time left is not a suggestion,
  // however urgent it is.
  const estimate = estimateOf(item);
  if (context.timeAvailableMinutes !== null && context.timeAvailableMinutes !== undefined) {
    if (estimate !== null && estimate > context.timeAvailableMinutes) {
      score -= 80;
      reasons.push(`needs ${estimate}m, more than the ${context.timeAvailableMinutes}m available`);
    } else if (estimate !== null) {
      score += 15;
      reasons.push(`fits in ${estimate}m`);
    }
  } else if (estimate !== null && estimate <= 5) {
    // With no time constraint, a quick win is a genuinely good suggestion: it
    // converts momentum into more momentum.
    score += 10;
  }

  // Energy. A long, unestimated task is a poor suggestion when someone is tired.
  if (context.energy === 'low') {
    if (estimate !== null && estimate > 30) {
      score -= 40;
      reasons.push('long task');
    } else if (estimate !== null) {
      score += 20;
      reasons.push('short task');
    }
  }

  // Context. Null means unstated, which must not exclude everything.
  //
  // Excluded rather than penalised: Allen's first engagement criterion is about
  // what you can do *where you are*. Suggesting something you cannot do in the
  // current context is the same as not having suggested it, except it takes up the
  // slot where a suggestion that could have been acted on would have gone.
  if (context.contextIds !== null && context.contextIds !== undefined) {
    const wanted = new Set(context.contextIds);
    if (!item.contextIds.some((id: string) => wanted.has(id))) {
      return null;
    }
  }

  return { item, score, reasons };
}

/* --------------------------------------------------- the shipped provider */

export const RULE_PROVIDER_ID = 'rules';

function recommendation(
  id: string,
  kind: RecommendationKind,
  title: string,
  reason: string,
  options: Partial<Recommendation> = {},
): Recommendation {
  return {
    id,
    kind,
    title,
    detail: options.detail ?? '',
    reason,
    confidence: options.confidence ?? 0.8,
    tags: options.tags ?? [],
    rank: options.rank ?? 0,
    ...(options.itemId === undefined ? {} : { itemId: options.itemId }),
  };
}

/**
 * The deterministic provider.
 *
 * Implements the parts of Allen's engagement model that can be stated as rules,
 * and nothing more. It is honest about its confidence, and every recommendation
 * carries the rule that produced it.
 */
export class RuleBasedProvider implements RecommendationProvider {
  readonly id = RULE_PROVIDER_ID;
  readonly label = 'Built-in rules';
  readonly requiresModel = false;

  async suggest(
    context: RecommendationContext,
    data: RecommendationData,
  ): Promise<Recommendation[]> {
    const limit = context.limit ?? 5;
    switch (context.focus) {
      case 'what_next':
        return this.whatNext(context, data, limit);
      case 'overdue':
        return this.overdue(context, data, limit);
      case 'waiting':
        return this.waiting(context, data, limit);
      case 'stalled_projects':
        return this.stalled(data, limit);
      case 'schedule':
        return this.schedule(context, data, limit);
      case 'daily_review':
        return [
          ...this.whatNext(context, data, 3),
          ...this.stalled(data, 2),
          ...this.overdue(context, data, 3),
        ].slice(0, limit);
    }
  }

  /** The four criteria applied to the open action list. */
  private whatNext(
    context: RecommendationContext,
    data: RecommendationData,
    limit: number,
  ): Recommendation[] {
    const scored = data.items
      .filter((item) => isActionable(item) && !item.isTemplate)
      .map((item) => scoreItem(item, context, data))
      .filter((entry): entry is Scored => entry !== null);

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry, index) =>
        recommendation(
          `${RULE_PROVIDER_ID}:what_next:${entry.item.id}`,
          'suggest_action',
          entry.item.title,
          entry.reasons.length > 0
            ? `Worth doing next because it is ${entry.reasons.join(', ')}.`
            : 'Worth doing next from the open action list.',
          {
            detail: describeItem(entry.item),
            itemId: entry.item.id,
            tags: ['action', ...entry.reasons],
            rank: index,
          },
        ),
      );
  }

  private overdue(
    context: RecommendationContext,
    data: RecommendationData,
    limit: number,
  ): Recommendation[] {
    return data.items
      .filter((item) => !item.isTemplate && item.container !== 'done' && item.container !== 'trash')
      .map((item) => {
        const days = item.deadlineOn === null ? null : daysBetween(context.today, item.deadlineOn);
        return { item, days };
      })
      .filter((entry) => entry.days !== null && entry.days < 0)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
      .slice(0, limit)
      .map((entry, index) =>
        recommendation(
          `${RULE_PROVIDER_ID}:overdue:${entry.item.id}`,
          'flag_risk',
          `${entry.item.title} is overdue`,
          (() => {
            const daysLate = -(entry.days ?? 0);
            return `Its deadline was ${entry.item.deadlineOn}, ${daysLate} day${
              daysLate === 1 ? '' : 's'
            } ago, and it is still open.`;
          })(),
          {
            itemId: entry.item.id,
            tags: ['overdue', 'risk'],
            confidence: 1,
            rank: index,
          },
        ),
      );
  }

  private waiting(
    context: RecommendationContext,
    data: RecommendationData,
    limit: number,
  ): Recommendation[] {
    const names = new Map(data.people.map((person) => [person.id, person.name]));

    return data.items
      .filter((item) => item.container === 'waiting' && !item.isTemplate)
      .map((item) => ({
        item,
        overdue: item.followUpAt !== null && item.followUpAt.slice(0, 10) < context.today,
      }))
      .filter((entry) => entry.overdue)
      .slice(0, limit)
      .map((entry, index) =>
        recommendation(
          `${RULE_PROVIDER_ID}:waiting:${entry.item.id}`,
          'flag_risk',
          `Chase ${names.get(entry.item.waitingOnPersonId ?? '') ?? 'them'} about "${entry.item.title}"`,
          `The follow-up date of ${entry.item.followUpAt?.slice(0, 10)} has passed, so nobody has chased this.`,
          {
            itemId: entry.item.id,
            tags: ['waiting', 'risk'],
            confidence: 1,
            rank: index,
          },
        ),
      );
  }

  private stalled(data: RecommendationData, limit: number): Recommendation[] {
    const stalled = new Set(
      data.violations
        .filter((violation) => violation.kind === 'project_without_next_action')
        .flatMap((violation) => violation.projectIds),
    );

    return data.projects
      .filter((project) => stalled.has(project.id))
      .slice(0, limit)
      .map((project, index) =>
        recommendation(
          `${RULE_PROVIDER_ID}:stalled:${project.id}`,
          'ask_question',
          `"${project.name}" has nothing to do next`,
          'An active project with no next action has stopped moving. Either give it one, move it to Someday, or drop it.',
          {
            tags: ['project', 'risk'],
            confidence: 1,
            rank: index,
          },
        ),
      );
  }

  /**
   * Proposes what to put in the free time on a given day.
   *
   * Deliberately only proposes items that fit. Filling a slot with something that
   * cannot fit is how a schedule becomes fiction, which is exactly what Allen
   * warns against with the calendar.
   */
  private schedule(
    context: RecommendationContext,
    data: RecommendationData,
    limit: number,
  ): Recommendation[] {
    const slotMinutes =
      context.timeAvailableMinutes !== null && context.timeAvailableMinutes !== undefined
        ? context.timeAvailableMinutes
        : 60;

    const candidates = data.items
      .filter((item) => item.container === 'next_action' && !item.isTemplate)
      .map((item) => {
        const estimate = estimateOf(item);
        return { item, estimate, fits: estimate !== null && estimate <= slotMinutes };
      })
      .filter((entry) => entry.fits);

    let remaining = slotMinutes;
    const chosen: typeof candidates = [];

    // Largest first, so the slot is filled with substantial work rather than a
    // scatter of tiny tasks that leave nothing meaningful done.
    for (const entry of [...candidates].sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0))) {
      if ((entry.estimate ?? 0) > remaining) {
        continue;
      }
      chosen.push(entry);
      remaining -= entry.estimate ?? 0;
      if (chosen.length >= limit) {
        break;
      }
    }

    return [
      recommendation(
        `${RULE_PROVIDER_ID}:schedule:plan`,
        'propose_schedule',
        `Fill ${slotMinutes} minutes with ${chosen.length} task${chosen.length === 1 ? '' : 's'}`,
        chosen.length === 0
          ? `Nothing on the list is estimated at or under ${slotMinutes} minutes, so there is nothing that honestly fits.`
          : `Largest tasks that fit, totalling ${slotMinutes - remaining} of ${slotMinutes} minutes.`,
        {
          tags: ['schedule'],
          confidence: chosen.length === 0 ? 0.4 : 0.9,
          rank: 0,
        },
      ),
      ...chosen.map((entry, index) =>
        recommendation(
          `${RULE_PROVIDER_ID}:schedule:${entry.item.id}`,
          'propose_schedule',
          entry.item.title,
          `Estimated at ${entry.estimate} minutes, so it fits the ${slotMinutes}-minute slot.`,
          {
            itemId: entry.item.id,
            detail: describeItem(entry.item),
            tags: ['schedule', 'action'],
            rank: index + 1,
          },
        ),
      ),
    ];
  }
}

function describeItem(item: Item): string {
  const parts: string[] = [];
  if (item.estimateMinutes !== null && item.estimateMinutes > 0) {
    parts.push(
      getFieldTypeSpec('duration').format(item.estimateMinutes, {
        kind: 'duration',
        presetsMinutes: [],
      }),
    );
  }
  if (item.contextIds.length > 0) {
    parts.push(`${item.contextIds.length} context${item.contextIds.length === 1 ? '' : 's'}`);
  }
  if (item.projectId !== null) {
    parts.push('on a project');
  }
  return parts.join(', ');
}

/** The registry the server uses, with the deterministic provider registered. */
export function createDefaultRegistry(): RecommendationRegistry {
  return new RecommendationRegistry().register(new RuleBasedProvider());
}
