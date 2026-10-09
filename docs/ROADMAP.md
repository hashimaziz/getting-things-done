# Roadmap

The foundational GTD workflow is implemented: setup, capture, clarify, configurable item
editing, container lists, calendar, dashboard, weekly review, recurring items, checklist
templates, archive browsing, settings, and headless capture.

## Next product work

- Project review and natural planning: outcomes, next-action prompts, and project-level
  review timestamps.
- Dashboard layout editing in the browser, including widget configuration and accessible
  move controls.
- Richer archive exploration: saved views, date ranges, activity feed presentation, and
  completion trends beyond the compact summary.
- Better reference-data editors: category scoping, editing and deletion confirmation,
  person search, and context ordering.
- Import/export and backup verification for the local SQLite store.

## Longer-term possibilities

- Optional capability providers such as local recommendations, while keeping core rules
  deterministic and inspectable.
- Multi-device synchronization, only after the local data model and conflict policy are
  explicit.
- Notifications for follow-up dates and weekly-review cadence.

Roadmap items should preserve the system's central boundaries: capture stays frictionless,
clarification remains deliberate, the calendar contains hard commitments only, and the
server/repository layer remains the authority for state transitions.
