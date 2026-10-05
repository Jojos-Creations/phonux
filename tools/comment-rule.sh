#!/usr/bin/env bash
# Fails when a comment this branch adds carries provenance: who decided it, which ticket asked for it, a date, a design
# revision. Those belong in the commit message and the changelog.
#   tools/comment-rule.sh [BASE_REF]   BASE_REF defaults to the merge-base of HEAD and main
#   tools/comment-rule.sh --self-test
# Reads the added lines of `git diff -U0 BASE` (untracked files included) in *.ts, *.tsx, *.mjs and *.sh, skipping
# test/fixtures/** and node_modules. A comment line starts with //, /* or *, or with # in a shell file. Each rule below
# matches whole words, ignoring case. Prints 'checked L comment lines in F files'; exits non-zero on a hit or when the
# diff cannot be read. F counts the files in scope that gained a line.
set -euo pipefail

self="${BASH_SOURCE[0]}"
case "$self" in /*) ;; *) self="$PWD/$self" ;; esac

# One 'name<TAB>regex' per line, applied to the lowercased comment. [^a-z0-9_] stands in for \b, which awk lacks.
RULES='owner	(^|[^a-z0-9_])owner([^a-z0-9_]|$)
plans/	(^|[^a-z0-9_])plans/
queue entry	(^|[^a-z0-9_])queue entry([^a-z0-9_]|$)
E<n>	(^|[^a-z0-9_])e[0-9]+[a-z]*([^a-z0-9_]|$)
Q<n>	(^|[^a-z0-9_])q[0-9]+([^a-z0-9_]|$)
revision <n>	(^|[^a-z0-9_])rev[ision]* [0-9]
date	(^|[^0-9])[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]([^0-9]|$)
DESIGN-DRAFT	(^|[^a-z0-9_])design-draft([^a-z0-9_]|$)'

scan_diff() { # reads a unified diff on stdin; prints 'V<TAB>file:line<TAB>rule<TAB>text' per hit, then 'S<TAB>L<TAB>F'
  RULES="$RULES" awk '
    BEGIN {
      n = split(ENVIRON["RULES"], lines, "\n")
      for (i = 1; i <= n; i++) { split(lines[i], parts, "\t"); ruleName[i] = parts[1]; ruleRe[i] = parts[2] }
      ruleCount = n
    }
    function inScope(path) {
      if (path !~ /\.(ts|tsx|mjs|sh)$/) return 0
      if (path ~ /^test\/fixtures\//) return 0
      if (path ~ /(^|\/)node_modules\//) return 0
      return 1
    }
    /^diff --git / { hunk = 0; file = ""; scoped = 0; next }
    hunk == 0 && /^\+\+\+ / {
      path = substr($0, 5)
      if (path == "/dev/null") { file = ""; next }
      sub(/^b\//, "", path)
      file = path; scoped = inScope(file)
      next
    }
    /^@@ / {
      hunk = 1
      start = $0; sub(/^@@ -[0-9,]+ \+/, "", start); sub(/[ ,].*$/, "", start)
      lineNo = start + 0
      next
    }
    hunk == 1 && /^\+/ {
      if (scoped) {
        if (!(file in seen)) { seen[file] = 1; fileCount++ }
        text = substr($0, 2)
        trimmed = text; sub(/^[ \t]+/, "", trimmed)
        isComment = (trimmed ~ /^\/\// || trimmed ~ /^\/\*/ || trimmed ~ /^\*/ || (file ~ /\.sh$/ && trimmed ~ /^#/))
        if (isComment) {
          commentLines++
          lower = tolower(trimmed)
          for (i = 1; i <= ruleCount; i++) {
            if (lower ~ ruleRe[i]) printf "V\t%s:%d\t%s\t%s\n", file, lineNo, ruleName[i], trimmed
          }
        }
      }
      lineNo++
      next
    }
    END { printf "S\t%d\t%d\n", commentLines + 0, fileCount + 0 }
  '
}

run_check() {
  local base=${1:-} top diff_file out summary hits comment_lines file_count
  top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "comment-rule: not inside a git work tree" >&2; return 2; }
  cd "$top"
  if [ -z "$base" ]; then
    base=$(git merge-base HEAD main 2>/dev/null) || { echo "comment-rule: cannot find the merge-base of HEAD and main" >&2; return 2; }
  fi
  if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
    echo "comment-rule: '$base' does not name a commit, so the diff cannot be read" >&2
    return 2
  fi
  diff_file=$(mktemp)
  trap 'rm -f "$diff_file"' RETURN
  if ! git -c core.quotePath=false diff -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ "$base" -- '*.ts' '*.tsx' '*.mjs' '*.sh' > "$diff_file"; then
    echo "comment-rule: git diff against '$base' failed, so nothing was checked" >&2
    return 2
  fi
  # A file git has not been told about yet is invisible to git diff, so it is diffed against nothing here.
  while IFS= read -r untracked; do
    [ -n "$untracked" ] || continue
    git -c core.quotePath=false diff --no-index -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ -- /dev/null "$untracked" >> "$diff_file" || true
  done < <(git -c core.quotePath=false ls-files --others --exclude-standard -- '*.ts' '*.tsx' '*.mjs' '*.sh')

  out=$(scan_diff < "$diff_file")
  hits=$(printf '%s\n' "$out" | awk -F '\t' '$1 == "V"')
  summary=$(printf '%s\n' "$out" | awk -F '\t' '$1 == "S"')
  comment_lines=$(printf '%s' "$summary" | cut -f2)
  file_count=$(printf '%s' "$summary" | cut -f3)
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | awk -F '\t' '{ printf "%s  [%s]  %s\n", $2, $3, $4 }' >&2
  fi
  echo "checked $comment_lines comment lines in $file_count files"
  if [ "$file_count" -eq 0 ]; then
    echo "comment-rule: no file in scope gained a line against $base: nothing was checked" >&2
  fi
  [ -z "$hits" ]
}

self_test() {
  local scratch passed=0 total=0 out status
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' RETURN
  local repo="$scratch/repo"
  mkdir -p "$repo/src" "$repo/test/fixtures/vendored"
  (
    cd "$repo"
    git init -q
    git symbolic-ref HEAD refs/heads/main
    printf 'export const a = 1;\n' > src/a.ts
    git add -A
    git -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false commit -q -m base
  )

  reset_repo() { (cd "$repo" && git checkout -q -- . && git clean -fdq); }
  local workdir=$repo
  expect() { # name, want ('pass' or 'fail'), then a command run inside $workdir
    local name=$1 want=$2 got=pass
    shift 2
    status=0
    out=$(cd "$workdir" && "$@" 2>/dev/null) || status=$?
    if [ "$status" -ne 0 ]; then got=fail; fi
    total=$((total + 1))
    if [ "$got" = "$want" ]; then
      passed=$((passed + 1))
      echo "ok   $name (exit $status, '$out')"
    else
      echo "FAIL $name (exit $status, '$out', wanted $want)"
    fi
  }
  plant() { printf '%s\n' "$2" >> "$repo/$1"; }
  head_sha=$(cd "$repo" && git rev-parse HEAD)

  plant src/a.ts '// owner 2026-10-03'
  expect "a planted '// owner 2026-10-03' exits non-zero" fail "$self" "$head_sha"
  reset_repo
  plant src/a.ts '// Q8 says so'
  expect "a planted '// Q8 says so' exits non-zero" fail "$self" "$head_sha"
  reset_repo
  plant src/a.ts '// queued intents replay at settle'
  expect "a planted '// queued intents replay at settle' exits 0 and counts one line in one file" pass "$self" "$head_sha"
  if [ "$out" != "checked 1 comment lines in 1 files" ]; then
    total=$((total + 1)); echo "FAIL the clean comment is counted (printed '$out')"
  else
    total=$((total + 1)); passed=$((passed + 1)); echo "ok   the clean comment is counted (printed '$out')"
  fi
  reset_repo

  mkdir -p "$repo/test/fixtures/vendored"
  printf '// owner 2026-10-03\nexport const v = 1;\n' > "$repo/test/fixtures/vendored/v.ts"
  plant src/a.ts '// fine'
  expect 'the vendored fixture directory is excluded: only src/a.ts counts' pass "$self" "$head_sha"
  if [ "$out" != "checked 1 comment lines in 1 files" ]; then
    total=$((total + 1)); echo "FAIL the fixture file is not counted (printed '$out')"
  else
    total=$((total + 1)); passed=$((passed + 1)); echo "ok   the fixture file is not counted (printed '$out')"
  fi
  reset_repo

  expect 'an unresolvable base exits non-zero' fail "$self" deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
  local trunk="$scratch/trunk"
  mkdir -p "$trunk"
  (
    cd "$trunk"
    git init -q
    git symbolic-ref HEAD refs/heads/trunk
    printf 'export const a = 1;\n' > a.ts
    git add -A
    git -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false commit -q -m base
  )
  workdir=$trunk
  expect 'a default base with no main branch exits non-zero' fail "$self"
  workdir=$repo

  for line in '// plans/some-plan.md' '// per the queue entry' '// see E3b' '/* DESIGN-DRAFT note */' ' * revision 7 of the design' '// done on 2026-10-04'; do
    reset_repo
    plant src/a.ts "$line"
    expect "a comment '$line' exits non-zero" fail "$self" "$head_sha"
  done
  reset_repo
  plant src/a.ts 'const owner = 1;'
  plant src/a.ts '// ownership moves with the buffer; power-of-two sizes; a downer day'
  expect 'code that names an owner, and words that only contain one, pass' pass "$self" "$head_sha"
  reset_repo
  printf '// owner says\nexport const u = 1;\n' > "$repo/src/untracked.ts"
  expect 'a new file git has not been told about is checked too' fail "$self" "$head_sha"
  reset_repo
  printf '#!/usr/bin/env bash\n# owner says\n' > "$repo/run.sh"
  expect 'a shell comment is checked' fail "$self" "$head_sha"
  reset_repo

  echo "self-test: $passed/$total"
  [ "$passed" -eq "$total" ] && [ "$total" -gt 0 ]
}

case "${1:-}" in
  --self-test) self_test ;;
  --*) echo "usage: tools/comment-rule.sh [BASE_REF | --self-test]" >&2; exit 2 ;;
  *) run_check "${1:-}" ;;
esac
