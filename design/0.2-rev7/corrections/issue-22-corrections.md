AUDIT CORRECTIONS for issue #22 (against main 0aede6c); these supersede the issue text where they differ

Verdict: REVISE (header buttons as generic slots, id phonux-header-buttons)

## Cross-issue facts that apply

- Barrel chain verified against history: 43 at 7a60e82 and 5208aa4, 50 at f54af0d (#7), 51 at 4952555 (#8, adds usePanelCapabilities), still 51 at 0aede6c (#9 added no value export). The chain 51 -> 54 (#11) -> 55 (#12) -> 56 (#15) -> 60 (#19) -> 62 (#22) holds; #22's "60 + 2 = 62" is correct.
- Catalog: 61 descriptors (test/panel-settings-catalog.test.ts; DESIGN.md:1029 `<!-- catalog:start -->` to :1093 `<!-- catalog:end -->`, 61 rows). The 13 ownerEntry ids equal the `id:` lines of #8-#12, #15-#22.
- MIN_LIBRARY_FILES is 36 now with 37 source files (32 root + 5 in panels/); convention is floor = file count - 1. "MIN_LIBRARY_FILES +1" is relative and correct (panelHeaderButtons.tsx is the one new root file).
- `differential('NAME'` literals exist today only in test/settings-enforcement-permissions.test.ts (14 names) and test/settings-enforcement-visibility.test.ts (12 names).
- Stale line in every issue: "Code baseline: phonux-lib main at 5208aa4." Replace, in the Research / Local insights bullet:
  - Old: `Code baseline: phonux-lib main at 5208aa4.`
  - New: `Code baseline: phonux-lib main at 5208aa4 as read by the design; line numbers in the design's section 2 and the catalog's enforced_by cells date from that commit and have moved, so locate by symbol, not by line.`
- #10 overlap: #10 and #22 both touch PanelRow.tsx, panelSettings.ts, panels/usePanelManager.ts, panels/useProvidePanels.ts, test/source-invariants.test.ts, test/boundary.test.ts, etc/*.api.md and DESIGN.md. All serial (#22 is after #10), so these are ordering information, not collisions. #10 retargets the invariant at test/source-invariants.test.ts:52-60 and requires the single-line `zIndex={` and `enterDirection={` patterns to stay findable by `lines.find`; #22 edits PanelRow.tsx (the PanelSlotContext.Provider is at PanelRow.tsx:170) after #10 lands and must keep those lines as they are (see correction 5).

## Still true (verified against the code)

- Panel.tsx, PanelFrame.tsx, PanelRow.tsx, panelSettings.ts, panels/useProvidePanels.ts, panels/usePanelManager.ts exist. panelManager.ts and panelHandles.ts exist only after #19 (created there).
- The dimmed placeholder PLACEHOLDER_ACTIONS (data-header-placeholder-action) is at PanelFrame.tsx:196-204; `isEmptyHeaderContent` makes an undefined `actions` render it.
- The four Panel goldens exist at test/panel-header-golden.test.ts:29, :33, :37, :41 with fixtures test/fixtures/panel-header-golden/{no-title,title,title-actions,title-grab}.html. The "no-actions golden" is title.html.
- The allow-list is `COLLAPSIBLE_READERS` at test/source-invariants.test.ts:211; it covers only panelWindow.ts, panels/usePanelManager.ts and panels/useProvidePanels.ts.
- HeaderButton and HeaderButtonContext are already exported types (panelSettings.ts:73-87). The validator `headerButtonsProblem` (panelSettings.ts:1172) checks only a plain map of slot id to object or false, with SLOT_ID `/^[a-z0-9-]{1,32}$/`; bullet 7's "33 characters or an uppercase letter" matches it.
- PanelState.pinned exists (panelTemplate.ts:40). PanelsAPI.reanchor (hostApi.tsx:187) and setFormFactor (hostApi.tsx:181) exist. The refusal codes not-resizable and busy exist (panelManagerError.ts).
- PanelHeaderRow has no `leading` prop yet and Panel has no `headerButtons` prop yet; both are added here, as the api-report bullet says.

## Numbered corrections (OLD -> NEW)

1. Bullet 8 (null).
   - Old: `null on an instance entry makes the template's slot apply again`
   - New: `null exists only in a patch, never in a layer (panelSettings.ts:1177 rejects a null slot with invalid-settings): mergePatch(instanceLayer, { headerButtons: { size: null } }) removes the instance's own size slot and a resolve over the template plus that result gives the template's size slot back; control: instance false gives no size slot, and a literal null slot inside a layer throws invalid-settings naming layer and key`

2. Bullet 12 (mutant count). Eleven distinct mutants are named across the bullets but N = 9 lists nine. Missing from the list: "Panel passes an empty fragment" (bullet 2) and "the refocus effect removed" (bullet 10).
   - Old: `C5 with N = 9: Panel always draws the cluster; side ignored; order ignored; pressed from a stored flag; the press not marked as the person; the focus call without preventScroll; a slot wired to the raw PanelsAPI reanchor; the exiting slot left interactive; onClick errors rethrown.`
   - New: `C5 with N = 11: Panel always draws the cluster; Panel passes an empty fragment; side ignored; order ignored; pressed from a stored flag; the press not marked as the person; the focus call without preventScroll; the refocus effect removed; a slot wired to the raw PanelsAPI reanchor; the exiting slot left interactive; onClick errors rethrown.`
   - mutate-check requires APPLIED == PLANNED == RED == N, so the spec's --planned must be 11.

3. Bullet 2 (differential file name).
   - Old: `in test/header-buttons.test.ts (basename contains 'header-buttons', the configure-matrix entry's coverage word)`
   - New: `written literally as differential('headerButtons', ...) in test/header-buttons.test.ts (the basename is exactly header-buttons.test.ts, the only form the configure-matrix source test accepts; test/header-buttons-a11y.test.ts and test/header-buttons-person.test.ts hold no such literal)`

4. Bullet 11 (DESIGN.md section is unnamed, so it cannot be checked). Nothing in #20 or #21 writes DESIGN.md, so this entry owns the pinning doc, and the "safety contract" that #25 bullet 8 expects is the design's "Click and safety" paragraph.
   - Old: `DESIGN.md's pinning and header buttons section is written; docs drift green.`
   - New: `DESIGN.md gains a section headed "## Pinning and header buttons" (grep -c '^## Pinning and header buttons' DESIGN.md prints 1) whose "### Click and safety" subsection states: onClick runs through the in-flight gate; verbs called synchronously are the person's gesture and after an await are code; a refused verb returns its typed code; each slot has its own error boundary; an onClick error goes to WorkspaceOptions.onError else console.error; a disabled slot stays focusable; a slot of an exiting panel is inert; docs drift tests green.`

5. Bullet 11 (memo and flushSync scope, plus the PanelRow invariant).
   - Old: `no flushSync import in the new files (planted import: red); no useMemo or useCallback in new pointer code;`
   - New: `no flushSync import in panelHeaderButtons.tsx (the only new file; planted import: red); no useMemo or useCallback in panelHeaderButtons.tsx, Panel.tsx or PanelRow.tsx (add them to the file list of the existing test at test/source-invariants.test.ts:268, which names panels/usePanelManager.ts and PanelRow.tsx); the single-line zIndex={ and enterDirection={ lines in PanelRow.tsx stay findable by lines.find, and the PanelRow edit iterates the entries isPresent keeps;`

6. Bullet 7 ("a runtime note" has no code or sink, so it cannot be asserted). SettingNote.code is a free string; onNote exists at panels/useProvidePanels.ts:78.
   - Old: `each hide only that slot (a per-slot error boundary) with a runtime note`
   - New: `each hide only that slot (a per-slot error boundary) and deliver one SettingNote { code: 'header-button-error', panelId: the panel's id, key: 'headerButtons', message } through the workspace note reporter (PanelsInput.onNote)`
   - Apply the same wording to "a label function returning an empty string hides the slot with a note".

7. Bullet 10 (focus fallback is ambiguous: "the panel that takes the slot" has no referent when the panel stays).
   - Old: `moves focus to the header row of the panel that takes the slot, else the previous one, never body`
   - New: `moves focus to the same panel's header row (tabindex -1), never body; and for a slot whose onClick closes its own panel, focus moves to the header row of the panel now at that index, else the previous panel's, never body`

8. Undecided choice that touches the api-report "nothing else" clause. Panel's `headerProps` is typed `Omit<PanelHeaderRowProps, 'title' | 'actions'>`, so it will accept `leading` once PanelHeaderRow gains it.
   - Add to bullet 11: `Panel passes its own leading after spreading headerProps, so headerProps.leading is overridden; PanelProps.headerProps's declared type is unchanged.`

9. Bullet 5 ("Object.keys asserted"). A literal list would turn red when #23 adds `configure` to the ViewHandle.
   - Old: `(Object.keys asserted: no manager, no other panel)`
   - New: `(Object.keys(h) equals Object.keys of the handle the panel's own view receives and contains no 'manager', so a verb a later entry adds cannot turn this red)`

10. Bullet 1 ("additions only" has no command).
   - Old: `test/panel-header-golden.test.ts is touched by additions only (zero removed lines).`
   - New: `test/panel-header-golden.test.ts is touched by additions only: git diff -U0 -- test/panel-header-golden.test.ts | grep '^-' | grep -vc '^---' prints 0.`

## Touches additions

- `panelSlotContext.ts`. PanelSlotValue is the slot context PanelRow provides. Bullet 2 says "a Panel outside any slot draws nothing" but nothing names the carrier. State: "the slots ride a new optional field `headerButtons` of PanelSlotValue, built in PanelRow from p.settings.headerButtons and PanelViewContext.handleFor(p.id) (panelViewContext.ts, created by the attach entry)".
- `CHANGELOG.md`. The verifier ruled it in for #8 and #9. Add Added bullets for usePanelHeaderButtons, PanelHeaderButtons, headerButtons, Panel's headerButtons prop and PanelHeaderRow's leading prop (append to the existing `### Added`; no second heading).
- `tools/mutants/phonux-header-buttons-*.json` (a second spec when strength gaps are closed; mutate-check requires applied == planned per spec).

## Corrected counts

- Mutants: N = 11 (was 9), in tools/mutants/phonux-header-buttons.json (more specs allowed by the glob above, each with its own --planned).
- Barrel: unchanged at 60 + 2 = 62; title and list edited in the same commit, renamed never deleted.
- MIN_LIBRARY_FILES: +1 (relative; floor is 36 at 0aede6c and will already be higher when this entry runs).
- F = 60 is a floor and stays; it is not derivable from the bullets.

## Decisions assumed (the exact rule recommended for each open decision)

- D1 Where the slots reach Panel: PanelSlotValue (panelSlotContext.ts) gains one optional field `headerButtons`, built in PanelRow from the entry's resolved settings and PanelViewContext.handleFor(entry.id). No new context is created. usePanelHeaderButtons and PanelHeaderButtons read PanelSlotContext; outside a slot (context undefined) both return nothing.
- D2 Runtime note: SettingNote { code: 'header-button-error', panelId, key: 'headerButtons', message }, delivered through PanelsInput.onNote (the workspace note reporter), once per slot per failure. This covers a throwing icon or label function, an icon element that throws in its own render, and an empty label.
- D3 headerProps.leading: Panel passes its own `leading` after spreading headerProps, so a caller's headerProps.leading is overridden. The Omit on headerProps is not changed, so the api-report diff is exactly: Panel's optional headerButtons prop, PanelHeaderRow's optional leading prop, the result type of usePanelHeaderButtons, and the two new value exports.
- D4 null: a layer never holds null; null is a patch concept (mergePatch). The cascade test goes through mergePatch plus resolvePanelSettings.
- D5 Mutant count: N = 11, listed in correction 2.
- D6 DESIGN.md heading: "## Pinning and header buttons" with a "### Click and safety" subsection; it is the only DESIGN.md content this entry must add, and #25 counts it as the safety contract.
- D7 Differential file: exactly test/header-buttons.test.ts, with the literal differential('headerButtons', ...).
- D8 Focus fallback: two literal cases (hidden predicate: same panel's header row, tabindex -1; slot that closes its own panel: header row of the panel now at that index, else the previous one's).
- D9 ViewHandle keys: compare Object.keys(h) with the keys of the handle the panel's own view receives, and require no 'manager'; never a literal list.
- D10 Files outside Touches that are legitimate: CHANGELOG.md, panelSlotContext.ts, and a second or third mutant spec matching tools/mutants/phonux-header-buttons-*.json.
