/**
 * The shape every setting's enforcement test takes: run one scenario under each of two values of the setting and
 * require the observed outputs to differ. A scenario that never varied the setting, or varied it without the
 * output noticing, fails here instead of passing as "no error". The names that completed are recorded so a test
 * file can assert that the set it covered equals the set it owns.
 */

import assert from 'node:assert/strict';
import { PANEL_SETTINGS_CATALOG } from '../../panelSettings.js';

/** Runs `observe` for one value of the setting and records both; the scenario calls it once per value. */
export type DifferentialRun = <O>(value: unknown, observe: () => O) => O;

export interface DifferentialRecorder {
  differential(name: string, scenario: (run: DifferentialRun) => void): void;
  /** Names whose differential completed, sorted. */
  covered(): readonly string[];
}

const CATALOG_NAMES: ReadonlySet<string> = new Set(PANEL_SETTINGS_CATALOG.map((d) => d.name));

export function createDifferentialRecorder(): DifferentialRecorder {
  const covered = new Set<string>();
  return {
    differential(name, scenario) {
      assert.ok(CATALOG_NAMES.has(name), `differential '${name}': not a catalog name`);
      const runs: { value: unknown; output: unknown }[] = [];
      const run: DifferentialRun = (value, observe) => {
        const output = observe();
        runs.push({ value, output });
        return output;
      };
      scenario(run);
      assert.equal(runs.length, 2, `differential '${name}': the scenario ran ${runs.length} value(s); it must run exactly two`);
      const [first, second] = runs as [(typeof runs)[number], (typeof runs)[number]];
      assert.notDeepStrictEqual(first.value, second.value, `differential '${name}': both runs used the same value`);
      assert.notDeepStrictEqual(first.output, second.output, `differential '${name}': the two values gave equal outputs, so the setting changed nothing`);
      covered.add(name);
    },
    covered: () => [...covered].sort(),
  };
}

const shared = createDifferentialRecorder();

/** The recorder every test file shares; its covered set is what a file asserts against the names it owns. */
export const differential = shared.differential;
export const differentialsCovered = shared.covered;
