import { appendFileSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  appendFileSync(process.env.PHONUX_RESOLVE_LOG, `${specifier}\n`);
  return nextResolve(specifier, context);
}
