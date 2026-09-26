#!/usr/bin/env bash
# Weekly self-update: pull the latest version from GitHub, re-run the installer
# if anything changed (so setup changes apply too, not just app files), then
# reboot. The reboot happens every week, updates or not, which also clears
# Chromium's memory build-up on a small Pi.
#
# Run as root by wdw-update.timer (installed by install.sh). To run it now:
#   sudo systemctl start wdw-update.service
# Log: /var/log/wdw-update.log

set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_USER="$(stat -c %U "$APP_DIR")"
LOG_FILE=/var/log/wdw-update.log

log() { echo "$(date '+%F %T') $*" >> "$LOG_FILE"; }
# git runs as the folder's owner; as root it refuses a repo someone else owns.
as_owner() { runuser -u "$APP_USER" -- "$@"; }

# Everything runs inside main(), so bash has read this whole file before the
# pull below can replace it.
main() {
  cd "$APP_DIR" || exit 1
  log "checking for updates"

  before="$(as_owner git rev-parse HEAD)"
  if as_owner git pull --ff-only --quiet >> "$LOG_FILE" 2>&1; then
    after="$(as_owner git rev-parse HEAD)"
    if [ "$before" = "$after" ]; then
      log "already up to date ($after)"
    else
      log "updated ${before:0:7} -> ${after:0:7}; re-running installer"
      # SUDO_USER tells the installer whose desktop and home folder to set up.
      if SUDO_USER="$APP_USER" ./install.sh --skip-wifi >> "$LOG_FILE" 2>&1; then
        log "installer finished"
      else
        log "installer FAILED (see above); rebooting anyway"
      fi
    fi
  else
    log "git pull FAILED (see above); keeping the current version"
  fi

  log "rebooting"
  systemctl reboot
}

main "$@"
exit
