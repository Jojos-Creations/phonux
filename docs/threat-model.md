# phonux: threat model

phonux is a React library that lays views out in a row of phone-sized panels. It makes no network request, opens no web
content and keeps nothing between launches unless the host app passes a `storage` option. So the risks are mostly in how
the package is built and published, and in what a host app does with the views and saved files it hands phonux. This page
says what is protected, who it is defended against, and what is still open. Design reasons for the code are in `DESIGN.md`.

## What we protect

In order of damage if lost:

1. The `phonux` package name on npm. Every app that installs it runs what is published.
2. The `main` branch, and the `release` branch that the test build is promoted from. Whatever reaches `main` can be published.
3. The `npm-release` environment, the publish identity it holds, and the one npm maintainer account.
4. A host app's saved workspace files, which phonux reads back.

## Who we defend against, and who we do not

We defend against a stranger on GitHub: anyone can open a pull request or post a review on this public repository. We also
defend against a compromised dev dependency, and against a hostile saved workspace file or imported panel data.

We do not defend against a host app that is itself hostile, a person with write access to the repository, or a compromised
GitHub or npm. We also do not defend a host's own views: phonux draws them, it does not sandbox them.

## Entry points

- Pull requests and reviews from any GitHub user.
- Dependency updates (Renovate opens them; none merges itself).
- The publish workflow, `.github/workflows/publish-release.yml`, started by hand.
- The CLI (`cli/main.ts`), which runs in a developer's own app folder and starts `npm`, `npx cap`, Gradle and Xcode tools.
- A saved workspace file, read through `isWorkspaceState` in `workspaceState.ts` when a `storage` option is set
  (`panels/useWorkspacePersistence.ts`).

## Trust boundaries

- A stranger to `main`. The agents' merge judge (`tools/queue/report_rules.py`) and a human merge are the gate.
- `main` to npm. The `npm-release` environment needs a person to approve the run, and the workflow refuses a commit that is
  not on `main`.
- A saved file to the library. `isWorkspaceState` checks the shape; the cleaning functions in `workspaceState.ts` drop
  entries they cannot read and report each drop through `onNote`.
- The library to the host's views. Hosts supply every view; phonux renders them as React children.

## Top attack paths

1. **Forge the verifier's pass on a pull request so an agent merges it.** The judge (`newest_comment_review`) takes the
   newest COMMENT review and checks its shape, verdict, commit and evidence count. It does not check who wrote the review,
   and on a public repository any account can submit one. A stranger's later "pass" can replace an honest "fail". Nothing
   else in the repository (no code owners file, no fork check) stops it today. Open.
2. **Compromise a dev dependency that runs inside the publish job.** The job runs `npm ci` with install scripts, then the
   gate, then publishes, and it holds `id-token: write` for all of those steps. The approval is given before any of it
   runs. What helps today: action versions are pinned by digest, the npm cache is off, the release commit must be on
   `main`, lockfile hashes are checked, and Renovate waits seven days before it proposes a new release. The job also still
   reads an `NPM_TOKEN` secret when one exists and uses it instead of trusted publishing. Open: building and publishing
   share one job.
3. **Take over the npm account or a leftover publish token.** One maintainer account holds the package. Account settings
   live on npmjs.com and cannot be checked from this repository.
4. **Hand a host app a hostile saved workspace.** `isWorkspaceState` is strict about the shape and accepts unknown keys. The
   library renders nothing from the file as HTML. The fields a file can set that a host may act on are `url` and `params`.
   The guard checks that `url` is a string and does not look inside `params`. Left to the host: see below.
5. **Typosquat through the CLI.** `phonux build` runs `npx cap`. It first checks that `@capacitor/cli`, `@capacitor/core`
   and the platform package exist in the app's `node_modules` (`cli/checks.ts`), but `npx` is not told to refuse a download
   (`cli/plan.ts`). Low. Open: pass `--no-install`. The Android bundle is signed with SHA-1 (`cli/plan.ts`), which current
   Java treats as unsigned. Open.

## What a host app can rely on

- The library makes no network request and does not touch `localStorage`, cookies or the page's location. Storage, files and
  sync go through options the host passes. The one browser API it calls on its own is the clipboard, to copy a code the person asks to copy (`trustScreen.tsx`).
- A saved file that fails `isWorkspaceState` is not restored. A bad entry inside a good file is dropped and reported.
- The library builds no markup from strings: its source has no `innerHTML`, `eval`, `postMessage` or iframe.

## What a host app must do

- Treat a saved workspace as untrusted input. Pass `isWorkspaceState` over any file that did not come through the `storage`
  option, before handing it to phonux.
- Check `url` and `params` before a view uses them. A view that loads `url` must allow only the schemes and hosts it
  expects.
- Show remote pages only in a sandboxed iframe or an isolated webview that shares no preload script with the host.
- Allow the styles Emotion injects (`style-src 'unsafe-inline'`, or a nonce) in the host's Content-Security-Policy.
