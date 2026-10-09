import { describe, expect, it } from 'vitest';
import { APP_CONFIG as CORE_CONFIG, formatDocumentTitle as coreTitle } from '@gtd/core';
import { APP_CONFIG } from './types';
import { PRODUCT_NAME, formatDocumentTitle } from './document-title';
import { CONTAINERS } from '@gtd/core';

/**
 * The web package mirrors a handful of constants from core rather than importing
 * them, because core is Node-targeted: importing its entry point into the browser
 * would pull `date-fns` and `rrule` into the bundle to read two strings.
 *
 * That is a deliberate trade, and the only thing keeping it honest is this file. If
 * core is renamed, or the API prefix moves, these tests fail on the spot instead of
 * the app silently talking to the wrong path.
 */

describe('mirrored application config', () => {
  it('uses the same product name as core', () => {
    expect(APP_CONFIG.identity.name).toBe(CORE_CONFIG.identity.name);
    expect(PRODUCT_NAME).toBe(CORE_CONFIG.identity.name);
  });

  it('uses the same API base path as core', () => {
    expect(APP_CONFIG.paths.apiBasePath).toBe(CORE_CONFIG.paths.apiBasePath);
  });

  it('titles documents identically to core', () => {
    expect(formatDocumentTitle('Inbox')).toBe(coreTitle('Inbox'));
    expect(formatDocumentTitle('Weekly Review')).toBe(coreTitle('Weekly Review'));
    expect(formatDocumentTitle()).toBe(coreTitle());
    expect(formatDocumentTitle()).toBe(CORE_CONFIG.identity.name);
    expect(formatDocumentTitle('  ')).toBe(CORE_CONFIG.identity.name);
  });
});

describe('mirrored container type', () => {
  it('names every container core defines', () => {
    // A stale local `Container` union would make a container impossible to render
    // without a type error pointing at the cause, so this catches it early.
    const local: string[] = [
      'inbox',
      'next_action',
      'calendar',
      'waiting',
      'someday',
      'reference',
      'done',
      'trash',
    ];
    expect([...CONTAINERS].sort()).toEqual(local.sort());
  });
});
