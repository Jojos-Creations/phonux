import { realpathSync } from 'node:fs';

// Node's file-level events carry line 1, column 1; no real test call sits there.
export const isFileLevel = (data) => data?.line === 1 && data?.column === 1;

// A file-level event echoes argv while a test carries the loader's real path (/var vs /private/var on macOS).
export function realKey(file) {
  try { return realpathSync(file); } catch { return file; }
}

// The event shape is unversioned (validated on Node v24.18.0): a change makes files read as missing or stopped, never green.
export function lineFor(event) {
  const d = event.data ?? {};
  if (typeof d.file !== 'string') return null;
  switch (event.type) {
    case 'test:complete': return isFileLevel(d) ? `FILE:${d.file}` : null;
    case 'test:enqueue': return isFileLevel(d) ? null : `QUEUED:${d.file}`;
    case 'test:pass':
    case 'test:fail': return isFileLevel(d) ? null : `FINISHED:${d.file}`;
    case 'test:summary': return `END:${d.file}`;
    default: return null;
  }
}

export function parseStreamLines(text, canonical = (file) => file) {
  const parsed = { completed: new Set(), ended: new Set(), queued: new Map(), finished: new Map(), matched: new Set() };
  const bump = (map, file) => map.set(file, (map.get(file) ?? 0) + 1);
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const tag = line.slice(0, colon);
    const file = canonical(line.slice(colon + 1));
    if (tag === 'FILE') parsed.completed.add(file);
    else if (tag === 'END') parsed.ended.add(file);
    else if (tag === 'QUEUED') bump(parsed.queued, file);
    else if (tag === 'FINISHED') bump(parsed.finished, file);
    else if (tag === 'MATCH') parsed.matched.add(file);
  }
  return parsed;
}

// A truncation only loses finishes: finished > queued is a failing hook, which the child's own exit code already reports.
export function stoppedEarly(requestedAbs, completedAbs, { ended, queued, finished }) {
  const completed = new Set(completedAbs);
  const requested = new Set(requestedAbs);
  const keys = new Set([...requestedAbs.filter((f) => completed.has(f)), ...queued.keys(), ...finished.keys()]);
  const stopped = [];
  for (const file of keys) {
    const q = queued.get(file) ?? 0;
    const f = finished.get(file) ?? 0;
    const noEnd = requested.has(file) && completed.has(file) && !ended.has(file);
    if (noEnd || f < q) stopped.push({ file, queued: q, finished: f, noEnd });
  }
  return stopped;
}

// Nothing arrived for the file: it registered no tests, or its process ended before sending any result.
// The two look identical in the stream, so the text names both and neither reads as a truncation.
export function formatStopped(stopped, relativeTo, prefix = '') {
  const silent = stopped.filter((s) => s.queued === 0);
  const cut = stopped.filter((s) => s.queued !== 0);
  const lines = [];
  if (cut.length > 0) {
    lines.push(`${prefix}${cut.length} file(s) stopped early although Node reported them complete:`);
    for (const { file, queued, finished, noEnd } of cut) {
      const counts = `${queued} test(s) queued, ${finished} finished`;
      lines.push(`  ${relativeTo(file)}: ${noEnd ? `${counts}; its final summary never arrived` : counts}`);
    }
  }
  for (const { file } of silent) {
    lines.push(`${prefix}no tests registered in ${relativeTo(file)}, or its process ended before sending any result (no final summary arrived)`);
  }
  return lines;
}

export function streamTotals({ queued, finished }) {
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  return { queued: sum(queued), finished: sum(finished) };
}
