AUDIT CORRECTIONS for issue #15 (against main 0aede6c); these supersede the issue text where they differ

Issue: phonux-row-numbers-and-overflow. Verdict: REVISE. Read-only audit; nothing in the repo, issue or PR was edited.

## 1. Cited references: stale or wrong, and verified

Stale or wrong:
- Bullet 6: `git grep -c 'always' -- test/row-shell-style.test.ts` prints 2 at 7a60e82, at 5208aa4 and now, not 1. The two lines are the header (line 3) and the test title (line 26).
- Bullet 10: hostApi.tsx comment lines 157, 166, 177 and 192 are unchanged (hostApi.tsx has no commits since 7a60e82). The bullet promises "their first words" but never names them.
- Bullet 3: the dangling "(3.6)" is a design citation with nothing to resolve it against.

Verified, no change needed:
- Bullet 14: `git grep -n -w computeMaxLiveWidth -- panels/usePanelManager.ts panels/useProvidePanels.ts` still prints 4 lines (usePanelManager.ts:14 and :123, useProvidePanels.ts:12 and :133).
- Bullet 4: container 1000, History plus ten 390s gives maxLiveThatFit 1 and computedRowMarginLeft 86 (re-derived from computeRowLayout).
- Literals re-derived and correct: 4450, 968, 3482, 406k, 1174, 206, 1374, 406 (desktop case), 796 with margin 86, 1202 with 234; bullet 14's 1000/968/920 versus 610/562/490; bullet 9's 1624.
- F = 31 equals 10 + 8 + 2 + 5 + 2 + 3 + 1 (BASE-relative).
- computeMaxLiveWidth is not in index.ts (test/compat-0.1.0.test.ts HIDDEN_VALUES guards it), so "import by relative path" holds.

## 2. Numbered OLD -> NEW corrections

1. Bullet 6, control count.
   OLD: "prints 0 afterwards and 1 at 7a60e82"
   NEW: "prints 0 afterwards and 2 at 7a60e82 and at 0aede6c (header line 3 and test title line 26; the renamed title carries neither 'always' nor 'no scrollbar')"

2. Bullet 13, mutant count.
   OLD: "C5 with N = 8:" followed by the 8-item list
   NEW: "C5 with N = 10:", with two items appended: "maxLiveWidth applied to every tier; maxLiveWidth applied to no tier". These are bullet 5's two tier mutants, which it says "each turns one of the two cases red". (Alternative: reword bullet 5 to "scratch copies, not descriptor entries" and keep N = 8; the recommended rule is N = 10.)

3. Touches additions (see section 3).

4. Bullet 12, append (CHANGELOG evidence).
   NEW (append): "CHANGELOG.md's Unreleased gains under Added: computeRowNumbers and RowNumbers, PanelsInput.workspaceDefaults, ProvidedPanels.rowScroll and rowNumbers, the Workspace props rowScroll and rowNumbers, PanelRow's rowNumbers, RowLayoutInput.reservedWidths. Under Changed it gains: an entry that carries settings scrolls instead of parking unless its overflow is 'park'; park exits start from the panel's rest; a hand-built row is unchanged. Added lines only: `git diff -U0 CHANGELOG.md | grep '^-' | grep -vc '^---'` prints 0."

5. Bullet 2, after the rowScroll definition (the legacy-History trap).
   NEW (insert): "rowScroll reads `p.settings?.overflow === 'scroll'`, never `effective(p).overflow`: a legacy fixed History is 'scroll' under effective() (panelSettings.ts:1745), so that would make every legacy row scroll. The park/reserved split reads effective(p).overflow: an entry without settings is reserved when not collapsible and park when collapsible, as in 0.1.0."
   Today's text says only "carries settings whose overflow is 'scroll'", which an implementer can misread.

6. Bullet 7, hide and show.
   OLD: "(create, activate, resize, close, undo, drag, hide, show)"
   NEW: "... drag is PanelsAPI.move; hide is a create under workspaceDefaults { startVisibility: 'parked' } (added parked and held); show is activate of that id, which releases the hold. ProvidedPanels exposes no holdPanel at this entry."
   Reason: useProvidePanels's `api` object has neither a hide nor a show verb (holdPanel is on the manager result only).

7. Bullet 8, the all-park claim and missing literals.
   OLD: "an all-park row with History fixed gives exactly the 0.1.0 results (test/panel-manager-collapse-decisions.test.ts, already in its two-argument form, passes with its expectations unchanged and no edit in this entry)"
   NEW: "... that file tests only the pure effectiveMaxPanels, so it cannot show the manager unchanged. The proof is a pin committed first and green at BASE: useProvidePanels at containerWidth 1000, phone 390, History fixed, three legacy creates leave live ids [root, last created]. The same pin stays green afterwards, and the compat corpus's computeRowLayout and computeMaxLiveWidth cases pass unchanged."
   Bullet 8 also has no literal capacity numbers for a mixed row. Hand-derived from computeRowLayout, to be confirmed on the BASE run:
   - root (scroll) plus park panels: reserved [390], budget 968 - 390 = 578, one park panel fits (406), capacity 1.
   - root plus one scroll panel plus park panels: reserved [390, 390], budget 968 - 796 = 172, maxLiveThatFit 0, and the existing floor keeps capacity 1.

8. Bullet 10, name the four comments.
   OLD: "(hostApi.tsx:157, :166, :176-179 and :192 at 7a60e82; the retire entry removes lines 91-97, so a test finds them by their first words, not by line)"
   NEW: "(PanelsAPI.create's 'Appends a live panel', activate's 'Make a panel live in place', setFormFactor's 'Resizes `id` to `next`'s tier' and undoClose's 'Undo every close in `recentlyClosed`'; lines 157, 166, 177 and 192 at 0aede6c; the retire entry removes lines 90-97, so a test finds each by those first words)"

9. Bullet 6, CSS strings and how to read them.
   OLD: "contains scrollbar-width: none and a webkit scrollbar rule"
   NEW: "contains `scrollbar-width:none` and a `::-webkit-scrollbar` rule with `display:none`. Emotion emits declarations without spaces; see test/fixtures/panel-row-golden/*.html."
   ADD: "Read the stylesheet from renderToStaticMarkup with createCache({ key: 'css' }) as test/panel-row-golden.test.ts does." No test in test/ reads emitted CSS from a jsdom document today, and a static-markup test must not import jsdom-globals.ts.
   ALSO: "the scaffold's golden" is PanelRow-only (three fixtures: root-only, root-two-live, root-live-parked). It cannot prove the legacy Workspace container unchanged, so the bullet-4 pin must carry its own literal.

10. Bullet 6, margin.
    ADD: "workspaceShellStyle's marginLeft equals rowNumbers.rowMarginLeft when rowNumbers is passed (0 for the eleven-panel numbers, 86 for the two-panel numbers)."
    Today the four shell cases pin only overflowX and hideScrollbar; mutant 4 is only reachable through computeRowNumbers.

11. Bullet 4, third pin.
    OLD: "a park exit target is x -ownSpan"
    NEW: "the left park exit is { x: -ownSpan, opacity: 0 }: panelRowSlotMotion(0, 390, 700, 'right', 'left').exit at 0aede6c, or parkExitTarget(rest, ownSpan, 'left', false) once the keepMounted entry has extracted it"
    The function name is unspecified once #12 merges.

12. Bullet 1, boundary floor.
    OLD: "raise MIN_LIBRARY_FILES in the same commit"
    NEW: "raise MIN_LIBRARY_FILES by 1 in the same commit (floor = .ts/.tsx files directly in root and panels/ minus 1, and the comment's count updated; expected 40 files and floor 39 once #10 and #11 each add one root file; recount with `ls *.ts *.tsx panels/*.ts | wc -l`)"

13. Bullet 1, options object.
    OLD: "(the first entry that needs one creates it; later entries add optional fields)"
    NEW: "(PanelManagerOptions in panels/usePanelManager.ts already exists with onNote and tuning; add optional fields to it)"
    The #9 merge created it.

14. Bullet 3: delete the dangling "(3.6)" design citation.

15. Bullet 12, source invariants. Append:
    NEW (append): "test/source-invariants.test.ts: COLLAPSIBLE_READERS (lines 211-215) gains the names of any new function in panelWindow.ts, panels/usePanelManager.ts or panels/useProvidePanels.ts that reads `.collapsible` (the park-role filter is one). That is the only edited expectation and is named in the handoff. Add a new test that rowNumbers.ts imports no flushSync, with a planted-import control: no flushSync check exists at 0aede6c, so 'a planted import turns the source check red' has nothing to turn red."

16. Bullet 11 and F (if decision D1 below is adopted; it is the recommended rule).
    ADD a fourth case: "entries restored by useWorkspacePersistence carry settings from workspaceDefaults when it is passed and keep their restored live, anchor, formFactor, size, listed and layer; without it they stay as hydrate builds them."
    Change "bullet 11 3" to "bullet 11 4" and F from 31 to 32.

## 3. Touches additions

- `CHANGELOG.md`
- `tools/mutants/phonux-row-numbers-and-overflow*.json` in place of the single path `tools/mutants/phonux-row-numbers-and-overflow.json` (mutate-check demands applied == planned == red == N, so a verifier-added strength spec needs its own file; #9 shipped a main spec, `-latch` and `-strength`)
- `panels/useWorkspacePersistence.ts` (if D1 is adopted)

DESIGN.md is already listed and is forced by bullet 10 (width paragraph, DESIGN.md "The fit cap" section, lines 232-246).

## 4. Corrected counts

- Mutants (C5): N = 10 (the 8 listed in bullet 13 plus the two tier mutants of bullet 5).
- MIN_LIBRARY_FILES (test/boundary.test.ts:21; convention since 46960d3 and ac400a1: floor = file count minus 1, comment records the file count):
  - At 0aede6c: 37 files (32 root, 5 in panels/), floor 36.
  - After #10 (+panelPlacement.ts) and #11 (+panelTuning.ts): 39 files.
  - After this entry (+rowNumbers.ts): 40 files, floor 39. Recount with `ls *.ts *.tsx panels/*.ts | wc -l` and use that minus 1.
  - #12 and #13 add no root file.
- Barrel: this entry asserts 'the phonux barrel exports exactly the 56 runtime values, no more, no fewer' (55 + 1). Chain: 51 now (counted 51 list entries), #11 -> 54 (usePanelTuning, usePanelReorderSteps, slideToTransition), #12 -> 55 (usePanelHidden), #15 -> 56 (computeRowNumbers). The barrel test's VALUE_EXPORTS gains 'computeRowNumbers'.
- C1: F = 32 if correction 16 is adopted (31 otherwise); BASE-relative.

## 5. Cross-issue findings that apply to #15

- A1 (restored entries are legacy). hydrateWorkspaceState (workspaceState.ts:121-149) builds entries through appendPanel with no settings; effective() makes a collapsible legacy entry overflow 'park' (panelSettings.ts:1745). #15 bullet 11 covers ProvidedPanels.create only, so the cascade never reaches restored entries. #16 bullet 11 depends on a restored eleven-panel scroll row that cannot otherwise exist (nine of ten would park at container 1000). Recommended fix lives here in #15: corrections 16 and Touches addition above.
- A2 (#13 incomplete). test/source-invariants.test.ts:251-261 asserts the usePanelManager parameter names with 'storedMaxPanels' at index 2 and "the seven positional parameters". #13 removes that parameter, so the test goes red, and `git grep -nE storedMaxPanels -- test` (minus the exclusions) prints source-invariants.test.ts:258 as well as test/support/mount-harness.ts:97, contradicting #13 bullets 4 and 9. #15 depends on #13. Fix on #13: add `test/source-invariants.test.ts` to Touches and a bullet retargeting that test (six positional parameters, then `options`). #15 bullet 1's "mount-harness.ts's fixed call keeps typechecking" holds only after that.
- B1 CHANGELOG.md missing from Touches (applied above).
- B2 second mutant spec forced (applied above; N mismatch is 8 vs 10).
- B3 MIN_LIBRARY_FILES arithmetic (applied above).
- B4 barrel counts consistent (applied above).
- B5 test/rowconstants-drift.test.ts:97 pins rowConstants.ts at exactly 17 exports; if this entry adds a constant there, the count test and the "no dead constant" test go red, and neither file is in Touches. Keep new numbers local to the new files.

## 6. Overlap with #10 (worker active in wt-engine-placement)

- Both touch PanelRow.tsx, PanelRowSlot.tsx, panelWindow.ts, panels/usePanelManager.ts, panels/useProvidePanels.ts, panelSettings.ts, test/source-invariants.test.ts, test/boundary.test.ts, DESIGN.md and etc/*.api.md. Serial order (#10 first) makes that safe.
- #10 bullet 1 requires test/row-shell-style.test.ts to be additions-only. #15 later renames that file's title and header, which removes lines. That is the intended order, not a conflict.
- #10's marker numbers match #15 bullet 5 ([0, 406], 796, margin 86).
- #10's `isPresent` is what #15's computeRowNumbers imports from panelRowEntry.ts, so panelRowEntry.ts needs no edit here.

## 7. jsdom feasibility

All of these are producible without a layout engine: the pure numbers (bullet 5), the static-markup CSS reads (bullet 6), `ProvidedPanels` and `useProvidePanels` mounts (bullets 7 and 14), the exit targets (bullet 9) and the workspaceDefaults path (bullet 11). The scrollLeft reset needs the test to set `scrollLeft` first: jsdom stores it as a plain unclamped property (Element-impl.js:73-74). scrollWidth 4482 and "above clientWidth" stay with the real-layout gate, as the bullet already says.

## 8. Decisions assumed

D1. Restored entries (A1). Rule: `useProvidePanels` passes `useWorkspacePersistence` an optional per-entry decorator (for example `decorateRestored?: (p: PanelWindow) => PanelWindow`), supplied only when PanelsInput.workspaceDefaults is passed. `useWorkspacePersistence` applies it in the same map that already applies defaultHostData (useWorkspacePersistence.ts:49-52). The decorator resolves resolvePanelSettings with workspace layer = workspaceDefaults and a host layer carrying the entry's restored listed, layer and formFactor (and parkable = the entry's collapsible, so a restored permanent column stays collapsible:false; confirm 'parkable' is accepted as a host-layer key by the resolver), then calls applyTemplate(entry, resolved.value, 'reconfigure'). 'reconfigure' never writes formFactor, size, anchor, live, hostData or key, so those stay as restored; it writes no `key`, and a restored entry has none (readers use `p.key ?? p.id`; test/source-invariants.test.ts:190-193 allows `key` to be written by applyTemplate's create branch only). Without workspaceDefaults the entries stay exactly as hydrate builds them. Add the case "a restored permanent column stays collapsible:false and live" to bullet 11.
D2. Mutant count. N = 10 for #15, with bullet 5's two tier mutants added to bullet 13's list; the verifier may add strength mutants in a second spec file covered by the `tools/mutants/phonux-row-numbers-and-overflow*.json` Touches glob, each spec run with its own `--planned`.
D3. MIN_LIBRARY_FILES. Floor = .ts/.tsx file count (root plus panels/) minus 1, comment count updated, raised by exactly the number of new root files; 39 for #15 under the assumed order.
D4. CHANGELOG. Added and Changed lines are required evidence for any user-visible change, with CHANGELOG.md in Touches, added lines only.
D5. hide and show in the 500-sequence test. hide is a create under workspaceDefaults { startVisibility: 'parked' }; show is activate of that id.
D6. rowScroll reads `p.settings?.overflow`; park/reserved role reads effective(p).overflow.
D7. CSS assertions. Read emitted stylesheet text from renderToStaticMarkup with a fresh emotion cache, compact form (`scrollbar-width:none`), not from a jsdom document.
D8. Not applicable to #15: frame length (#17) and the animate observation (#17).
