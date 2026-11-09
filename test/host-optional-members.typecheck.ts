/** `npm run typecheck` compiles this: a host may leave out snapshots and labels, and a view reading them handles `undefined`. */
import type { Host } from '../index.js';
import { createFakeHost } from '../fakeHost.js';

const full = createFakeHost();
export const withoutOptional: Host = { panels: full.panels, device: full.device };
export const reads = (host: Host): boolean => host.snapshots?.get('x') === null;
