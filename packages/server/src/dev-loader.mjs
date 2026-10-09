/**
 * Development-only resolver for Node's built-in type stripping.
 *
 * TypeScript's NodeNext convention uses `.js` in source imports so compiled files
 * work in Node. When Node executes the `.ts` source directly, those files do not
 * exist yet; map only local, existing `.js` specifiers to their `.ts` source.
 */
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const sourceUrl = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    try {
      await access(fileURLToPath(sourceUrl));
      return { url: sourceUrl.href, shortCircuit: true };
    } catch {
      // A package import or a genuinely JavaScript module should use Node's normal resolver.
    }
  }
  return nextResolve(specifier, context);
}
