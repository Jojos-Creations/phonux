/**
 * Compile-only proof that `ReleaseMeasure`, the parameter type of the exported `shouldCloseOnRelease`, is itself
 * exported from the barrel. Never imported by anything; `tsc -p client --noEmit` type-checks it as a root file.
 * Dropping `ReleaseMeasure` from index.ts or PhoneView.tsx fails this file with TS2305; a drift between it and
 * the rule's parameter fails the `Same` check.
 */
import { shouldCloseOnRelease, type ReleaseMeasure } from './index.js';

type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;

const matchesRuleParameter: Same<ReleaseMeasure, Parameters<typeof shouldCloseOnRelease>[0]> = true;

const measure: ReleaseMeasure = { offsetY: 120, velocityY: 0, height: 400 };

void matchesRuleParameter;
void shouldCloseOnRelease(measure);
