#!/usr/bin/env bash
# Tests for update.sh, the weekly self-update. Run with: bash tests/test_update.sh
#
# Builds a throwaway "GitHub" (a local bare repo) and a "Pi" clone of it, with
# a stand-in installer, then runs the real kiosk/update.sh in several
# situations: releases, unreleased work, pre-releases, a withdrawn release,
# failures, and kiosks moving over from older updaters.
# The reboot is replaced with a no-op, so this is safe to run anywhere.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export WDW_UPDATE_LOG="$WORK/update.log"
export WDW_REBOOT_CMD=true
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
expect_log() { # description, pattern
  if grep -q -- "$2" "$WDW_UPDATE_LOG"; then pass "$1"; else fail "$1 (log: $(tr '\n' '|' < "$WDW_UPDATE_LOG"))"; fi
}
expect_no_log() {
  if grep -q -- "$2" "$WDW_UPDATE_LOG"; then fail "$1"; else pass "$1"; fi
}
expect_on() { # description, pi folder, dev folder, what the Pi should be on
  if [ "$(git -C "$2" rev-parse HEAD)" = "$(git -C "$3" rev-parse "$4^{commit}")" ]; then
    pass "$1"
  else
    fail "$1 (on $(git -C "$2" describe --tags --always))"
  fi
}

STUB_INSTALLER='#!/usr/bin/env bash
echo "stand-in installer ran with: $*"'

# A "GitHub" and a developer's copy that publishes to it, starting with the
# given updater at the given path.
make_github() { # name, updater source file, updater path in the repo
  git init -q --bare -b main "$WORK/$1.git"
  git clone -q "$WORK/$1.git" "$WORK/$1-dev" 2>/dev/null
  mkdir -p "$(dirname "$WORK/$1-dev/$3")"
  cp "$2" "$WORK/$1-dev/$3"
  printf '%s\n' "$STUB_INSTALLER" > "$WORK/$1-dev/install.sh"
  chmod +x "$WORK/$1-dev/install.sh" "$WORK/$1-dev/$3"
  git -C "$WORK/$1-dev" add -A
  git -C "$WORK/$1-dev" commit -qm "first version"
  git -C "$WORK/$1-dev" push -q origin main
}
publish() { # dev folder, message: commit a change to main and push it
  echo "$2" >> "$1/CHANGES"
  git -C "$1" add -A
  git -C "$1" commit -qm "$2"
  git -C "$1" push -q origin main
}
release() { # dev folder, tag: tag main's tip as a release and push the tag
  git -C "$1" tag "$2"
  git -C "$1" push -q origin "$2"
}
run_update() { : > "$WDW_UPDATE_LOG"; "$@"; }

make_github hub "$PROJECT_DIR/kiosk/update.sh" kiosk/update.sh
DEV="$WORK/hub-dev"
PI="$WORK/pi"
git clone -q "$WORK/hub.git" "$PI"
UPDATE="$PI/kiosk/update.sh"

echo "Before any release is published:"
first="$(git -C "$PI" rev-parse HEAD)"
run_update "$UPDATE"
expect_log "says there's nothing to install" "no releases published yet"
expect_no_log "doesn't run the installer" "re-running installer"
expect_log "still reboots" "rebooting"
expect_on "stays where it is" "$PI" "$DEV" "$first"

echo "When a release is published:"
publish "$DEV" "second version"
release "$DEV" v1.0.0
run_update "$UPDATE"
expect_log "switches to it" "updated .* -> v1.0.0"
expect_log "re-runs the installer, skipping Wi-Fi" "stand-in installer ran with: --skip-wifi"
expect_log "reports the installer finished" "installer finished"
expect_log "reboots" "rebooting"
expect_on "ends up on the release" "$PI" "$DEV" v1.0.0

echo "When nothing new has been released:"
run_update "$UPDATE"
expect_log "reports it's up to date" "already up to date (v1.0.0)"
expect_no_log "doesn't run the installer" "re-running installer"
expect_log "still reboots" "rebooting"

echo "When there's unreleased work on main, and a pre-release:"
publish "$DEV" "work in progress"
publish "$DEV" "more work in progress"
release "$DEV" v1.1.0-beta.1
run_update "$UPDATE"
expect_log "ignores both" "already up to date (v1.0.0)"
expect_on "stays on the release" "$PI" "$DEV" v1.0.0

echo "When the next release comes out:"
release "$DEV" v1.1.0
run_update "$UPDATE"
expect_log "switches to it" "updated .* -> v1.1.0"
expect_on "ends up on it" "$PI" "$DEV" v1.1.0

echo "Versions compare as numbers, not text (1.10 is newer than 1.9):"
publish "$DEV" "version 1.10"
release "$DEV" v1.10.0
publish "$DEV" "a fix, mislabeled as 1.9"
release "$DEV" v1.9.0
run_update "$UPDATE"
expect_on "picks 1.10.0" "$PI" "$DEV" v1.10.0

echo "When a bad release is withdrawn (its tag deleted on GitHub):"
git -C "$DEV" push -q origin :refs/tags/v1.10.0
git -C "$DEV" tag -d v1.10.0 > /dev/null
run_update "$UPDATE"
expect_log "goes back to the newest remaining release" "updated .* -> v1.9.0"
expect_on "ends up on it" "$PI" "$DEV" v1.9.0

echo "When the Pi's copy was edited and the edit is in the way:"
echo "edited on the Pi" >> "$PI/CHANGES"
publish "$DEV" "version 1.11"
release "$DEV" v1.11.0
run_update "$UPDATE"
expect_log "logs that it couldn't switch" "switching to v1.11.0 FAILED"
expect_log "still reboots" "rebooting"
expect_on "keeps its current version" "$PI" "$DEV" v1.9.0
git -C "$PI" checkout -q -- CHANGES

echo "When GitHub can't be reached:"
git -C "$PI" remote set-url origin "$WORK/nowhere.git"
run_update "$UPDATE"
expect_log "logs the failure" "git fetch FAILED"
expect_log "still reboots" "rebooting"
expect_on "keeps its current version" "$PI" "$DEV" v1.9.0
git -C "$PI" remote set-url origin "$WORK/hub.git"

echo "When the installer fails:"
printf '#!/usr/bin/env bash\necho "stand-in installer failing"; exit 1\n' > "$DEV/install.sh"
publish "$DEV" "version with a failing installer"
release "$DEV" v1.12.0
run_update "$UPDATE"
expect_log "logs the failure" "installer FAILED"
expect_log "still reboots" "rebooting"
expect_on "keeps the new version" "$PI" "$DEV" v1.12.0

# A kiosk still running an older updater, from a past commit: its next update
# must bring in the current updater, which then follows releases.
migrate() { # name, commit, the updater's path in that commit
  local old="$WORK/$1-old-updater"
  if ! git -C "$PROJECT_DIR" show "$2:$3" > "$old" 2>/dev/null; then
    echo "  skip  (the old updater from $2 isn't in this checkout's history)"
    return
  fi
  make_github "$1" "$old" "$3"
  local dev="$WORK/$1-dev" pi="$WORK/$1-pi"
  git clone -q "$WORK/$1.git" "$pi"
  # The change: today's updater in kiosk/, published on main with a release.
  git -C "$dev" rm -q "$3"
  mkdir -p "$dev/kiosk"
  cp "$PROJECT_DIR/kiosk/update.sh" "$dev/kiosk/update.sh"
  chmod +x "$dev/kiosk/update.sh"
  publish "$dev" "release updater"
  release "$dev" v1.0.0
  run_update "$pi/$3"   # the old path, as its systemd unit still has it
  expect_log "the old updater takes the change" "updated "
  expect_log "and runs the installer, which rewrites the paths" "stand-in installer ran with: --skip-wifi"
  if [ -x "$pi/kiosk/update.sh" ]; then pass "ends up with the new updater"; else fail "ends up with the new updater"; fi
  publish "$dev" "unreleased work"
  publish "$dev" "the next release"
  release "$dev" v1.0.1
  run_update "$pi/kiosk/update.sh"
  expect_log "the next update follows releases" "updated .* -> v1.0.1"
}

echo "A kiosk on the old, flat layout (update.sh at the top level):"
migrate flat 924f248 update.sh

echo "A kiosk whose updater follows main (before releases):"
migrate main fdf116c kiosk/update.sh

echo
if [ "$failures" -eq 0 ]; then
  echo "All update.sh tests passed."
else
  echo "$failures update.sh test(s) failed."
  exit 1
fi
