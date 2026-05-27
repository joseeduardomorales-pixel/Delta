// Shared className composer for the design system. Combines clsx
// (conditional classes) with tailwind-merge (smart conflict resolution
// so e.g. `px-4` later in the chain wins over `px-2` earlier).
//
// Used by every primitive in components/ui/ and any consumer that
// needs to merge variant classes with caller overrides.

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
