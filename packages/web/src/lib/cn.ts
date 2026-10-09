/**
 * Class-name merging.
 *
 * `cn` is what makes a component library composable: a caller passes
 * `className="px-4"` and it replaces the default padding rather than fighting it,
 * because the later value wins on conflicting utilities.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
