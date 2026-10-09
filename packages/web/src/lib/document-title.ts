/**
 * Page titles.
 *
 * Mirrors core's `formatDocumentTitle` rather than importing it, for the same
 * reason the web types are re-declared: core is Node-targeted. Importing it would
 * work, but it couples the browser bundle to the server package's entry point for
 * one string function, and the next thing someone adds to core's barrel becomes a
 * browser dependency. A test asserts the two implementations agree.
 *
 * Tab titles matter more than they look. With a weekly review open in one tab and
 * the inbox in another, "Inbox — GTD" is the difference between knowing which
 * window you are in and guessing.
 */

import { useEffect } from 'react';

export const PRODUCT_NAME = 'GTD';

export function formatDocumentTitle(page?: string): string {
  const trimmed = page?.trim();
  return trimmed ? `${trimmed} — ${PRODUCT_NAME}` : PRODUCT_NAME;
}

export function useDocumentTitle(page?: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = formatDocumentTitle(page);
    return () => {
      document.title = previous;
    };
  }, [page]);
}
