#!/usr/bin/env bash
# Weekly self-update: switch to the newest release published on GitHub (the
# newest vX.Y.Z tag, never unreleased work on main), re-run the installer if
# that changed anything (so setup changes apply too, not just app files), then
# reboot. The reboot happens every week, updates or not, which also clears
# Chromium's memory build-up on a small Pi.
#
# Run as root by disney-parks-update.timer (installed by install.sh). To run it now:
#   sudo systemctl start disney-parks-update.service
# Log: /var/log/disney-parks-update.log
#
# For tests (tests/test_update.sh), DPWT_UPDATE_LOG changes the log file and
# DPWT_REBOOT_CMD replaces the reboot with another command.

set -uo pipefail

# The project folder: this script lives in its kiosk/ folder.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Owner of the project folder (GNU stat on the Pi; BSD stat elsewhere).
APP_USER="$(stat -c %U "$APP_DIR" 2>/dev/null || stat -f %Su "$APP_DIR")"
LOG_FILE="${DPWT_UPDATE_LOG:-/var/log/disney-parks-update.log}"

log() { echo "$(date '+%F %T') $*" >> "$LOG_FILE"; }
# git runs as the folder's owner: as root, it refuses a repo someone else owns.
as_owner() {
  if [ "$(id -u)" -eq 0 ] && [ "$APP_USER" != "root" ]; then
    runuser -u "$APP_USER" -- "$@"
  else
    "$@"
  fi
}

# The newest release: the highest vX.Y.Z tag. Pre-releases like v1.1.0-beta.1
# are left out, so they never reach kiosks.
latest_release() {
  as_owner git tag --list 'v*' --sort=-version:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 1p
}

# Everything runs inside main(), so bash has read this whole file before the
# checkout below can replace it.
main() {
  cd "$APP_DIR" || exit 1
  log "checking for updates"

  # Tags deleted on GitHub are dropped here too, so withdrawing a bad release
  # there sends kiosks back to the one before it.
  if ! as_owner git fetch --quiet --tags --prune --prune-tags --force origin >> "$LOG_FILE" 2>&1; then
    log "git fetch FAILED (see above); keeping the current version"
  elif ! release="$(latest_release)" || [ -z "$release" ]; then
    log "no releases published yet; keeping the current version"
  else
    before="$(as_owner git rev-parse HEAD)"
    target="$(as_owner git rev-parse "$release^{commit}")"
    if [ "$before" = "$target" ]; then
      log "already up to date ($release)"
    elif as_owner git -c advice.detachedHead=false checkout --quiet --detach "$release" >> "$LOG_FILE" 2>&1; then
      log "updated ${before:0:7} -> $release; re-running installer"
      # SUDO_USER tells the installer whose desktop and home folder to set up.
      if SUDO_USER="$APP_USER" ./install.sh >> "$LOG_FILE" 2>&1; then
        log "installer finished"
      else
        log "installer FAILED (see above); rebooting anyway"
      fi
    else
      log "switching to $release FAILED (see above); keeping the current version"
    fi
  fi

  log "rebooting"
  if [ -n "${DPWT_REBOOT_CMD:-}" ]; then
    "$DPWT_REBOOT_CMD"
  else
    systemctl reboot
  fi
}

main "$@"
exit
