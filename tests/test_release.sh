#!/usr/bin/env bash
# Tests for tools/release.sh. Run with: bash tests/test_release.sh
#
# Builds a throwaway "GitHub" (a local bare repo) and a developer's copy with
# a changelog, then runs the real release script against them. The steps
# that need GitHub itself (its test results, the Release page) are skipped.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export WDW_RELEASE_OFFLINE=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { # description, command...: passes if the command succeeds
  local what="$1"
  shift
  if "$@"; then pass "$what"; else fail "$what"; fi
}

git init -q --bare -b main "$WORK/github.git"
git clone -q "$WORK/github.git" "$WORK/dev" 2>/dev/null
DEV="$WORK/dev"
mkdir -p "$DEV/tools"
cp "$PROJECT_DIR/tools/release.sh" "$DEV/tools/release.sh"
cat > "$DEV/CHANGELOG.md" <<'EOF'
# Changelog

## Unreleased

### Added
- A new thing.

## 2026-09-25: first release
- The start.
EOF
git -C "$DEV" add -A
git -C "$DEV" commit -qm "first version"
git -C "$DEV" push -q origin main

OUT="$WORK/out"
release() { "$DEV/tools/release.sh" "$@" > "$OUT" 2>&1; }
expect_refused() { # description, message pattern, release arguments...
  local what="$1" pattern="$2"
  shift 2
  if release "$@"; then
    fail "$what (it released)"
  elif grep -q -- "$pattern" "$OUT"; then
    pass "$what"
  else
    fail "$what (said: $(tr '\n' '|' < "$OUT"))"
  fi
}
tags_on_github() { git -C "$WORK/github.git" tag --list | tr '\n' ' '; }

echo "Refuses:"
expect_refused "a version that isn't X.Y.Z" "X.Y.Z" 1.0
expect_refused "no version at all" "X.Y.Z"
echo "edit" >> "$DEV/CHANGELOG.md"
expect_refused "uncommitted changes" "commit or undo" 1.0.0
git -C "$DEV" commit -qam "an unpushed change"
expect_refused "commits not yet on GitHub" "doesn't match GitHub" 1.0.0
git -C "$DEV" push -q origin main
check "and publishes nothing when refusing" [ -z "$(tags_on_github)" ]

echo "A release:"
if release 1.0.0; then pass "succeeds"; else fail "succeeds ($(tr '\n' '|' < "$OUT"))"; fi
check "puts the v1.0.0 tag on GitHub" [ "$(tags_on_github)" = "v1.0.0 " ]
if [ "$(git -C "$WORK/github.git" rev-parse main)" = "$(git -C "$WORK/github.git" rev-parse 'v1.0.0^{commit}')" ]; then
  pass "on the release commit, which is pushed to main too"
else
  fail "on the release commit, which is pushed to main too"
fi
check "commits it as \"Release 1.0.0\"" [ "$(git -C "$DEV" log -1 --format=%s)" = "Release 1.0.0" ]
if grep -q "^## 1.0.0 - $(date +%F)$" "$DEV/CHANGELOG.md" \
  && [ "$(grep -n '^## ' "$DEV/CHANGELOG.md" | head -n 2 | cut -d: -f2 | tr '\n' '|')" = "## Unreleased|## 1.0.0 - $(date +%F)|" ]; then
  pass "dates the changelog section, under a new, empty Unreleased"
else
  fail "dates the changelog section, under a new, empty Unreleased ($(grep '^## ' "$DEV/CHANGELOG.md" | tr '\n' '|'))"
fi
if git -C "$DEV" tag -l --format='%(contents)' v1.0.0 | grep -q "A new thing."; then
  pass "puts the changelog entries in the tag's notes"
else
  fail "puts the changelog entries in the tag's notes"
fi

echo "After a release:"
expect_refused "an empty Unreleased section" "is empty" 1.0.1
python3 - "$DEV/CHANGELOG.md" <<'EOF'
import sys
p = sys.argv[1]
text = open(p).read().replace("## Unreleased\n", "## Unreleased\n\n### Fixed\n- A fix.\n", 1)
open(p, "w").write(text)
EOF
git -C "$DEV" commit -qam "a fix"
git -C "$DEV" push -q origin main
expect_refused "the same version again" "already exists" 1.0.0
expect_refused "an older version" "isn't newer" 0.9.0
if release 1.0.10; then pass "takes 1.0.10 (newer than 1.0.0 as a number)"; else fail "takes 1.0.10 ($(tr '\n' '|' < "$OUT"))"; fi
expect_refused "1.0.9 after 1.0.10" "isn't newer" 1.0.9

echo
if [ "$failures" -eq 0 ]; then
  echo "All release.sh tests passed."
else
  echo "$failures release.sh test(s) failed."
  exit 1
fi
