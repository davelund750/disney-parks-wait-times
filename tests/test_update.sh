#!/usr/bin/env bash
# Tests for update.sh, the weekly self-update. Run with: bash tests/test_update.sh
#
# Builds a throwaway "GitHub" (a local bare repo) and a "Pi" clone of it, with
# a stand-in installer, then runs the real update.sh in three situations. The
# reboot is replaced with a no-op, so this is safe to run anywhere.

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

# "GitHub", plus a developer's copy that publishes to it.
git init -q --bare -b main "$WORK/github.git"
git clone -q "$WORK/github.git" "$WORK/dev" 2>/dev/null
cp "$PROJECT_DIR/update.sh" "$WORK/dev/update.sh"
# Stand-in installer: records that it ran, and with which options.
cat > "$WORK/dev/install.sh" <<'EOF'
#!/usr/bin/env bash
echo "stand-in installer ran with: $*"
EOF
chmod +x "$WORK/dev/install.sh" "$WORK/dev/update.sh"
git -C "$WORK/dev" add -A
git -C "$WORK/dev" commit -qm "first version"
git -C "$WORK/dev" push -q origin main

# The "Pi", cloned from "GitHub".
git clone -q "$WORK/github.git" "$WORK/pi"

publish() { # message: make a change in the developer copy and push it
  echo "$1" >> "$WORK/dev/CHANGES"
  git -C "$WORK/dev" add -A
  git -C "$WORK/dev" commit -qm "$1"
  git -C "$WORK/dev" push -q origin main
}
run_update() { : > "$WDW_UPDATE_LOG"; "$WORK/pi/update.sh"; }

echo "When nothing has changed:"
run_update
expect_log "reports it's up to date" "already up to date"
expect_no_log "doesn't run the installer" "re-running installer"
expect_log "still reboots" "rebooting"

echo "When a new version is published:"
publish "second version"
run_update
expect_log "pulls it" "updated .* -> "
expect_log "re-runs the installer, skipping Wi-Fi" "stand-in installer ran with: --skip-wifi"
expect_log "reports the installer finished" "installer finished"
expect_log "reboots" "rebooting"
if [ "$(git -C "$WORK/pi" rev-parse HEAD)" = "$(git -C "$WORK/dev" rev-parse HEAD)" ]; then
  pass "ends up on the published version"
else
  fail "ends up on the published version"
fi

echo "When the installer fails:"
cat > "$WORK/dev/install.sh" <<'EOF'
#!/usr/bin/env bash
echo "stand-in installer failing"; exit 1
EOF
publish "version with a failing installer"
run_update
expect_log "logs the failure" "installer FAILED"
expect_log "still reboots" "rebooting"

echo "When the Pi's copy was edited locally and can't be updated cleanly:"
echo "local edit" > "$WORK/pi/LOCAL"
git -C "$WORK/pi" add LOCAL
git -C "$WORK/pi" commit -qm "edited on the Pi"
pi_before="$(git -C "$WORK/pi" rev-parse HEAD)"
publish "version the Pi can't fast-forward to"
run_update
expect_log "logs that the update failed" "git pull FAILED"
expect_log "still reboots" "rebooting"
if [ "$(git -C "$WORK/pi" rev-parse HEAD)" = "$pi_before" ]; then
  pass "keeps its current version"
else
  fail "keeps its current version"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "All update.sh tests passed."
else
  echo "$failures update.sh test(s) failed."
  exit 1
fi
