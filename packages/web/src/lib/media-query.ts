/**
 * Reading a media query from React.
 *
 * The shell needs to know whether the window is wide, because a sidebar that is
 * permanent on a desktop and a drawer on a phone is two different things, and CSS
 * alone cannot express the difference: a test would find two sidebars in the document
 * and the toggle would still be rendered and still do nothing.
 *
 * So the answer is state, held in one place, with the listener kept only while the
 * component is mounted.
 */

import { useEffect, useState } from 'react';

function matchesNow(query: string): boolean {
  // No `matchMedia` is a browser without media queries, which is every browser that
  // cannot run this app anyway. Treated as "does not match" so the fallback is the
  // narrower layout rather than a permanently open overlay.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(query).matches;
}

/**
 * Whether `query` currently matches.
 *
 * Matches on first render rather than after an effect, so the first paint is already
 * the right layout. An effect-based version briefly renders the phone layout on a
 * desktop — visible as the whole page jumping sideways on load.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);

    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Where the sidebar stops being a drawer and starts being a column. */
export const WIDE_SCREEN_QUERY = '(min-width: 768px)';
