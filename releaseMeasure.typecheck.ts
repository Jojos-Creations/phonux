/**
 * Compile-only: the barrel exports `ReleaseMeasure`, `shouldCloseOnRelease`'s parameter type. Dropping it fails
 * here with TS2305, and a drift from that parameter type fails `Same`. Nothing imports this file; `npm run typecheck`
 * checks it as a root file.
 */
import { shouldCloseOnRelease, type ReleaseMeasure } from './index.js';

type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;

const matchesRuleParameter: Same<ReleaseMeasure, Parameters<typeof shouldCloseOnRelease>[0]> = true;

const measure: ReleaseMeasure = { offsetY: 120, velocityY: 0, height: 400 };

void matchesRuleParameter;
void shouldCloseOnRelease(measure);
