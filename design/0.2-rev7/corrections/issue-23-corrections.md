# AUDIT CORRECTIONS for issue #23 (against main 0aede6c); these supersede the issue text where they differ

Issue: phonux-panel-configure. Verdict: REVISE.

Stale line in every issue: OLD "Code baseline: phonux-lib main at 5208aa4." -> NEW "Code baseline: phonux-lib main at 5208aa4 as read by the design; line numbers in the design's section 2 and the catalog's enforced_by cells date from that commit and have moved, so locate by symbol, not by line."

## Verified still true
usePanelClosing.ts, usePanelManager.ts, panelSettings.ts exist; applyTemplate at panelSettings.ts:1775 (its 'reconfigure' branch writes locked, collapsible (only if changed), listed, layer, anchoredEnter, title, settings; leaves formFactor, size, anchor, live, hostData, key alone); forcedMessage format (panelSettings.ts:1635) yields "... C2 makes it false because of closable" and "... C6 ... because of viewState"; view-settable set equals the catalog's six (title, listed, layer, formFactor, placeOnAdd, enterFrom); doors are 3 template, 7 workspace-only, 4 per-panel; InstancePatch in settingsPatch.ts; SettingNote matches bullet 1; PanelState.deferredPin exists; refusal codes wrong-scope, not-view-settable, settings-conflict, tier-not-allowed, instance-limit, busy, would-reshape-row and thrown codes invalid-settings, unknown-template exist in panelManagerError.ts; closing.current at dragToClose.tsx:81; overrides, applied, deferredPin come from #18 and #21; barrel stays at 60 (untouched title and list, correct); N = 8 matches its eight mutants; F = 94 floor stays.

## Corrections (OLD -> NEW)
1. Bullet 10 ("the configure files" is undefined; panels/usePanelManager.ts:11 and panels/usePanelClosing.ts:2 import flushSync today and are in Touches).
   OLD: "source-invariants asserts no flushSync import in the configure files (planted import: red)"
   NEW: "source-invariants asserts no flushSync import in panelConfigure.ts, panelPin.ts, panelManager.ts, panelHandles.ts and workspaceCore.ts (not in panels/usePanelManager.ts or panels/usePanelClosing.ts, which import it today for the park exit and the close exit; planted import in a scratch copy: red)"
2. Bullet 1 (C4 requires signature changes to be named): add "the api-report diff shows the type ConfigureResult, configure(patch: ViewPatch) on ViewHandle, configure(patch: InstancePatch) on PanelHandle, configure(id, patch), configureTemplate(templateId, patch) and configureTuning(patch) on PanelManager, and nothing else."

## Touches additions
- CHANGELOG.md (append to the existing `### Added`; no second heading).
- tools/mutants/phonux-panel-configure*.json (further mutant specs, each with its own --planned).
- The test file in which #20 asserts Object.keys of the ViewHandle (probably test/panel-manager-operations.test.ts; #21 adds pin and unpin there): this entry adds `configure`, so the literal key list is edited here. (#22 compares against the view's own handle, so it needs no edit.)
- panelTemplate.ts only if `type ViewHandle` is still declared there (panelTemplate.ts:54 today, `ViewHandle = PanelReadHandle`); verify at accept with `git grep -n "type ViewHandle"`; if moved to panelHandles.ts add nothing.
- MIN_LIBRARY_FILES: relative raise (two new root files panelConfigure.ts and panelPin.ts per the issue), floor = file count minus 1; recount with `ls *.ts *.tsx panels/*.ts | wc -l`.

## Counts
Mutants N = 8 (tools/mutants/phonux-panel-configure.json); F = 94 floor; barrel stays at 60.

## Overlap
#10 and #23 share panelSettings.ts, usePanelManager.ts, useProvidePanels.ts, PanelRow.tsx, test/source-invariants.test.ts, test/boundary.test.ts, etc, DESIGN.md: serial. #10's invariant at source-invariants.test.ts:52-60 needs the single-line `zIndex={` and `enterDirection={` findable by lines.find; #23 does not edit those lines. #27 overlaps #23 only on etc/phonux.api.md, DESIGN.md and CHANGELOG.md (serial).

## Decisions assumed
flushSync scan scope = exactly the five files in correction 1; api-report diff = exactly the list in correction 2; ViewHandle literal-key test edited here; panelTemplate.ts decided at accept; CHANGELOG.md and the mutant glob are legitimate Touches additions.
