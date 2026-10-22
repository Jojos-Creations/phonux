/**
 * The closed-pages list: eviction order, the storage the host supplies, and the load and write ordering around it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './support/jsdom-globals.js';
import * as React from 'react';
import { useClosedPages } from '../closedPagesList.js';
import type { ClosedPagesList, ClosedPagesStorage } from '../closedPagesList.js';
import type { ClosedPageEntry } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const h = React.createElement;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function entry(n: number): ClosedPageEntry {
  return { id: `2026-09-14T10:0${n}:00.000Z#${n}`, title: `Page ${n}`, url: `https://example.com/${n}`, closedAt: `2026-09-14T10:0${n}:00.000Z` };
}

/** A storage that records every call; `read` resolves to `stored` unless a deferred gate is given. */
function recordingStorage(stored: readonly ClosedPageEntry[] = [], gate?: Promise<void>) {
  const writes: (readonly ClosedPageEntry[])[] = [];
  const calls = { reads: 0 };
  const storage: ClosedPagesStorage = {
    read: async () => {
      calls.reads++;
      await gate;
      return stored;
    },
    write: async (entries) => {
      writes.push([...entries]);
    },
  };
  return { storage, writes, calls };
}

const flush = async (): Promise<void> => {
  await React.act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** Mounts a probe that exposes the hook's list through `out`. */
function mountList(storage: ClosedPagesStorage, limit: number): { out: { current?: ClosedPagesList } } {
  const out: { current?: ClosedPagesList } = {};
  const Probe = (): null => {
    out.current = useClosedPages({ storage, limit });
    return null;
  };
  mount(h(Probe));
  return { out };
}

const ids = (list: ClosedPagesList | undefined): string[] => (list?.entries ?? []).map((e) => e.title);

test('closing a page adds it, and at the limit the least recently touched page is evicted first', async () => {
  const { storage } = recordingStorage();
  const { out } = mountList(storage, 2);
  await flush();
  React.act(() => out.current?.add(entry(1)));
  React.act(() => out.current?.add(entry(2)));
  assert.deepEqual(ids(out.current), ['Page 1', 'Page 2']);
  React.act(() => out.current?.touch(entry(1).id));
  React.act(() => out.current?.add(entry(3)));
  assert.deepEqual(ids(out.current), ['Page 1', 'Page 3'], 'Page 2 was least recently touched, so it went');
});

test('touching an unknown id changes nothing, and adding an existing id replaces it instead of duplicating', async () => {
  const { storage, writes } = recordingStorage();
  const { out } = mountList(storage, 5);
  await flush();
  React.act(() => out.current?.add(entry(1)));
  const before = writes.length;
  React.act(() => out.current?.touch('no-such-id'));
  assert.equal(writes.length, before, 'an unknown touch writes nothing');
  React.act(() => out.current?.add({ ...entry(1), title: 'Renamed' }));
  assert.deepEqual(ids(out.current), ['Renamed']);
});

test('the host storage is the only store: one read at mount, and the whole list written after each change', async () => {
  const stored = [entry(1), entry(2)];
  const { storage, writes, calls } = recordingStorage(stored);
  const { out } = mountList(storage, 3);
  await flush();
  assert.equal(calls.reads, 1, 'read once at mount');
  assert.deepEqual(ids(out.current), ['Page 1', 'Page 2'], 'the stored log is what the list starts with');
  React.act(() => out.current?.add(entry(3)));
  React.act(() => out.current?.add(entry(4)));
  await flush();
  assert.equal(writes.length, 2, 'one write per change');
  assert.deepEqual(writes[1]?.map((e) => e.title), ['Page 2', 'Page 3', 'Page 4'], 'the write is the whole list after eviction');
});

test('a change made before the stored log is read is kept, and nothing is written until the read lands', async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const { storage, writes } = recordingStorage([entry(1)], gate);
  const { out } = mountList(storage, 5);
  React.act(() => out.current?.add(entry(2)));
  await flush();
  assert.equal(writes.length, 0, 'no write may overwrite the saved log before it is read');
  assert.equal(out.current?.loaded, false);
  open();
  await flush();
  assert.equal(out.current?.loaded, true);
  assert.deepEqual(ids(out.current), ['Page 1', 'Page 2'], 'the stored entry and the early add both survive');
  assert.deepEqual(writes.at(-1)?.map((e) => e.title), ['Page 1', 'Page 2']);
});

test('a failed read leaves the list empty and writes nothing, so the saved log is not overwritten', async (t) => {
  t.mock.method(console, 'error', () => {});
  const storage: ClosedPagesStorage = {
    read: async () => {
      throw new Error('disk gone');
    },
    write: async () => {
      throw new Error('write should never run');
    },
  };
  const { out } = mountList(storage, 5);
  await flush();
  assert.equal(out.current?.loaded, true);
  React.act(() => out.current?.add(entry(1)));
  await flush();
  assert.deepEqual(ids(out.current), ['Page 1'], 'the change still shows in memory');
});

test('a rejected write is reported and the in-memory list keeps the change', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const storage: ClosedPagesStorage = {
    read: async () => [],
    write: async () => {
      throw new Error('quota');
    },
  };
  const { out } = mountList(storage, 5);
  await flush();
  React.act(() => out.current?.add(entry(1)));
  await flush();
  assert.equal(errors.mock.callCount(), 1);
  assert.deepEqual(ids(out.current), ['Page 1']);
});

test('limit must be a positive integer', () => {
  const { storage } = recordingStorage();
  for (const limit of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => useClosedPages({ storage, limit }), RangeError, `limit ${limit}`);
  }
});

test('the closed-pages sources keep no storage of their own: no Web Storage, IndexedDB or module-level collection', () => {
  for (const file of ['closedPagesModel.ts', 'closedPagesList.ts', 'closedPagesFormat.ts', 'closedPagesTemplate.tsx', 'ClosedPagesPanel.tsx']) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(source.length > 0, `${file} is empty`);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|caches\./, `${file} reaches a browser store`);
    assert.doesNotMatch(source, /^(const|let|var)\s[^\n]*new (Map|Set|WeakMap)\b/m, `${file} holds a module-level collection`);
  }
});
