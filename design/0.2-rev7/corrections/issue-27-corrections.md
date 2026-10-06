AUDIT CORRECTIONS for issue #27 (against main 0aede6c); these supersede the issue text where they differ

Verdict: REVISE. Text-only corrections; no re-scoping, no split. Read-only audit (no npm run, no queue or gh write verb).
Issue: #27 (advance the save baseline only after a successful save; retry after failure).
Ledger: .coordinator/ledger.jsonl does not exist, so no calibration was available.

## 0. Baseline claim: CONFIRMED at 0aede6c

panels/useWorkspacePersistence.ts:82-85 is
```
const timer = setTimeout(() => {
  lastSaved.current = json;
  storage.save(state);
}, saveQuietMsRef.current);
```
The baseline is set before the call and the result is ignored. The save effect depends on `[panels, settled]` (:76-88) and skips when `json === lastSaved.current`. `lastSaved` is also seeded at restore (:59 and :66). WorkspaceStorage `save(state: WorkspaceState): void;` is at workspaceState.ts:45-48 with the doc "fire-and-forget and must not throw".

#9's changes do not affect the claim. `WORKSPACE_SAVE_QUIET_MS` is now `export { SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS }` (:14), where `SAVE_QUIET_MS` is imported from rowConstants.ts. The delay is read from `saveQuietMsRef.current`, which `PanelsInput.tuning.saveQuietMs` feeds. Bullet 4's "fake timers over WORKSPACE_SAVE_QUIET_MS" still works (default 500).

Existing hook tests (`savesAfter` in test/settings-enforcement-visibility.test.ts:320) use `save: (state) => void saves.push(state)`, a void return that stays valid. Their idiom is `mock.timers.enable({ apis: ['setTimeout'] })`, which #27's tests can copy.

## 1. Numbered OLD -> NEW corrections

1. Pre-scaffold command forms.
   - OLD (bullet 1): "BASE is printed by `SCRATCH=$(mktemp -d); npm test 2>&1 | tee $SCRATCH/t.log; awk ...`" (no pipefail, so a failing run still prints a count).
   - NEW: "BASE is printed by `tools/testcount.sh` (it runs npm test, exits non-zero on a failed run, a missing summary or 0 tests); AFTER >= BASE + 6".
   - Bullet 9's chain should read "`tools/ci-chain.sh` exits 0" (C3; it equals strict_gate today, so this is hygiene).
   - Bullet 10's hand grep should read "`tools/comment-rule.sh` exits 0 with files above 0 (C2); the verifier still reads each added comment". The hook file must not contain the word `500` (test/rowconstants-drift.test.ts:61).

2. Retrying needs a changed `panels` array. The effect only reruns when `panels` changes identity.
   - OLD (bullet 4): "the next change (including a re-render whose projection equals the failed one)"
   - NEW: "the next change (including a commit of a new `panels` array, for example setPanels((p) => [...p]), whose projection equals the failed one; a re-render with the same array does not re-run the save effect)"

3. Scratch mutants versus the repo's tool. Bullet 6's "scratch edits of the hook asserted to apply" is what tools/mutate-check.mjs does, and that tool prints `APPLIED=a PLANNED=p RED=r`, refusing a mutant whose `find` is absent or only in a comment.
   - OLD: "Negative controls, scratch edits of the hook asserted to apply"
   - NEW: "Negative controls: `node tools/mutate-check.mjs tools/mutants/phonux-persistence-retry-baseline.json --planned 4` exits 0 and prints APPLIED=4 PLANNED=4 RED=4, with M1 to M4 as written"
   - Add `tools/mutants/phonux-persistence-retry-baseline.json` to Touches.

4. An unspecified judgment. While a save is pending, a change whose projection equals the pending one: save again, or skip? With "advance only on success" the baseline is still the older value, so it would save the same content twice.
   - Add to test 6 (keeps F at 6): "while an older save is still pending, a change whose projection equals it makes no second save call; one that equals the failed baseline retries".

5. The reporter's wiring is not stated. After #19 the reporter is `WorkspaceOptions.onError`, and `PanelsInput.storage` beside a workspace is a development error.
   - Add to bullet 4: "Tests 1 and 2 build the workspace with createWorkspace({ storage, onError }) and mount through useProvidePanels({ workspace }); each failure reaches the onError spy exactly once, and with onError unset it reaches console.error exactly once (one extra assertion in test 1)."

6. Touches fix.
   - OLD: `etc/phonux.api.md`
   - NEW: `etc/*.api.md`; and make bullet 7 read "etc/phonux.api.md and etc/phonux-testing.api.md changing only that member".
   - Reason: after #19, `memoryWorkspaceStorage` puts `WorkspaceStorage` into the standalone ./testing report, so changing `save`'s return type also changes etc/phonux-testing.api.md.

7. Hook-pins sentence (applies to this issue; add to bullet 8). "test/source-invariants.test.ts:244-248 and test/rowconstants-drift.test.ts:59-63 pass unedited: keep the line `}, saveQuietMsRef.current);`, the `SAVE_QUIET_MS` import and the `export { SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS };` alias line, and put no literal `500` anywhere in the hook file (comments included). Mirror the `mock.timers.enable({ apis: ['setTimeout'] })` idiom of `savesAfter` in test/settings-enforcement-visibility.test.ts."

8. Sequencing note (add to Research/Depends text). Touches overlap with #20 and #21 on etc/*.api.md, DESIGN.md and CHANGELOG.md: implement #27 after #21 or rebase it on those three files.

## 2. Touches additions (summary)

- REPLACE `etc/phonux.api.md` with `etc/*.api.md` (both etc/phonux.api.md and etc/phonux-testing.api.md change; item 6).
- ADD `tools/mutants/phonux-persistence-retry-baseline.json` (item 3).
- CHANGELOG.md and DESIGN.md are already listed (DESIGN.md persistence section ~lines 580-650).
- test/source-invariants.test.ts and test/rowconstants-drift.test.ts are not edited; they must pass unedited (item 7).
- Depends on #19 is enough for the hook (it follows #16, #18 and #19 transitively).

## 3. Corrected counts

- Tests: BASE + 6 is correct (six tests listed; the in-flight rule is folded into test 6, so F stays 6). The `awk` on `$3` is fine for `ℹ tests N`, but use tools/testcount.sh instead (item 1).
- Mutants: N = 4 (M1 to M4), `--planned 4`, expected `APPLIED=4 PLANNED=4 RED=4`.
- Barrel: #27 adds no runtime value; stays at 60 after #19 (chain 51 -> 54 -> 55 -> 56 -> 60; #22 +2 -> 62). Changing `save`'s return type changes only type declarations in the api reports.
- MIN_LIBRARY_FILES: 36 today over 37 files; floor = files - 1. #27 creates no new root or panels/ file, so the floor is unchanged by #27 (it is whatever #10 to #21 left).
- KNOWN-BAD: not touched by #27. After #20 the tree has only KNOWN-BAD:4 (test/pins-visibility.test.ts:65); KNOWN-BAD:3 has become LIMIT:3.
- api-report: etc/phonux.api.md and etc/phonux-testing.api.md change only the `save` return-type member of WorkspaceStorage.

## 4. Section-0 facts that apply to this issue

- FOUR TESTS PIN THE TEXT OF panels/useWorkspacePersistence.ts (all pass today; #18, #19 and #27 all rewrite that file):
  - test/source-invariants.test.ts:244-248 pins the `saveQuietMsRef` declaration, its per-render assignment, and the line `}, saveQuietMsRef.current);`.
  - test/rowconstants-drift.test.ts:59-63 pins the `import { SAVE_QUIET_MS } from '../rowConstants.js'` line and the alias line `export { SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS };`; it forbids `export const WORKSPACE_SAVE_QUIET_MS` and the word `500` anywhere in the hook file, comments included.
  - test/rowconstants-drift.test.ts is in none of the five Touches lists.
- usePanelManager's parameter list pin (test/source-invariants.test.ts:251) is not touched by #27.
- COLLAPSIBLE_READERS (test/source-invariants.test.ts:211) is not affected by #27.
- Source of etc reports: etc/phonux.api.md and etc/phonux-testing.api.md; the testing report is a standalone bundle of everything reachable from fakeHost.ts (package.json `"./testing": "./fakeHost.ts"`), so WorkspaceStorage lands there after #19.
- Precedent: #8 and #9 committed CHANGELOG.md; verifiers added mutant specs. #27's mutant spec is a single named file with --planned 4.

## 5. Overlap and ordering

Code is disjoint from #20 and #21; they share etc/*.api.md, DESIGN.md and CHANGELOG.md. If #27 runs in parallel with #20 or #21 it needs a rebase on those three files. Order: after #19 is the dependency; preferred after #21. No overlap with #10's Touches except etc and DESIGN.md (sequential).

## 6. Decisions assumed

- The baseline claim is accepted as true as written (confirmed at :82-85).
- #27 is sequenced after #21 (preferred) rather than right after #19, to avoid a rebase on etc, DESIGN.md and CHANGELOG.md; "Depends on #19" alone remains sufficient for correctness.
- The in-flight rule is folded into test 6 so the count stays 6 and BASE + 6 stands; if the implementer wants a seventh test, the count becomes BASE + 7 and bullet 1 changes with it.
- The reporter is wired through `createWorkspace({ storage, onError })` + `useProvidePanels({ workspace })` (tests 1 and 2); with onError unset, console.error is called exactly once. This follows #19's rule that `PanelsInput.storage` beside a workspace is a development error.
- `save`'s return type change affects both api reports, so the Touches glob is `etc/*.api.md`.
- The mutants use the repo's tools/mutate-check.mjs with `--planned 4` rather than hand-rolled scratch edits (the tool refuses a mutant whose `find` is absent or only in a comment).
- Retry is triggered only by a commit of a new `panels` array (the effect's dependency is array identity), not by a bare re-render.
- The hook-text pins (source-invariants.test.ts:244-248, rowconstants-drift.test.ts:59-63) stay verbatim; the worker keeps `}, saveQuietMsRef.current);`, the SAVE_QUIET_MS import and alias line, and no `500` in the file.
- No absolute MIN_LIBRARY_FILES value is asserted; #27 adds no file, so none is needed.
