AUDIT CORRECTIONS for issue #13 (against main 0aede6c); these supersede the issue text where they differ

Issue: phonux-retire-max-panels-members. Verdict: REVISE (mechanical, one certain red). 
Order: #9 -> #10 -> #11 -> #12 -> #13 holds; Depends on #9, #10, #11, #12 all exist.

VERIFIED STILL TRUE (relevant to #13)
- `git merge-base --is-ancestor 7a60e82 HEAD` exits 0.
- hostApi.tsx:91-97 (the four members and their docs), :139 (minPanelsOnScreen floor comment), :157, :166, :176-179, :192 (overflow-driven parking comments) are unchanged since the issue was written; `settingsColumn` is the one member kept.
- fakeHost.ts:50-60: settings keys in order maxPanelsOnScreen (:51), fitCount, minPanelsOnScreen (:55), setMaxPanelsOnScreen (:56), settingsColumn (:57): matches P2.
- panelRowLayout.ts:6 and :14 control: `git grep -nE '^[[:space:]]*(/[*][*]|[*]|//).*(computeMaxLiveWidth|PanelRowSlot)' -- panelRowLayout.ts | wc -l` prints 2 at HEAD; panelRowLayout.ts:33 and test/panel-layout.test.ts:3 ("SettingsAPI's fitCount") are unchanged.
- tools/phonux-pack-smoke.mjs:86 `storedMaxPanels: null` in CONSUMER_TSX; the smoke has 8 checks ('(1)'..'(8)'), so "8/8 checks passed" holds.
- test/compat-0.1.0.typecheck.ts has the four Host members at :37-40 (plus settingsColumn :41) and `storedMaxPanels: null` at :49.
- test/panel-manager-collapse-decisions.test.ts has the test 'effectiveMaxPanels: a stored value between the floor and the fit count passes through unchanged' (line 38): the D = 1 deletion exists. panelCapacity.ts has the three-argument effectiveMaxPanels; P1 values check out ((3, null, 2) Infinity; (null, 5, 2) 5; (5, 3, 2) 3; (1, 1, 3) 4).
- The compat corpus does not replay effectiveMaxPanels (tools/gen-compat-corpus.mjs:27 says it is absent by design).
- CHANGELOG Unreleased has exactly three top-level Removed bullets; tests are built through `panelsInput` and `usePanelManagerWith` except for the one source-invariants line below.
- Barrel is untouched by #13 (stays whatever #12 leaves, 55); no value or type export changes; MIN_LIBRARY_FILES untouched.

(1) STALE OR WRONG REFERENCES
- DESIGN.md:241 (`SettingsAPI.fitCount`) is now DESIGN.md:264.
- panels/useProvidePanels.ts:51, :80, :82 are now :59, :106, :108. `storedMaxPanels` is at :54 and the usePanelManager call at :149.
- etc/phonux.api.md lines 366 and 523-526 (at 7a60e82) are now :547 and :910-913. etc/phonux-testing.api.md:187-190 is unchanged.
- Bullet 3's parameter list "(panels, setPanels, phoneWidth, containerWidth, fixedColumnCount, rootId)" omits the trailing `options?: PanelManagerOptions` that #9 added.
- Bullet 9 says `git grep -nE 'storedMaxPanels' -- test ':!test/compat-0.1.0.typecheck.ts' ':!test/fixtures' ':!test/pins-retire-max-panels.test.ts'` before this entry "prints only lines of test/support/mount-harness.ts". It is false at HEAD. It also prints test/source-invariants.test.ts:258, so the control is 2 lines (mount-harness.ts:97 and source-invariants.test.ts:258). Bullet 4's retired-surface grep also hits that line, so it cannot print nothing unless that file is edited.

(2) NUMBERS
- The C5 count N = 3 matches its 3 listed mutants (effectiveMaxPanels returns fitCount for null; floors at literal 2; fake host regains maxPanelsOnScreen).
- F = 3 (4 new tests minus 1 deleted, D = 1) is fine. 8/8 smoke checks is fine. The three Removed bullets in CHANGELOG are fine.

CORRECTED COUNTS FOR #13
- Mutants: N = 3 (unchanged).
- Barrel: unchanged by this entry (no value export changes; test/phonux-barrel.test.ts has an empty diff; it stands at 55 after #12).
- MIN_LIBRARY_FILES: unchanged (no new root file; test/boundary.test.ts has an empty diff).
- Control count for bullet 9's storedMaxPanels grep before this entry: 2 lines (test/support/mount-harness.ts:97 and test/source-invariants.test.ts:258) at 0aede6c; 0 after.

(3) TOUCHES COMPLETENESS: test/source-invariants.test.ts is MISSING and is a certain red.
- Its test at :251-261 ("usePanelManager takes its new inputs in one optional trailing options object, so the harness call with seven arguments still typechecks") asserts the parameter names include 'storedMaxPanels', that `params[7]` is optional and that `params.slice(0, 7)` have no question tokens.
- Removing the parameter fails it. Bullet 9's removed-lines allow-list must name it.
- CHANGELOG.md and DESIGN.md are listed and forced (DESIGN.md:264). A second mutant spec is not needed.

TOUCHES ADDITIONS FOR #13
- test/source-invariants.test.ts

(4) OVERLAP AND ORDERING
- Fine after #10, #11 and #12, which touch the options object and callers only through the helpers (#10 and #11 add no positional parameter).
- #13's grep of test/ is clean once #10-#12 are merged, apart from source-invariants.

(5) NOTES
- Bullet 6's "keeps every case whose first argument was null or whose stored argument can simply be dropped" is judgement-laden for the case [1, 4, 2] (dropping stored changes the expected value 2 to 4); the worker records which cases stay in the handoff as the bullet already requires.

TEXT CORRECTIONS for #13 (OLD -> NEW)

C13-1 Touches. Add `- test/source-invariants.test.ts`.

C13-2 Bullet 3.
- OLD: "(panels, setPanels, phoneWidth, containerWidth, fixedColumnCount, rootId)"
- NEW: "(panels, setPanels, phoneWidth, containerWidth, fixedColumnCount, rootId, options?: PanelManagerOptions)".
- Append: "test/source-invariants.test.ts:251-261 is retargeted: title 'seven arguments' -> 'six', the names array loses 'storedMaxPanels', `params[7]` -> `params[6]`, `slice(0, 7)` -> `slice(0, 6)`, and its messages say six."

C13-3 Bullet 4.
- OLD: "panels/useProvidePanels.ts:51, :80 and :82 and DESIGN.md:241" -> NEW: "panels/useProvidePanels.ts:59, :106 and :108 and DESIGN.md:264".
- Add the code line "test/source-invariants.test.ts:258" to the list of things the implementer will meet.

C13-4 Bullet 8.
- OLD: "etc/phonux.api.md lines 366 and 523-526, etc/phonux-testing.api.md lines 187-190 at 7a60e82"
- NEW: "etc/phonux.api.md lines 547 and 910-913, etc/phonux-testing.api.md lines 187-190 at 0aede6c".

C13-5 Bullet 9.
- OLD: "test/panel-manager-collapse-decisions.test.ts, test/panel-layout.test.ts's header comment, test/compat-0.1.0.typecheck.ts and test/support/mount-harness.ts"
- NEW: "test/panel-manager-collapse-decisions.test.ts, test/panel-layout.test.ts's header comment, test/compat-0.1.0.typecheck.ts, test/support/mount-harness.ts and test/source-invariants.test.ts (the one parameter-list test)".
- OLD: "prints only lines of test/support/mount-harness.ts before this entry (control, above 0)"
- NEW: "prints only lines of test/support/mount-harness.ts and test/source-invariants.test.ts before this entry (control: 2 lines at 0aede6c)".

DECISIONS ASSUMED (open decisions the corrections above encode; the coordinator may overrule any)

None are open. Two assumptions, both mechanical:
D1. test/source-invariants.test.ts is edited in place (the same test, retargeted to six positional parameters plus the optional options object), not deleted and not renamed away from its purpose, in keeping with "a flipped pin is renamed, never deleted".
D2. The etc/ line numbers in bullet 8 are quoted at 0aede6c; a verifier may equally read them at 7a60e82 with the old numbers, since both are labelled with their revision.
