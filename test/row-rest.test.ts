import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRowNumbers } from '../rowNumbers.js';
import { halfRest, isHalfOff, restStep, type RestStepInput } from '../rowRest.js';

const SLOT = 100;
const step = (o: Partial<RestStepInput>): ReturnType<typeof restStep> =>
  restStep({ direction: 'right', rest: null, lastOff: 0, slot: SLOT, canLeft: false, canRight: false, revealSlots: 1, parkable: SLOT, ...o });

describe('a row resting with blanks', () => {
  it('leaves an ordinary step alone while panels wait', () => {
    assert.equal(step({ canRight: true }), null);
    assert.equal(step({ direction: 'left', canLeft: true }), null);
  });
  it('opens a blank after the last panel until that panel is centered', () => {
    assert.deepEqual(step({ lastOff: SLOT }), { park: 'left', rest: { lead: 0, tail: 1 } });
    assert.equal(step({ lastOff: 0.5 * SLOT }), null);
  });
  it('opens no blank when no panel may park', () => {
    assert.equal(step({ lastOff: SLOT, parkable: null }), null);
  });
  it('closes a blank on a step left, bringing the panel back', () => {
    assert.deepEqual(step({ direction: 'left', canLeft: true, rest: { lead: 0, tail: 2 } }), { reveal: 'left', rest: { lead: 0, tail: 1 } });
  });
  it('snaps a half rest back to whole slots on any step', () => {
    const rest = { lead: 0.5, tail: 0.5 };
    assert.deepEqual(step({ rest, canRight: true }), { reveal: 'right', rest: { lead: 0, tail: 0 } });
    assert.deepEqual(step({ rest, direction: 'left', canLeft: true }), { reveal: 'left', rest: { lead: 0, tail: 0 } });
  });
  it('holds at the end when the last panel is already centered', () => {
    assert.equal(step({ rest: { lead: 0.5, tail: 1.5 }, lastOff: 0 }), null);
  });
  it('adds a whole blank slot for a half rest, split on both sides', () => {
    assert.deepEqual(halfRest(null), { lead: 0.5, tail: 0.5 });
    assert.deepEqual(halfRest({ lead: 0, tail: 1 }), { lead: 0.5, tail: 1.5 });
  });
  it('reads only half a slot as half off', () => {
    assert.equal(isHalfOff(50, SLOT), true);
    assert.equal(isHalfOff(-50, SLOT), true);
    assert.equal(isHalfOff(100, SLOT), false);
    assert.equal(isHalfOff(0, SLOT), false);
  });
});

describe('the numbers of a rest', () => {
  const entry = (id: string, collapsible: boolean) => ({ id, live: true, collapsible, settings: { overflow: collapsible ? 'park' : 'scroll' } }) as never;
  const numbers = (ids: string[], rest: { lead: number; tail: number } | null) =>
    computeRowNumbers({ entries: [entry('root', false), ...ids.map((id) => entry(id, true))], phoneWidth: 90, containerWidth: 420, gap: 10, rest });

  it('keeps the root where the full row has it', () => {
    const full = numbers(['a', 'b', 'c'], null);
    assert.equal(numbers(['a', 'b'], { lead: 0.5, tail: 0.5 }).rowMarginLeft, full.rowMarginLeft);
    assert.equal(numbers(['a', 'b'], { lead: 0, tail: 1 }).rowMarginLeft, full.rowMarginLeft);
  });
  it('puts the lead after the root, so a panel of an even row sits on the center', () => {
    const n = numbers(['a', 'b'], { lead: 0.5, tail: 0.5 });
    assert.deepEqual(n.leftOffsets, [0, 150, 250]);
    const center = n.stripStart + n.leftOffsets[1]! + n.widths[1]! / 2;
    assert.ok(Math.abs(center - n.stripWindow / 2) < 0.01);
  });
});
