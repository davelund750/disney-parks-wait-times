#!/usr/bin/env bash
# Tests for kiosk/firstboot.sh, the install on a new Pi's first boot.
# Run with: bash tests/test_firstboot.sh
#
# Builds a throwaway "GitHub" (a local bare repo) whose install.sh is a
# stand-in, a "boot partition" folder holding the script as prepare_sd.py
# leaves it, and a stand-in systemctl, then runs the real script. Nothing on
# this computer is installed or rebooted.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export DPWT_FIRSTBOOT_LOG="$WORK/firstboot.log"
export DPWT_FIRSTBOOT_USER="$USER"
export DPWT_FIRSTBOOT_HOME="$WORK/home"
export DPWT_NETWORK_TRIES=1
export DPWT_UNIT_DIR="$WORK/units"
export DPWT_SYSTEMCTL="$WORK/systemctl"
export DPWT_REBOOT_CMD="$WORK/reboot"
mkdir -p "$DPWT_FIRSTBOOT_HOME" "$DPWT_UNIT_DIR"
# Stand-ins that record how they were called.
printf '#!/usr/bin/env bash\necho "$*" >> "%s/systemctl.calls"\n' "$WORK" > "$DPWT_SYSTEMCTL"
printf '#!/usr/bin/env bash\ntouch "%s/rebooted"\n' "$WORK" > "$DPWT_REBOOT_CMD"
chmod +x "$DPWT_SYSTEMCTL" "$DPWT_REBOOT_CMD"

failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { # description, command...: passes if the command succeeds
  local what="$1"
  shift
  if "$@"; then pass "$what"; else fail "$what"; fi
}
logged() { grep -q -- "$1" "$DPWT_FIRSTBOOT_LOG"; }

# "GitHub": a stand-in installer, a release, then unreleased work on main.
git init -q --bare -b main "$WORK/github.git"
git clone -q "$WORK/github.git" "$WORK/dev" 2>/dev/null
# shellcheck disable=SC2016 # expanded when the stand-in installer runs
printf '#!/usr/bin/env bash\necho "installer ran for $SUDO_USER in $PWD with: $*" >> "%s/installer.calls"\n' "$WORK" > "$WORK/dev/install.sh"
chmod +x "$WORK/dev/install.sh"
git -C "$WORK/dev" add -A
git -C "$WORK/dev" commit -qm "a release"
git -C "$WORK/dev" tag v1.0.0
echo "work in progress" > "$WORK/dev/WIP"
git -C "$WORK/dev" add -A
git -C "$WORK/dev" commit -qm "unreleased work"
git -C "$WORK/dev" push -q origin main v1.0.0

# The boot partition, as prepare_sd.py leaves it.
BOOT="$WORK/boot"
make_boot() { # repository address
  rm -rf "$BOOT" "$WORK"/*.calls "$WORK/rebooted" "$DPWT_FIRSTBOOT_LOG" "$DPWT_FIRSTBOOT_HOME/disney-parks-wait-times"
  mkdir -p "$BOOT"
  cp "$PROJECT_DIR/kiosk/firstboot.sh" "$BOOT/disney-parks-firstboot.sh"
  echo "repo=$1" > "$BOOT/disney-parks-firstboot.conf"
}
APP="$DPWT_FIRSTBOOT_HOME/disney-parks-wait-times"
UNIT="$DPWT_UNIT_DIR/disney-parks-firstboot.service"

echo "Setting up the one-time install service:"
make_boot "$WORK/github.git"
bash "$BOOT/disney-parks-firstboot.sh" enable
check "writes the service" [ -f "$UNIT" ]
check "which runs the script's install step" grep -qx "ExecStart=/bin/bash $BOOT/disney-parks-firstboot.sh install" "$UNIT"
check "once online, after Imager's own setup" grep -qx "After=network-online.target cloud-final.service" "$UNIT"
check "enables and starts it" [ "$(tr '\n' '|' < "$WORK/systemctl.calls")" = "daemon-reload|enable disney-parks-firstboot.service|start --no-block disney-parks-firstboot.service|" ]

echo "Installing:"
bash "$BOOT/disney-parks-firstboot.sh" install
check "clones the project into the user's home" [ -d "$APP/.git" ]
check "switches to the newest release, not unreleased work" [ "$(git -C "$APP" rev-parse HEAD)" = "$(git -C "$WORK/dev" rev-parse 'v1.0.0^{commit}')" ]
check "runs the installer from the project, for that user" grep -qx "installer ran for $USER in $APP with: " "$WORK/installer.calls"
check "removes the service" [ ! -e "$UNIT" ]
check "disables it" grep -qx "disable disney-parks-firstboot.service" "$WORK/systemctl.calls"
check "removes its files from the boot partition" [ -z "$(ls -A "$BOOT")" ]
check "restarts into the kiosk" [ -e "$WORK/rebooted" ]
check "logs it" logged "installing v1.0.0 for $USER"

echo "When the installer fails:"
make_boot "$WORK/github.git"
bash "$BOOT/disney-parks-firstboot.sh" enable
printf '#!/usr/bin/env bash\nexit 1\n' > "$WORK/dev/install.sh"
git -C "$WORK/dev" commit -qam "a failing installer"
git -C "$WORK/dev" tag v1.0.1
git -C "$WORK/dev" push -q origin main v1.0.1
bash "$BOOT/disney-parks-firstboot.sh" install
check "logs the failure" logged "FAILED: install.sh"
check "keeps the service, to try again at the next boot" [ -f "$UNIT" ]
check "keeps its files" [ -f "$BOOT/disney-parks-firstboot.sh" ]
check "doesn't restart" [ ! -e "$WORK/rebooted" ]

echo "When the repository can't be reached:"
make_boot "$WORK/nowhere.git"
bash "$BOOT/disney-parks-firstboot.sh" enable
bash "$BOOT/disney-parks-firstboot.sh" install
check "logs the failure" logged "FAILED: couldn't reach"
check "keeps the service, to try again at the next boot" [ -f "$UNIT" ]
check "doesn't restart" [ ! -e "$WORK/rebooted" ]

echo "With no releases yet:"
git init -q --bare -b main "$WORK/new.git"
git clone -q "$WORK/new.git" "$WORK/new" 2>/dev/null
printf '#!/usr/bin/env bash\necho "installer ran" >> "%s/installer.calls"\n' "$WORK" > "$WORK/new/install.sh"
chmod +x "$WORK/new/install.sh"
git -C "$WORK/new" add -A
git -C "$WORK/new" commit -qm "first"
git -C "$WORK/new" push -q origin main
make_boot "$WORK/new.git"
bash "$BOOT/disney-parks-firstboot.sh" install
check "installs main" logged "installing main (no releases yet)"
check "and restarts" [ -e "$WORK/rebooted" ]

echo
if [ "$failures" -eq 0 ]; then
  echo "All firstboot.sh tests passed."
else
  echo "$failures firstboot.sh test(s) failed."
  exit 1
fi
