# AUDIT CORRECTIONS for issue #24 (against main 0aede6c); these supersede the issue text where they differ

Issue: phonux-configure-matrix. Verdict: REVISE. Same stale-baseline line fix as #23 ("Code baseline ... locate by symbol, not by line").

## Verified still true
36 = 4 classes x 9 statuses (P, L, K, H, T, C, A, U, F); 127 = 61 + 36 + 20 + 10 (F floor); the scope gate fits Touches (a second mutant spec still matches ^(test|tools)/); LIBRARY_TUNING_DEFAULTS.edgeScroll is {48, 900, 500} (panelSettings.ts:1096), a quarter of zonePx is 12 and still passes integer(8, 200); the four listed mutants are library-source edits mutate-check accepts. Catalog: 61 descriptors (classes NOW 11, NEXT 43, STATE 4, SCOPE 3; doors 3 template, 7 workspace-only, 4 per-panel tuning, 47 instance). differential('NAME' literals exist today only in test/settings-enforcement-permissions.test.ts (14) and test/settings-enforcement-visibility.test.ts (12); test/panel-settings-catalog.test.ts uses recorder.differential(SOME_NAME, which does not collide. #24 adds no library source file and no value export; MIN_LIBRARY_FILES and the barrel are unchanged.

## Corrections (OLD -> NEW)
1. Bullet 5 (root column): the root-forcing C5 rule (panelSettings.ts:1591-1619) forces only parkable, closable, draggable and placeable; `resizable` on the root is forced by C1 with forcedBy 'parkable' (:1602).
   OLD: "Root column for the keys C5 forces (closable, parkable, draggable, placeable, resizable): each asserts settings-conflict on the root (the result's setting is the asked key and its message names rule C5)."
   NEW: "Root column for the keys C5 forces (closable, parkable, draggable, placeable): each asserts settings-conflict on the root (the result's setting is the asked key and its message names rule C5 and has no forcedBy); resizable:true on the root asserts settings-conflict whose message names rule C1 and ends 'because of parkable'."
2. Bullets 3 and 9 (the "probe exists" check is not greppable):
   OLD: "(61 test calls, each named matrix: followed by the catalog name)"
   NEW: "(61 literal test('matrix:NAME', ...) calls written out one by one, the title being matrix: immediately followed by the catalog name with no space and no generated title, so grep finds each)". In bullet 9 keep "every name has a `matrix:NAME` probe" with that definition.
3. Bullet 2: add "each of the 36 cells is its own test() call (a loop that calls test()), so the count C1 reads rises by 36".
4. Bullet 9 vs bullet 11 (bullet 9's "mutant: delete one differential call; red" is not among bullet 11's four mutants; a differential call lives in a test file):
   OLD (bullet 11): "C5 with N = 4 (mutate-check over library source, tests unchanged): a NEXT setting ...; overflow park->scroll parking at configure."
   NEW: "C5 with N = 5 (mutate-check, tests unchanged): a NEXT setting ...; overflow park->scroll parking at configure; one differential('NAME' call renamed to differential('NAME_' in a test .ts file (the S7 sources test goes red)." (Alternative accepted: drop bullet 9's mutant sentence and keep N = 4.)
5. Bullet 9 (the grep scans test/*.test.ts, including the coverage tests themselves): add "settings-coverage-sources.test.ts builds its search string by concatenation (\"differential('\" + name + \"'\") so neither coverage test file contains a literal differential('NAME'."

## Touches additions
tools/mutants/phonux-configure-matrix*.json; test/support/mount-harness.ts (additions only) only if a workspace mount helper is needed; CHANGELOG.md if a user-visible line is warranted (the matrix itself adds none).

## Ordering
#24's tip becomes LIBCOMMIT for #25 (the app gate measures the library at that commit). #26 (tools/ only) and #27 (library source + CHANGELOG.md, DESIGN.md, etc/phonux.api.md) must merge before #24 or be held until after the rc. Order: ... #23 -> #26 -> #27 -> #24 -> app-real-layout-gate -> #25.

## Decisions assumed
Probe titles literal `matrix:NAME`; each of the 36 cells its own test(); the S7 delete mutant counted (N = 5); coverage tests build their search literal by concatenation; root column per correction 1.
