/** The one place that turns a name a caller gives into the entry it means: a panel's key, which is its public id, or the counter id the entry held before the key was the only id. */

import { panelKey } from './panelSettings.js';

const warned = new Set<string>();

/** Logs once per counter id that the id a caller gave is the old one and names the key to use; silent in production and where `process` is undefined. @internal */
export function warnCounterId(counter: string, key: string): void {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production' || warned.has(counter)) return;
  warned.add(counter);
  console.warn(`phonux: '${counter}' is a panel's old counter id; the panel's id is its key '${key}', and the counter id stops resolving in a later release.`);
}

/** The entry whose key is `name`, else the entry whose counter id is `name` (with a development warning when that differs from its key); undefined when none. @internal */
export function entryNamed<E extends { readonly id: string; readonly key?: string }>(entries: readonly E[], name: string): E | undefined {
  const byKey = entries.find((e) => panelKey(e as never) === name);
  if (byKey !== undefined) return byKey;
  const byCounter = entries.find((e) => e.id === name);
  if (byCounter !== undefined) warnCounterId(name, panelKey(byCounter as never));
  return byCounter;
}
