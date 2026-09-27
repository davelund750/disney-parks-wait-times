#!/usr/bin/env bash
# Publishes a release. Kiosks install the newest release in their weekly
# update (kiosk/update.sh), so this is the step that ships a change to them;
# pushing to main alone doesn't.
#
#   make release VERSION=1.2.0      (or: tools/release.sh 1.2.0)
#
# Version numbers: X.Y.Z. Raise X for a change that needs a fresh install or
# new hardware, Y for new features, Z for fixes only.
#
# First it checks: the version is new, you're on main with nothing
# uncommitted, main matches GitHub, GitHub's tests passed on it, and the
# changelog's "Unreleased" section has entries. Then it renames that section
# to the version and date (starting a new "Unreleased" that says there are
# no unreleased changes, until the next one is added), commits that
# as "Release X.Y.Z", tags it vX.Y.Z, pushes both, and creates a GitHub
# Release with the same notes.
#
# For tests (tests/test_release.sh), WDW_RELEASE_OFFLINE=1 skips the two
# steps that need the gh command: the test check and the GitHub Release.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() { echo "Not released: $*" >&2; exit 1; }

version="${1:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "give the version as X.Y.Z, e.g. make release VERSION=1.2.0"
tag="v$version"
offline="${WDW_RELEASE_OFFLINE:-}"

[ "$(git branch --show-current)" = "main" ] || fail "switch to main first."
[ -z "$(git status --porcelain)" ] || fail "commit or undo your changes first (see git status)."

git fetch --quiet --tags origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || fail "main doesn't match GitHub; push or pull first."

if git rev-parse --quiet --verify "refs/tags/$tag" > /dev/null; then
  fail "$tag already exists."
fi
latest="$(git tag --list 'v*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 1p || true)"
if [ -n "$latest" ]; then
  newest="$(printf '%s\n%s\n' "$latest" "$tag" | sort -t . -k 1.2,1n -k 2,2n -k 3,3n | tail -n 1)"
  [ "$newest" = "$tag" ] || fail "$tag isn't newer than the latest release, $latest."
fi

if [ -z "$offline" ]; then
  command -v gh > /dev/null || fail "the gh command isn't installed, so GitHub's test results can't be checked."
  result="$(gh run list --commit "$(git rev-parse HEAD)" --workflow tests.yml \
    --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"')"
  case "$result" in
    "completed success") ;;
    "") fail "GitHub hasn't run the tests on this commit yet." ;;
    completed*) fail "GitHub's tests failed on this commit ($result)." ;;
    *) fail "GitHub's tests are still running on this commit; try again when they finish." ;;
  esac
fi

# The changelog: "## Unreleased" becomes "## X.Y.Z - date", under a new
# "## Unreleased" holding only the placeholder line. Its entries are the
# release notes.
notes="$(mktemp)"
trap 'rm -f "$notes"' EXIT
python3 - "$version" "$(date +%F)" "$notes" <<'EOF' || exit 1
import re, sys
version, date, notes_path = sys.argv[1:]
# What "Unreleased" says when nothing is waiting; replace it with entries.
PLACEHOLDER = "No current unreleased changes."
text = open("CHANGELOG.md").read()
match = re.search(r"^## Unreleased\n(.*?)(?=^## |\Z)", text, re.M | re.S)
if not match:
    sys.exit('Not released: CHANGELOG.md has no "## Unreleased" section.')
notes = match.group(1).replace(PLACEHOLDER, "").strip()
if not notes:
    sys.exit('Not released: the changelog\'s "Unreleased" section is empty; add what changed.')
open(notes_path, "w").write(notes + "\n")
released = f"## Unreleased\n\n{PLACEHOLDER}\n\n## {version} - {date}\n\n{notes}\n\n"
open("CHANGELOG.md", "w").write(text[:match.start()] + released + text[match.end():])
EOF

git add CHANGELOG.md
git commit --quiet -m "Release $version"
git tag --annotate "$tag" --file "$notes"
git push --quiet --atomic origin main "$tag"
echo "Released $version: kiosks install it in their next weekly update."

if [ -z "$offline" ]; then
  gh release create "$tag" --verify-tag --title "$version" --notes-file "$notes"
fi
