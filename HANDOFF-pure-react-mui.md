# Handoff: phonux stays pure React/MUI and serves three hosts

Written 2026-10-11 from a free.music planning session.

Read-only. Nothing was built, run, filed or changed. Citations are `phonux:path:line` at the local clone's HEAD ee6b3b6, unless prefixed `phonux-app:` (local dacedcd) or `simplebrowser:` (local 46ae317). GitHub main is ahead of both local clones: phonux is at bb9db31 and phonux-app was at e442626 at 20:14Z, so re-cite before filing. GitHub state was read at about 21:00Z on 2026-10-11. Items marked (inference) are reasoning from the cited text, not checked by running anything. Lines were re-read for this revision wherever a correction is listed. The rest are unchanged from the draft and were not disputed.

## 1. Why

Owner statements, as relayed to this task on 2026-10-11 (not in any repository file):

- "Phonux api should be pure react/mui no chrome."
- "The phonux-app should be a test app written in TS, like a webpage, and is our testbed for phonux api."
- "I may have accidently mixed up simplebrowser and phonux app when I was tired and asked for chromium on phonux app, when I meant to have simplebrowser move over to chromium as a base."

The first draft read "chrome" as UI chrome (panel frames, headers). The owner rejected that: "I was referring to the browser that is based on chromium (but I meant chromium)." This handoff reads "chrome" as Chromium and browser-product specifics. Panel frames, headers and header-button slots are not in scope.

Related records:

- `phonux-app#10` comment 6052101737 (2026-10-08) records the owner saying the phonux library and API "must not be related to Electron", and asking "Can we start updating chromium directly instead of electron?" It asks the coordinator to confirm the scope ("gate only, or the app too"). No later comment answers that. The 10-11 statement says the Chromium request was meant for SimpleBrowser.
- `phonux-app:plans/records/split-phonux-into-own-repo.md:11` (2026-09-30): phonux-app reaches phonux through its public API only. The owner on History: it should "keep track of spawned panels", and "maybe history is a bad name".
- `phonux-app:plans/completed/merged.yaml:710` (2026-09-24): "free.music and SimpleBrowser are waiting to use phonux; it must work outside this repo."

How browser concepts got in. phonux began as a folder inside phonux-app, a SimpleBrowser fork, and was extracted with `git filter-repo` (`phonux:DESIGN.md:1443-1445`). The only host was a browser, and the Host type was shaped by it. The public 0.1.0 Host requires settings, history, panels and device (`hostApi.tsx:237-249`). History carries the Closed Pages log (`hostApi.tsx:113-135`). Every panel carries a required `url` (`hostApi.tsx:87`, `workspaceState.ts:24`). `create()` defaults to view `'web'` (`hostApi.tsx:143`) and url `'about:blank'` (`panels/useProvidePanels.ts:867`).

None of this is a runtime import. The coupling sits in types, defaults, fixtures, wording and the guard. A second host feels it at once: `useHost()` throws without a provider (`hostApi.tsx:287-291`), so a host must build a full Host bag before it can render one panel.

The split that defines what leaves phonux is in SimpleBrowser's stub `phonux-adopt-panel-kit` (`simplebrowser:plans/queue.yaml:379-388`; GitHub ChicoBitcoinJoe/SimpleBrowser#17). The Closed Pages log stays in SimpleBrowser. phonux exposes `onPanelsClosed`, which already exists (`panels/useProvidePanels.ts:77`, `panels/usePanelClosing.ts:83`). The live webview, act loop and sessions stay in SimpleBrowser.

## 2. Purity audit

**Runtime dependencies: pass.** `package.json` has no `dependencies` key. Peers (`package.json:13-20`): react and react-dom `^19.2.8`, `@mui/material` and `@mui/icons-material` `^9.3.1`, `@emotion/react`, `@emotion/styled`, `motion` `^13.3.0`. Non-test library imports are react, react-dom (`flushSync` at `panels/usePanelClosing.ts:2` and `panels/usePanelManager.ts:11`), `motion/react`, and `@mui` subpaths. No electron, `node:`, webview or webContents token appears in non-test library code. `localStorage` appears once, in a comment (`hostApi.tsx:4`).

**USB names: present.** No USB API is called, but USB-named identifiers and comments are in library code (`hostApi.tsx:32-36`, `PhoneDetectPrompt.tsx:10-18`, `phoneModels.ts:3`, `phoneModels.ts:46-50`). This is the deliberate R2 phone-detect feature.

**Guard gap.** `PHONE_BOUNDARY_RULES` (`test/support/boundary-scan.ts:633-640`) bans `ipc/bridge`, `bridge()`, `window.simplebrowser` (`:636`), `localStorage`, `sessionStorage` and `import.meta.glob`. `test/boundary.test.ts:43-51` runs it. It does not ban electron, chromium, webview, webContents, `navigator.usb` or `about:`. The guard passes while the public types carry browser shapes.

**Rule note.** R4 aliases (`DESIGN.md:503-523`) cover exports, not properties such as `Host.history.closedPagesViewer` or `PanelSummary.url`. For properties, the only routes are optional or removal (inference from R4's wording).

**Already removed.** The 22 deprecated aliases and the ten values and three types are gone from the public surface (phonux CHANGELOG.md, Unreleased "Removed"; quoted in phonux#25). The R4 alias policy is no longer open for those.

| # | Concept | Where | Why browser-shaped | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | `url` on panel, summary, closed-entry and saved types | `hostApi.tsx:87`; `panelTemplate.ts:55` (documents `''` as no url); `panelWindow.ts:23-24`; `workspaceState.ts:24`; `isSavedPanel` at `workspaceState.ts:96` | A URL is the browser's address. Read semantically at `panels/usePanelClosing.ts:148` (closed-log title fallback), `workspaceCore.ts:226` (equality) and `workspaceCore.ts:450` (`''` becomes undefined). Copied through `panelRowEntry.ts:56`, `workspaceState.ts:257` and `:282`, `panels/useProvidePanels.ts:168`, `panelWindow.ts:163`, `workspacePlan.ts:220`. A saved file whose panels lack a string url is ignored whole (`workspaceState.ts:124`; `workspacePlan.ts:91-93`). | Make optional on PanelSummary, PanelState and ClosedPageEntry. Accept a missing url in `isSavedPanel`. Move the title fallback to the host. Keep the stored field pending Q1. Settled shape (`DESIGN.md:30, :588`; rev7 section 6): owner sign-off needed. |
| 2 | `create()` default url `'about:blank'` | `panels/useProvidePanels.ts:867`; same literal in a comment at `:854` | A browser scheme as a default. The same block already defaults the title to `Panel N`. The documented no-url value is `''` (`panelTemplate.ts:55`). The literal appears 47 times in 5 test files (draft count, not re-counted). | Default to `''`. Changes only what `create()` panels report; saved files keep stored values. Check `test/fixtures/compat-0.1.0` first. |
| 3 | Default view `'web'` | `hostApi.tsx:143`; `panelWindow.ts:93`; `viewRegistry.tsx:52-65` (placeholder); `PanelRow.tsx:63` | A browser name phonux never registers. An unregistered view renders a placeholder. phonux-app registers `'web'` through the side-effect import `./panels/registerBuiltinViews.js` (`phonux-app:client/src/desktop/appApis.ts:18`). It passes `panels.create` directly as an `onClick` (`phonux-app:client/src/desktop/history/HistoryColumn.tsx:48`), so `create` receives a MouseEvent. The library guards that at `useProvidePanels.ts:850`. | Host-supplied default through `PanelsInput`; undefined renders the placeholder. Keep the zero-argument overload and the event guard. Reword `DESIGN.md:89-95` ("built-in web view"). Coordinate with phonux-app#12, which owns the web template. |
| 4 | `Host.history`: `loadClosedPages`, `closedPagesViewer`, the Closed N pages copy | `hostApi.tsx:113-135`; `:208-215`; copy in the doc comment at `:210` | The Closed Pages log is SimpleBrowser's dead-end history (`simplebrowser:electron/dead-end-history.ts`), which stays in SimpleBrowser under the owner's split. phonux-app keeps its own log (`phonux-app:electron/dead-end-history.ts`; `dead-end-history/history.json`). rev7 section 1 drops History, yet the Host bag still carries it. | Make `Host.history` optional, as `snapshots` already is (`hostApi.tsx:246-248`). Drop `loadClosedPages` and `closedPagesViewer` once SimpleBrowser consumes `onPanelsClosed`. Keep `recentlyClosed` and `undoClose` with neutral copy. phonux-app readers need `?.` (`phonux-app:client/src/desktop/history/HistoryColumn.tsx:36,55`; `HistoryOverlays.tsx:15`). |
| 5 | History root column: `createHistoryPanel`, view id `'history'` | `panelWindow.ts:78` (`@internal`); `DESIGN.md:60-61, :68-111` | A tab-style column seeded as root. The owner's 2026-09-30 words (split record, line 11) describe History in the api as keeping track of spawned panels, and doubt the name. | Keep the tracking concept generic. Move the History column into the app as a root template (phonux-app#12). Delete `createHistoryPanel` once the 0.1.0 compat tests stop pinning it. |
| 6 | USB phone detection: `DetectedPhone`, `device.detectedPhone`, `dismissDetectedPhone`, `resizeForDetectedPhone`, `PhoneDetectPrompt` | `hostApi.tsx:32-38, :229-233`; `PhoneDetectPrompt.tsx:10-19, :40, :59`; `phoneModels.ts:45-55` | Detection needs a native host. phonux-app loads the `usb` package in its Electron main process (`phonux-app:electron/main.ts:95-97`). `electron/phone-usb-detect.ts` is pure decision logic with no usb import (`:1-6`). WebUSB, the browser route, is Chromium-only and needs a user gesture (external knowledge). The members are required, so a host without USB must stub them. Two hand-kept vendor tables, with no cross-check: `phoneModels.ts:52` and `phonux-app:electron/phone-usb-detect.ts:29-31` (`KNOWN_PHONE_VENDOR_IDS`). | Keep the names (R2, `DESIGN.md:507-509`). Make the three members optional. `PhoneDetectPrompt` takes a host label and drops the hard-coded vendor table. The app's one-time USB resize notice depends on the native path (`phonux-app:README.md:217`); see Q3. |
| 7 | Other `device` members: `defaultSize`, `models`, `chooseModel` | `hostApi.tsx:218-234` | No library component reads them outside `hostApi.tsx` and `fakeHost.ts`. Library code reads only `device.size` (`Panel.tsx:105`, `PanelFrame.tsx:90`, `PanelRow.tsx:165`). | Make optional. Keep `device.size` required. Add a test that a host with only `device.size` and `panels` renders `Panel` and `PanelRow`. |
| 8 | `settings.settingsColumn` | `hostApi.tsx:107-110` | Not read by the library. | Keep. rev7 Q17 says it stays. Settled; no change proposed. |
| 9 | Snapshot and capture API (`CaptureRegistry`, `SnapshotsAPI`) | `snapshots.ts:32-37, :53-74, :79`; `etc/phonux.api.md:33` | DOM-generic and already optional. But `snapshots.ts:10` names the fixed `'settings'` and `'history'` ids, which rev7 templates replace. | Keep. Reword `snapshots.ts:10`. The DOM-redraw engine (`phonux-app:client/src/desktop/capture/engine.ts`) and its measurements stay in the host. |
| 10 | Engine names in rationale and CSS | `panels/useRowScrollGesture.ts:19` ("Chromium cannot mark trackpad momentum"); `DESIGN.md:890, :898`; `PanelFrame.tsx:41, :54-60`; `Workspace.tsx:153` (`::-webkit-scrollbar`) | The constraints are input-stack and platform facts. `::-webkit-scrollbar` is WebKit and Blink only; Firefox ignores it (external knowledge). | Comment-only rewording: "browsers do not mark trackpad momentum"; "overlay scrollbars"; label the `::-webkit-scrollbar` rules as WebKit and Blink only. Keep the rules. No behaviour change. |
| 11 | Doc and example wording | `README.md:5, :72`; `hostApi.tsx:4, :114, :226`; `fakeHost.ts:2` | "desktop bridge" and the `about:blank` example. | Doc-only: "a host that persists nothing"; url-free README example. Do not edit the published compat-0.1.0 declarations. |
| 12 | Test fixtures with Electron ids | `test/panel-window.test.ts` (`sourceWebContentsId`, `webContentsId`, e.g. `:45, :71, :473, :549`); `test/workspace-state.test.ts:60` | `hostData` is opaque (`DESIGN.md:479-480`), so neutral JSON is safe. | Neutral fixtures, after checking the compat corpus. |
| 13 | Boundary guard names the product | `test/support/boundary-scan.ts:636` | Names SimpleBrowser inside the library and misses the browser vocabulary. | Replace the `window.simplebrowser` rule with a neutral ambient-global list that also bans electron, chromium, webview, webContents, `navigator.usb` and `about:`. Entry 2 must first reword the `about:blank` comment at `useProvidePanels.ts:854`. |
| 14 | Visible copy a host cannot change | `PhoneDetectPrompt.tsx:59` (rendered "connected" label); `:40, :65, :100` (aria-labels); `panelWindow.ts:78-84` ("History"); `useProvidePanels.ts` (fallback "Panel N"); `usePanelClosing.ts:148` and `viewRegistry.tsx:58` ("Untitled panel") | Hard-coded English. free.music uses its own i18n. Not an exhaustive inventory. | A labels option with English defaults (Q5). |

Keep unchanged: the generic core (`PanelRow`, `Panel`, `PanelFrame`, `Workspace`, `DragToClose`, `panelWindow.ts`, `panels/*`, `workspaceCore.ts`, `workspacePlan.ts`, `viewState.ts`, `windowOverlay.tsx`, `defaultTheme.ts`) and the phone catalog and frame (R2; `phoneModels.ts:1-38`; `DEFAULT_PHONE_SIZE` 390x700 at `hostApi.tsx:19-30`). `phoneModels.ts:19` says the catalog is hand-copied from phonux-app's `vendor/device-specs/viewport-sizes.json`. Only the entry count (13) was checked. Make one source or add a check.

Verdict: the browser shape is in the types, defaults, fixtures, guard rules and wording, not in the imports.

## 3. What free.music needs

Source: the free.music plan, which travels as `HANDOFF-free.music.md` from the same planning session (not yet committed to free.music). The needs below are checked against phonux's design and code. npm `latest` was still 0.1.0 at the fact-check (not re-checked here). The rc is draft PR `phonux#73`.

1. **Fixed Now Playing column, declared only through settings.** `parkable:false`, `closable:false`, `placeOnAdd: 'after-fixed'`. Supported by the design: `locked = !closable` and `collapsible = parkable` (rev7 section 3.6); `after-fixed` is an `AddPlacement` (rev7 placement table). Declare it through the settings layers, not app code. Not built; the rc must prove it.
2. **`stickyEdge`.** Not built; rev7 section 3.7 defers it. Q15 (rev7 section 0, decision 10) lets a fixed panel scroll off screen, so without `stickyEdge` Now Playing scrolls away with the row, which the free.music plan rules out. rev7 3.7 says the owner may promote any deferred item. Proposed shape, for a design entry to decide and not agreed: per-panel `stickyEdge: 'off' | 'left' | 'right'`, default `'off'`, valid only on a `parkable:false` column. The column stays at its edge while the row scrolls. It needs its own z-order and a scroll-synchronised offset. Q15's default is unchanged; this is opt-in.
3. **Panels without URLs.** Needs section 2 rows 1 and 2 (`url` optional, default `''`). Also needs an explicit view on every `create()`, because an unregistered view renders a placeholder and zero-argument `create` defaults to `'web'` (`viewRegistry.tsx:52-65`; `hostApi.tsx:143`).
4. **Device without phone models or USB.** Needs `device.size` only (section 2 rows 6 and 7). Phone-width sizing stays: every panel opens at phone width through `device.size`. No USB detection.
5. **Host-supplied labels for every visible string.** Not present (section 2 row 14). Needs a labels option on `PanelsInput` with English defaults.
6. **Views that adapt to their slot width.** Gap. `Workspace` receives the scroll container's width (`Workspace.tsx:91`), and `panelTiers.ts` exists, but no hook gives a view its own slot width (grep for `usePanelWidth`, `useSlotWidth` and `slotWidth` found none). Add a read-only hook that returns the slot width in px and updates on resize and tier change.
7. **Stub list until items 4 and 5 land** (free.music's own host): `history` (`loadClosedPages` resolving `[]`, `closedPagesViewer`, `locked`, `closed`, `close`), `settings.settingsColumn`, the non-size `device` members, and `url: ''` on every hand-built summary. A saved file missing `url` is ignored whole (`workspaceState.ts:124`; `workspacePlan.ts:91-93`).

## 4. Testbed change, and the SimpleBrowser side

### 4a. Shared data: decide before any further real-profile run

Both root packages are named `simplebrowser` with no `productName` (`phonux-app:package.json:2`, `simplebrowser:package.json:2`). Electron therefore puts both apps in `~/Library/Application Support/simplebrowser/`, and both main processes write the same files:

- `sessions/sessions.json`: phonux-app `electron/main.ts:245,271` and `electron/sessions.ts:55,72`; SimpleBrowser `electron/main.ts:1239,1295` and `electron/sessions.ts:73`. Each process loads the file and rewrites the whole thing from its in-memory copy on every save, so the second writer erases the first one's sessions. phonux-app's README calls this file "the owner's real and irreplaceable data" (`phonux-app:README.md:232, :241`) and says the front page neither reads nor writes it (`:243`). The main process does both.
- `dead-end-history/history.json`: phonux-app `electron/main.ts:274`; SimpleBrowser `electron/main.ts:1305`.
- `phone-size.json`: phonux-app `electron/main.ts:51,55` (via `user-data-store.ts:10`); SimpleBrowser `electron/main.ts:506,510`.

Recommendation: before any further run of phonux-app against the owner's real profile, give phonux-app its own userData folder, with a copy-and-import of its own files only. Electron names the folder after the package, so this means a package rename or a path override, plus a documented one-time copy. Any import reads a copied snapshot, never the live shared file. Which app owns each path is an owner decision (Q10).

### 4b. Real-layout gate (phonux-app#10): status

- Accepted into draft PR `phonux-app#33` at 20:32Z (comment 6113435866: "This issue is now frozen; the pull request is the record"). #10 is still open. PR #33 is unmerged.
- PR #33 is an Electron harness. Its title, its Touches (`electron.vite.config.ts`, `test/phonux-render-gate-electron.test.ts`) and Evidence 2 (electron-vite build; CDP `Page.navigate` onto `desktop.html`) all say so. Only its Local insights name plain Chromium (`PHONUX_CHROMIUM=/opt/pw-browsers/chromium`, Chromium 141.0.7390.37). The record contradicts itself.
- The "plain Chromium, gate only" ruling appears in audit comment 6067925938 and handover comment 6113267071, with no quoted source. The scope question in 6052101737 has no answer in the thread.
- `phonux#25`'s body (updated 20:57Z) now says the owner dropped the real-layout gate, which "was withdrawn and moved out of this work". The rc therefore needs no LIBCOMMIT, SHA256 or measurements file. It pins PINNED to phonux main at build start, and it states that no real browser has measured the tree. The rc does not wait on Electron removal or on any browser gate.
- The gate has never run. The capture record was taken on Chromium 150.0.7871.212 under Electron (`phonux-app:plans/records/implement-per-view-capture-v1.md:197`).

### 4c. phonux-app: state and sequence

Open phonux-app issues (2026-10-11): #1 (a second panel row when the fit count allows); #2 (Ctrl+Arrow between workspaces); #10 (above); #11 (adopt the 0.2 rc on the Electron shell; its title says "drop ... the gate's skip branch"); #12 (adopt the workspace: History and web templates, header-button slots, tuning sites, scrolling row, launch at the far end, fixed toast); #16 (propagate save failures so a refused save is retried; Depends on #11, #12 and #22). #31 is closed, and PR #32 merged at 20:12Z, adding twelve `tolerated_test_failures`.

Electron-only code: 13 `.ts` files and 1,045 lines under `phonux-app:electron/`, plus `preload.cjs`. The renderer reaches it only through `window.simplebrowser` (`phonux-app:client/src/shared/ipc/bridge.ts:77-78`). Five renderer call sites use host storage: `workspaceStorage.ts:12,19`; `appApis.ts:31,38`; `useProvideHistory.ts:21`; `phoneSizeStore.ts:40,53`; `useProvideDevice.ts:20,23`. The renderer already tolerates a missing bridge (`appApis.ts:27-29`). The move is mostly a host-adapter swap plus a Vite web entry (inference).

Proposed sequence (cross-repo; filed in `Jojos-Creations/phonux-app`, not in this queue). The owner decides the order.

1. Decide #10 and PR #33: close them as superseded by the dropped gate, or re-plan. Do not edit #10, which is frozen.
2. #11: adopt the rc on the current Electron shell. Re-word its skip-branch scope after step 1.
3. New entry: host adapters for the five call sites, plus a web Vite entry, before #12, so #12 rewrites the desktop tree once. Re-scope #16 after it. #16 edits `workspaceStorage.ts`, and its body still calls phonux#19 and #27 plans, though neither is open. Re-read it before acceptance.
4. New entry, before step 6: a one-time import. Back up the four phonux-app paths to a dated copy, read them through the Electron reader once, write them to browser storage, and test the round trip. A web page's storage is per-origin and cannot see the desktop folder (inference). Without this step, the saved panel row, phone size and Closed Pages log are lost at deletion.
5. #12 adopts the workspace.
6. New entry, after step 4: delete `electron/`, the `usb` dependency, the electron-vite config, the `window.simplebrowser` bridge, `src/act/types.ts`, and the Electron `shot` tool (replace it with Playwright on the Vite build; a new dependency, so an owner decision). In the same change, delete the six Electron-launching tests: `dead-end-drag-drop-integration`, `panel-anchor-placement-electron`, `panel-form-factors-electron`, `panel-spawn-permanent-columns-electron`, `per-view-capture-integration` and `workspace-state-persistence-electron`. Remove their nine Electron entries from `tolerated_test_failures`. The three jsdom entries (`app-apis`, `goal-front-page-mount`, `workspace-persistence`) stay until the MockTimers warning is fixed; deleting Electron does not clear them. Record the supersession of "only Electron/IPC stays host" (`phonux-app:plans/records/design-phonux-split.md:7`) and of the electron-vite record in that entry's PR body.

Release: the owner publishes by hand from a personal npm account with 2FA. Agents never log in or publish (`phonux-app:plans/records/split-phonux-into-own-repo.md:9`). Nothing in this move publishes.

### 4d. Library: the rc and the pin

- `phonux#25` (0.2.0-rc.1, build only) is open. Its build is draft PR `phonux#73`. The body covers the version bump, the CHANGELOG rename (Unreleased becomes 0.2.0-rc.1, with Breaking, Added and Changed sections), the 61-row catalog gate, the release command (`--tag next` for prereleases), and smoke. Agents never publish.
- `phonux#24` is closed: completed 2026-10-11 20:12Z by PR #56. `phonux#22`, `#23`, `#26` and `#27` are also closed. The old "waits on red probes" note is stale. Only #25 is open.
- PINNED rule: any library merge to main between the build's start and acceptance re-pins #25. So the Phase A and B edits in 4e wait until #73 is accepted, or the owner accepts a re-pin.
- #25 renames the CHANGELOG heading. The compat matchers (`test/compat-0.1.0.test.ts`, `tools/gen-compat-corpus.mjs`) are changed to accept both headings. Any CHANGELOG edit must keep those matchers working.
- `test/fixtures/compat-0.1.0` pins the 0.1.0 declarations, including `createHistoryPanel`, `url` and `about:blank`. Check it before each type or default change. The app stays on npm `phonux` 0.1.0 until phonux-app#11 adopts the rc.

### 4e. Recommended library order

- **Phase A, types and wording only, no runtime change:** section 2 rows 4, 6, 7, 11, 12 and 13. Land after #73 is accepted, or ship as 0.2.0-rc.2. Do not hold rc.1 for it unless the owner wants Phase A in rc.1.
- **Phase B, behaviour changes:** `url` optional and default `''` (rows 1 and 2); host-supplied `'web'` default (row 3); labels option (row 14); width hook (section 3 item 6). After rc.1 is published, or earlier with the owner's go and a re-pin.
- **Phase C, after 0.2.0:** `stickyEdge` (on owner promotion; it also needs a browser check that does not exist yet, Q7); removal of `Host.history`'s closed-log members once SimpleBrowser consumes `onPanelsClosed`; the USB vendor table moves fully to the host.

Run `npm run smoke` and `release:check` after each Host type edit (inference from the script names).

### 4f. SimpleBrowser handoff

- The stub `phonux-adopt-panel-kit` (`simplebrowser:plans/queue.yaml:379-388`; GitHub #17, open, p4) has the YAML prerequisite `front-page-scope-use-panel-manager-hook` (`queue.yaml:384`). The GitHub mirror says "Depends on: none" and has `<TODO>` in Touches and Evidence.
- The stub needs more than `onPanelsClosed`: a `pinned` flag that exempts a panel from automatic collapse, a generic `PanelWindow<T>` over opaque content, and an optional `onWantMoreWidth(px)` callback. phonux source has no `onWantMoreWidth` (grep, excluding tests and design). `pinned` exists only as the 0.2 pinning read-out (`panelTemplate.ts:65-66`), a different concept. No phonux entry covers these three. Owner call: add them to phonux, or drop them from the stub (Q13).
- The stub says `file:../phonUX`; this plan assumes npm `phonux` 0.2. Pick one.
- The owner's 2026-09-16 hold, "hold all further queue integration until it completes", appears at `simplebrowser:plans/queue.yaml:190, :210, :245, :264`. Whether it still applies is open (Q13).
- All 18 SimpleBrowser issues (#1 to #18) are open. Four touch the same panel manager and need a decision: #9 (an "is a run using this panel" check in newSession, selectSession and autoCollapseOldest), #14 (pin revealPanelProactively's atomic commit), #15 (fix 7 broken tests) and #18 (manual check of the usePanelManager extraction). Each is superseded by adoption, a prerequisite of it, or unrelated.
- The Closed Pages log and its viewer stay in SimpleBrowser (`simplebrowser:electron/dead-end-history.ts`). The window-growth call (`reportPanelCount` and `BrowserWindow.setSize`) becomes `onWantMoreWidth`.
- SimpleBrowser keeps its own copy of the USB detect module. Whether SimpleBrowser stays on Electron or moves to plain Chromium as its base is an owner question (Q12). The draft's "SimpleBrowser keeps Electron" is not a decision.

## 5. Proposed plan entries

File only after the owner answers the questions each entry depends on, and only through `queue.py`, the sole writer of a plan body. Order: `stub`, then `research` (`--prereq` takes issue numbers), then `audit-record --verdict APPROVED`, then `accept`. Run `python3 tools/queue/queue.py stub --help` first. Evidence is a numbered bullet list (`plans/SCHEMA.md`); pass each check as its own `--evidence` flag. No entry that touches library source merges while #25 is open, unless the owner accepts a re-pin (section 4d).

**0. phonux-export-review-browser-shapes** (p1 if it must precede #25's acceptance, else p2; owner session; no code). Walk section 2's table with the owner and record each answer in a new DESIGN.md section named in the stub. Evidence: (1) the section's table has 14 rows, each with a recorded answer; `grep -c` on those rows prints 14. Replaces closed phonux#2 as the review home (Q8).

**1. phonux-host-optional-members** (p2; no open dependency now that #24 is closed). Touches: `hostApi.tsx`, `fakeHost.ts`, `index.ts`, `etc/phonux.api.md`, `test/**`. Evidence: (1) `npm run typecheck` exits 0; (2) `npm run check:api-report` exits 0 and shows `history?` as optional; (3) `grep -c undocumented etc/phonux.api.md` prints 0; (4) `npm test` exits 0 with a new test rendering `Panel` and `PanelRow` under a host holding only `device.size` and `panels`; (5) `npm run smoke` exits 0.

**2. phonux-url-optional-default-empty** (p3; after entry 1; needs Q1). Touches: `hostApi.tsx`, `panelTemplate.ts`, `panelWindow.ts`, `workspaceState.ts`, `workspaceCore.ts`, `workspacePlan.ts`, `panelRowEntry.ts`, `panels/useProvidePanels.ts`, `panels/usePanelClosing.ts`, `README.md`, `test/**`, `etc/phonux.api.md`. Evidence: (1) `grep -rn "about:blank" --include=*.ts --include=*.tsx --exclude-dir=test --exclude-dir=node_modules .` prints nothing, which includes the comment at `useProvidePanels.ts:854` that this entry rewords; (2) `npm test` exits 0 with a new case in `test/workspace-state.test.ts` that loads a saved file whose panels have no url and keeps every panel; (3) `git diff --stat origin/main -- test/fixtures/compat-0.1.0` prints nothing; (4) `npm run check:api-report` exits 0 and shows `url?` on `PanelSummary`.

**3. phonux-web-default-host-supplied** (p3; after entry 2). Touches: `hostApi.tsx`, `panelWindow.ts`, `viewRegistry.tsx`, `PanelRow.tsx`, `DESIGN.md`, `test/**`. Evidence: (1) `npm test` exits 0 with a test where `create()` with no default view renders the placeholder and does not throw; (2) `grep -rn "'web'" --include=*.ts --include=*.tsx --exclude-dir=test --exclude-dir=node_modules .` prints nothing, which includes the comment at `PanelRow.tsx:63`; (3) `npm run check:api-report` exits 0.

**4. phonux-purity-wording-and-guard** (p3). Touches: `panels/useRowScrollGesture.ts`, `PanelFrame.tsx`, `Workspace.tsx`, `PhoneDetectPrompt.tsx`, `snapshots.ts`, `hostApi.tsx`, `fakeHost.ts`, `README.md`, `DESIGN.md`, `test/support/boundary-scan.ts`, `test/boundary.test.ts`, `test/panel-window.test.ts`, `test/workspace-state.test.ts`. Evidence: (1) `grep -rniE "chromium|electron|webview|webcontents|simplebrowser|desktop bridge" --include=*.ts --include=*.tsx --include=*.md --exclude=CHANGELOG.md --exclude-dir=test --exclude-dir=design --exclude-dir=node_modules .` prints nothing; (2) `npm test` exits 0, and the boundary test asserts a rule list naming electron, chromium, webview, webContents, navigator.usb and about:; (3) `npm run lint` exits 0, and `grep -rn biome-ignore` over the touched files prints nothing; (4) `git diff --stat origin/main -- test/fixtures/compat-0.1.0` prints nothing.

**5. phonux-usb-optional-label-prop** (p3; do not accept until Q3 is answered). Touches: `PhoneDetectPrompt.tsx`, `phoneModels.ts`, `hostApi.tsx`, `index.ts`, `fakeHost.ts`, `test/**`. Evidence: (1) `npm test` exits 0 with a test that renders `PhoneDetectPrompt` with a host-supplied label and asserts its text; (2) `grep -rn "knownAndroidVendors" --include=*.ts --include=*.tsx --exclude-dir=node_modules .` prints nothing, showing the hard-coded table has left the library; (3) `npm run check:api-report` exits 0. Depends on: entry 1.

**6. phonux-host-labels** (p3; stub until Q5). Touches: `index.ts`, `hostApi.tsx`, `panelWindow.ts`, `panels/useProvidePanels.ts`, `panels/usePanelClosing.ts`, `viewRegistry.tsx`, `PhoneDetectPrompt.tsx`, `README.md`, `test/**`. Evidence: (1) `npm test` exits 0 with a test that overrides the undo-toast text, the root title and the fallback title, and reads each back; (2) `grep -c undocumented etc/phonux.api.md` prints 0 after the labels type gains TSDoc on every member; (3) `grep -rln "Untitled panel" --include=*.ts --include=*.tsx --exclude-dir=test --exclude-dir=node_modules .` lists only the file that holds the defaults object.

**7. phonux-view-slot-width-hook** (p3). Touches: `panelSlotContext.ts`, `PanelRow.tsx`, `PanelFrame.tsx`, `index.ts`, `DESIGN.md`, `test/**`. Evidence: (1) `npm test` exits 0 with a test where a view's hook reports the slot width after a resize, using a stubbed `ResizeObserver`; (2) `npm run check:api-report` exits 0 and the report lists the hook; (3) `npm run typecheck` exits 0.

**8. phonux-sticky-edge** (p3; after rc.1 is published; only on owner promotion, Q6; design section first). Touches: `panelSettings.ts`, `panelTemplate.ts`, `PanelRow.tsx`, `PanelFrame.tsx`, `Workspace.tsx`, `index.ts`, `DESIGN.md`, `etc/phonux.api.md`, `test/**`. Evidence: (1) `npm run check:api-report` exits 0 and the settings type has `stickyEdge`; (2) `npm test` exits 0 with a test that the engine writes a zero offset for a sticky column when the row scrolls by a set distance (jsdom cannot measure layout, so this asserts the engine's own offset; inference); (3) a browser check that the sticky column's left edge stays within 1 px of the row's left edge after scrolling to the end. No such check exists, because the real-layout gate was dropped (4b). Do not file this entry until Q7 names one.

**9. phonux-owner-api-sketch-input** (p4; optional). Copies the owner's sketch from `phonux-app` commit 52f8409 (`PsuedoCodeGoal.md`) into `design/inputs/owner-api-sketch.md` as a purity test case. The sketch imports from `'phonux'` at line 3 and from a relative app file, `'../panels/CustomPanel.tsx'`, at line 4. The purity check must allow or exclude line 4. Evidence: (1) the new file exists; (2) `git -C /home/user/phonux-app show 52f8409:PsuedoCodeGoal.md | cmp - design/inputs/owner-api-sketch.md` exits 0.

The phonux-app steps are in 4c and are filed there, not in this queue.

## 6. Open questions

Settled decisions are marked. Each question carries a recommended answer.

- **Q1. `url`: optional label, or moved into params?** Recommended: optional opaque label. Relax `isSavedPanel`, and move the title fallback to the host (entry 2). Moving the address into `params` (`hostApi.tsx:148`) is cleaner, but it changes saved files and needs a migration. The field is in the settled shape (`DESIGN.md:30, :588`; rev7 section 6). Owner sign-off required.
- **Q2. Closed Pages members: remove now, or after SimpleBrowser consumes `onPanelsClosed`?** Recommended: make `Host.history` optional now (entry 1); remove the closed-log members after SimpleBrowser's adapter exists. This applies rev7 section 0 decision 1 (History is phonux-app's). It does not reverse it.
- **Q3. USB detection: optional members in phonux, or host only?** Recommended: optional members with names kept (R2); the vendor table moves to the host; `PhoneDetectPrompt` takes a label. Separately: does phonux-app keep its one-time USB resize notice (`phonux-app:README.md:217`)? Removing `electron/phone-usb-detect.ts` and `usb` (4c step 6) removes it unless a host replacement exists. Owner call. SimpleBrowser keeps its own copy.
- **Q4. When do the `about:blank` and `'web'` defaults change?** Recommended: Phase B, after #73 is accepted or with the owner's re-pin go. The `'web'` default moves in lockstep with phonux-app#12. Neither changes in the same change as #11 or #12 adoption.
- **Q5. Labels: shape and timing.** Recommended: a labels option on `PanelsInput` with English defaults, in Phase B. free.music passes its own i18n strings.
- **Q6. `stickyEdge`: promote, and when?** Recommended: promote now as a design section; ship after rc.1 as an opt-in that leaves Q15's default unchanged. Owner chooses between free.music waiting for it, or accepting that Now Playing scrolls away on rc.1. Touches rev7 section 3.7 and Q15.
- **Q7. Browser checks.** The real-layout gate was dropped (phonux#25). Does the app testbed need any browser check, and with which engine? Recommended: none before rc.1, since the rc does not need one. Decide later whether a plain-Chromium check serves the web testbed; that also settles #10's open scope question. The owner also decides whether a WebKit check is needed before free.music ships, since its Tauri webviews are WebKit on macOS and WebView2 on Windows (external knowledge).
- **Q8. Who reviews the exports?** phonux#2 is closed, but rev7 section 10 still names it as the review home. Recommended: entry 0, reviewed with the owner before #73 is accepted.
- **Q9. Name of the History concept.** Recommended: keep the tracking concept generic under whatever name the owner picks. No rename before rc.1 unless the owner names one.
- **Q10. Shared data folder.** phonux-app and SimpleBrowser both write `sessions/sessions.json`, `dead-end-history/history.json` and `phone-size.json` under `~/Library/Application Support/simplebrowser/`, and each rewrites whole files from memory (4a). Recommended: give phonux-app its own folder, with a copy-and-import of its own files only. `sessions.json` stays with SimpleBrowser. The owner confirms which app owns each path.
- **Q11. Supersede the 2026-09-27 host decision.** `phonux-app:plans/records/design-phonux-split.md:7` ("only Electron/IPC stays host") predates the 2026-10-11 statement. Recommended: the owner records a superseding entry in the PR body of the entry that changes it, before any code moves.
- **Q12. Which browser base for SimpleBrowser?** Owner statement 3 says SimpleBrowser should "move over to chromium as a base". Does SimpleBrowser stay on Electron, or move to plain Chromium? Does phonux-app's Electron main process move with it? Recommended: the owner answers before the SimpleBrowser adoption entry is written. Until then this handoff assumes nothing.
- **Q13. SimpleBrowser hold and stub scope.** Is the 2026-09-16 hold on queue integration still in force? Which of the stub's three phonux additions (`pinned`, `PanelWindow<T>`, `onWantMoreWidth`) go into phonux, and which are dropped? Recommended: the owner states when the refactor ends; the adoption stub waits on that answer.
- **Q14. #10 and PR #33.** Close them as superseded by the dropped gate, or re-plan? Recommended: the owner decides, and the coordinator records the outcome on #10 and in phonux#25's Handoff.

## 7. Do-not list

- Do not add to `peerDependencies` or `dependencies` beyond react, react-dom, `@mui/*`, emotion and motion. Do not import electron, usb, `node:` built-ins, WebUSB, or any webview or Chromium API in library source.
- Do not reintroduce chromium, electron, webview, webContents or simplebrowser in library source, comments, docs or fixtures. CHANGELOG history is excepted. Entry 4 makes the guard enforce it.
- Do not change a saved-file shape without a migration path and the versioning section (`DESIGN.md:756`). Do not make a saved file fail because a field is absent without a note.
- Do not reverse settled rev7 decisions silently. Flag any change that touches decision 1, Q15, Q17 or Q18.
- Do not move the DOM-redraw capture engine, its measurements, the Closed Pages persistence, the sessions store or the act loop into phonux.
- Do not put free.music or SimpleBrowser names (Now Playing, Library, sessions, playlist) into the public API, fixtures or defaults.
- Do not file section 5 entries before the owner answers the questions they depend on. Do not write plan bodies by hand; `queue.py` only.
- Do not publish, tag or npm-publish. The owner publishes by hand.
- Do not merge library changes while #73 is open, unless the owner accepts a re-pin of phonux#25 (section 4d).
- Do not run phonux-app against the owner's real profile until 4a is decided.
- Do not delete the six Electron tests, or their nine entries, before the Electron-removal entry (4c step 6). Do not remove the three jsdom entries until the MockTimers warning is fixed.
- Do not hand-edit `etc/phonux.api.md`. Regenerate it with `npm run api-report:update`.
- Do not add suppression comments or Biome ignores. Fix the line (phonux CLAUDE.md, Lint).
- Comment rule, for every subagent brief: comments say why, a constraint the code cannot show. No plan ids, dates or provenance. Doc comments on every export from `index.ts` and `fakeHost.ts` say what a consumer may rely on, not why the code is built that way (`DESIGN.md`, "Doc comments").
- Do not treat items marked (inference) as verified. Re-cite every path:line at current main before a plan's Research cites it.