AUDIT CORRECTIONS for issue #21 (against main 0aede6c); these supersede the issue text where they differ

Verdict: REVISE. Text-only corrections; no re-scoping, no split. Read-only audit (no npm run, no queue or gh write verb).
Issue: #21 (pin, unpin, deferred pins, resetLayout).
Ledger: .coordinator/ledger.jsonl does not exist, so no calibration was available.

## 1. Numbered OLD -> NEW corrections

(The mutant-count and flushSync corrections the report gave under Numbers and Touches are lettered A and B so the report's numbering 1-3 is unchanged.)

A. Mutant count N is wrong. Bullet 9 names "mutant: live not normalised", which is not in the list of nine.
   - OLD (bullet 14): "C5 with N = 9: isPinned reads a stored flag; unpin places before it frees; pin applies parkable before the placement check; pin() records no follow request; a deferred pin skipped by an automatic return; deferredPin not cleared by a live pin(); reset leaves overrides.parkable in the file; reset leaves deferredPin; a code pin recorded as the person's."
   - NEW: "C5 with N = 10: [the nine as written]; a deferred parkable:false applied through open() or undo leaves live false (live not normalised). The specs are tools/mutants/phonux-pin-and-reset*.json."

B. Bullet 8's "no flushSync import in the new files (a planted import turns the source check red)" presupposes a check that does not exist in the tree. #16 creates one for "the new scroll files".
   - Add to bullet 8: "extend the flushSync import check of test/source-invariants.test.ts (created by the scroll entry for its files) to panelPin.ts, panelReset.ts, panelManager.ts and panelHandles.ts".

1. An undefined member. Bullet 5 requires "the result's setting is 'resizable'". `PanelResult` (#20) has no `setting`; `ConfigureResult.setting?` appears only in #23.
   - OLD (bullet 2): "`PinResult = PanelResult & { shown?: boolean; deferred?: boolean }`"
   - NEW: "`PinResult = PanelResult & { shown?: boolean; deferred?: boolean; setting?: CatalogName }` (setting is the catalog name of the offending key on a settings-conflict refusal, with the same meaning as ConfigureResult.setting in the configure entry)"
   - Alternative: delete "and the result's setting is 'resizable'" from bullet 5.

2. Bullet 10 needs the call shape. It says "adds those callers to recordOverride ... key 'parkable' with the pinned panel's id". After #18's fix (item 2 of #18) the signature is `recordOverride(entries, key, ids, rootId)`.
   - Add "(pass the provider's rootId)".

3. Hook inputs. Add "New usePanelManager inputs go in PanelManagerOptions (test/source-invariants.test.ts:251 pins the parameter list)".

Optional (not a defect): bullet 1 may say `deferredPin?: DeferredPin`, reusing the type already declared in panelTemplate.ts as exactly `{ by: 'pin' | 'unpin' } | { parkable: boolean }`, instead of re-inlining it.

## 2. Touches additions (summary)

- ADD `test/panel-manager-operations.test.ts`: #20's Object.keys(ViewHandle) assertion gains `pin` and `unpin` here (16 keys sorted: id, templateId, getState, getSettings, subscribe, show, hide, toggleVisibility, close, open, move, place, setFormFactor, scrollTo, pin, unpin).
- ADD `CHANGELOG.md`.
- ADD `DESIGN.md`.
- ADD the mutant glob `tools/mutants/phonux-pin-and-reset*.json`.
- ADD (via correction B) the flushSync-check extension in test/source-invariants.test.ts (already a Touches file for #21 on the boundary/source-invariants overlap).

## 3. Corrected counts

- Mutants: N = 10 (was 9; correction A).
- F = 82 is not checkable now: it is BASE-relative and depends on earlier entries; the worker measures BASE at its own entry with tools/testcount.sh and asserts AFTER >= BASE + F.
- Barrel: #21 adds no runtime value; stays at 60 after #19 (chain 51 -> 54 -> 55 -> 56 -> 60; #22 +2 -> 62).
- MIN_LIBRARY_FILES: 36 today over 37 files; floor = files - 1, comment "(N files when raised)". #21 adds panelReset.ts (+1). (panelPin.ts, panelManager.ts and panelHandles.ts are named in bullet 8; raise by however many of them are new at that commit.) The issue states no absolute number; worker computes it.
- KNOWN-BAD: not touched by #21. After #20 the grep prints 1 (KNOWN-BAD:4) and the LIMIT:3 grep prints 1.
- api-report: PinResult gains `setting?: CatalogName` (correction 1); `DeferredPin` is already exported.

## 4. Section-0 facts that apply to this issue

- usePanelManager's parameter list is pinned at test/source-invariants.test.ts:251 (eight names: panels, setPanels, storedMaxPanels, phoneWidth, containerWidth, fixedColumnCount, rootId, options). New inputs go into `PanelManagerOptions`, not a ninth positional parameter. #21 edits usePanelManager.ts without saying so.
- COLLAPSIBLE_READERS allow-list (test/source-invariants.test.ts:211) scans only panelWindow.ts, panels/usePanelManager.ts and panels/useProvidePanels.ts. pin()/unpin() read the parkable value (`.collapsible`); a read added in those three files needs an entry by function name in the same commit; reads in panelPin.ts are not scanned.
- The flushSync import check is not in the tree today (no flushSync check exists yet in test/source-invariants.test.ts); #16 creates it, #21 extends it (correction B).
- The four tests that pin panels/useWorkspacePersistence.ts (source-invariants.test.ts:244-248; rowconstants-drift.test.ts:59-63, incl. the `500` ban) are not touched by #21 unless it edits that hook; if it does, keep those lines verbatim.
- Pins named KNOWN-BAD:n are renamed, never deleted. KNOWN-BAD:4 (test/pins-visibility.test.ts:65) is not flipped by #21 or any other plan issue.
- Precedent: #8 and #9 committed CHANGELOG.md; #9 edited DESIGN.md outside its Touches; verifiers added mutant specs, so use a glob.
- Differential file name matches: OWNER_TABLE test/panel-settings-catalog.test.ts:~92 and #24 agree with `panel-pin` (pinning and pinningWhenNotLive are catalog names owned by this entry).

## 5. Citations that hold

`PinningWhenNotLive` (panelSettings.ts:100, exported). `DeferredPin` is already declared in panelTemplate.ts. `PanelRefusal` lacks 'no-room', so the type probe works; it includes would-reshape-row, settings-conflict, tier-not-allowed, not-placeable, is-pending, is-closed and busy. C1 forces `resizable` false with rule 'C1' and forcedBy 'parkable', as bullet 5 says. The default pinning is `{ pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } }`. `LIBRARY_PANEL_DEFAULTS.scrollOnMove` is 'follow'. `releaseHold` exists. The scroll numbers (left 4076, scrollLeft 3482, left 16) match #16's eleven-panel row. `resetLayout` fits the existing code paths: `scrollRow` (the row gesture), `revealMostRecentlyCollapsed` (automatic return), `handleActivatePanel` (History click) and the usePanelClosing undo, all in Touches.

## 6. Overlap and ordering with #10's Touches

Shared files: panelWindow.ts, usePanelClosing.ts, usePanelManager.ts, useProvidePanels.ts, boundary and source-invariants. All ordered. #21 only consumes `placePanel` from #10.

## 7. Decisions assumed

- N = 10: "live not normalised" is a real mutant (a deferred parkable:false applied through open() or undo leaves live false) and joins the list; the alternative of dropping the "mutant:" wording would keep N = 9 but loses a pinned-behaviour check.
- PinResult gains `setting?: CatalogName` (rather than dropping the "setting is 'resizable'" assertion). The coordinator may pick the drop alternative; either removes the undefined member.
- The `deferredPin?: DeferredPin` reuse is optional; the inlined union is identical to the declared type.
- The flushSync check exists after #16 (the scroll entry creates it for its files); #21 extends the file list instead of creating a second check. If #16 does not create it as assumed, #21 must create it.
- pin/unpin join the ViewHandle only in #21; the 16-key list is what test/panel-manager-operations.test.ts asserts at #21's end.
- F = 82 is accepted as written; it cannot be checked now (BASE-relative).
- recordOverride's 4th parameter `rootId` comes from #18 correction 2; #21's callers pass the provider's rootId.
- No absolute MIN_LIBRARY_FILES value is asserted because the issue states none.
- The hook-text pins are kept verbatim if the hook is touched.
