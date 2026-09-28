#!/usr/bin/env bash
# First-boot installer. tools/prepare_sd.py copies this onto a freshly
# flashed SD card's boot partition (as disney-parks-firstboot.sh, next to
# disney-parks-firstboot.conf, which names the repository to install from).
# On the Pi's first boot it clones the project, switches to the newest
# release, runs install.sh, and reboots into the kiosk: no SSH needed.
#
#   disney-parks-firstboot.sh enable    sets up a one-time install service
#                                       (run by Raspberry Pi Imager's own
#                                       first-boot setup: cloud-init's
#                                       runcmd, or firstrun.sh)
#   disney-parks-firstboot.sh install   installs (run by that service, once
#                                       the Pi is online)
#
# If the install fails (e.g. no internet), the service stays in place and
# tries again at the next boot. When it succeeds, it removes the service and
# these files from the boot partition.
# Log: /var/log/disney-parks-firstboot.log
#
# For tests (tests/test_firstboot.sh): DPWT_FIRSTBOOT_LOG, DPWT_FIRSTBOOT_USER,
# DPWT_FIRSTBOOT_HOME, DPWT_NETWORK_TRIES, DPWT_SYSTEMCTL, DPWT_UNIT_DIR, and
# DPWT_REBOOT_CMD replace the log, the user, their home folder, how long to
# wait for the network, systemctl, the systemd unit folder, and the reboot.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"
CONF="$HERE/disney-parks-firstboot.conf"
SERVICE=disney-parks-firstboot
LOG_FILE="${DPWT_FIRSTBOOT_LOG:-/var/log/disney-parks-firstboot.log}"
SYSTEMCTL="${DPWT_SYSTEMCTL:-systemctl}"
UNIT_DIR="${DPWT_UNIT_DIR:-/etc/systemd/system}"

log() { echo "$(date '+%F %T') $*" >> "$LOG_FILE"; }

enable_service() {
  cat > "$UNIT_DIR/$SERVICE.service" <<EOF
[Unit]
Description=Disney Parks Wait Times: install on first boot
Wants=network-online.target
# After Raspberry Pi Imager's own first-boot setup (cloud-init), so the two
# never use apt at the same time.
After=network-online.target cloud-final.service

[Service]
Type=oneshot
ExecStart=/bin/bash $SELF install
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable "$SERVICE.service"
  # Starts once cloud-init finishes; from firstrun.sh, which reboots before
  # the network is up, it starts at the next boot instead.
  "$SYSTEMCTL" start --no-block "$SERVICE.service" || true
  log "install service set up"
}

install_kiosk() {
  local repo user home app release tries
  repo="$(sed -n 's/^repo=//p' "$CONF" 2>/dev/null)"
  # The account Raspberry Pi Imager created: the first regular user.
  user="${DPWT_FIRSTBOOT_USER:-$(getent passwd 1000 | cut -d: -f1)}"
  home="${DPWT_FIRSTBOOT_HOME:-$(getent passwd "$user" | cut -d: -f6)}"
  if [ -z "$repo" ] || [ -z "$user" ] || [ ! -d "$home" ]; then
    log "FAILED: missing repository ($CONF), user, or home folder"
    return 1
  fi
  app="$home/disney-parks-wait-times"
  # git runs as that user, so the project folder belongs to them.
  as_user() {
    if [ "$(id -u)" -eq 0 ] && [ "$user" != "root" ]; then runuser -u "$user" -- "$@"; else "$@"; fi
  }

  log "waiting to reach $repo"
  tries="${DPWT_NETWORK_TRIES:-90}" # 10 seconds apart: 15 minutes
  until as_user git ls-remote --quiet "$repo" HEAD > /dev/null 2>&1; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      log "FAILED: couldn't reach $repo; will try again at the next boot"
      return 1
    fi
    sleep 10
  done

  if [ ! -d "$app/.git" ]; then
    as_user git clone --quiet "$repo" "$app" >> "$LOG_FILE" 2>&1 \
      || { log "FAILED: couldn't clone $repo"; return 1; }
  fi
  # The newest release, as the weekly update would pick (kiosk/update.sh).
  release="$(as_user git -C "$app" tag --list 'v*' --sort=-version:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 1p)"
  if [ -n "$release" ]; then
    as_user git -C "$app" -c advice.detachedHead=false checkout --quiet --detach "$release" >> "$LOG_FILE" 2>&1 \
      || { log "FAILED: couldn't switch to $release"; return 1; }
  else
    release="main (no releases yet)"
  fi

  log "installing $release for $user in $app"
  # SUDO_USER tells the installer whose desktop and home folder to set up.
  if ! (cd "$app" && SUDO_USER="$user" ./install.sh) >> "$LOG_FILE" 2>&1; then
    log "FAILED: install.sh (see above); will try again at the next boot"
    return 1
  fi

  log "installed; removing the first-boot service and restarting into the kiosk"
  "$SYSTEMCTL" disable "$SERVICE.service" >> "$LOG_FILE" 2>&1
  rm -f "$UNIT_DIR/$SERVICE.service" "$CONF" "$SELF"
  if [ -n "${DPWT_REBOOT_CMD:-}" ]; then
    "$DPWT_REBOOT_CMD"
  else
    "$SYSTEMCTL" reboot
  fi
}

# Everything runs inside main(), so bash has read this whole file before the
# install removes it.
main() {
  case "${1:-}" in
    enable) enable_service ;;
    install) install_kiosk ;;
    *)
      echo "Usage: $0 enable|install" >&2
      return 1
      ;;
  esac
}

main "$@"
exit
