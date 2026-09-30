#!/usr/bin/env node
// Writes test-stream.mjs's tagged lines so a wrapper can compare files asked for, files completed and results received.
// It is the one non-spec reporter: a third --test-reporter trips MaxListenersExceededWarning.

import { lineFor } from './test-stream.mjs';

export default async function* filePresenceReporter(source) {
  for await (const event of source) {
    const line = lineFor(event);
    if (line !== null) yield `${line}\n`;
  }
}
