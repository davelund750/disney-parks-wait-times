#!/usr/bin/env bash
# WDW Wait Times - Raspberry Pi kiosk installer.
#
# Run this ON THE PI, from inside the project folder:
#   ./install.sh            (prompts for Wi-Fi setup)
#   ./install.sh --skip-wifi (leaves networking alone, e.g. already on Ethernet)
#
# Sets up: (1) optionally, Wi-Fi via raspi-config, (2) a systemd service that
# serves this folder over http://localhost:8000, (3) a kiosk autostart entry
# that launches Chromium against it, (4) a tidy kiosk desktop (loading
# wallpaper, no icons, hidden taskbar, no notifications, invisible pointer),
# (5) a "Magic Starting..." boot splash, (6) a weekly self-update from GitHub
# (Sundays 4 AM, then a reboot), (7) screen blanking disabled and desktop
# autologin enabled so it comes up hands-free after a reboot.
#
# Nothing here stores your Wi-Fi password on disk — it's typed at the prompt
# and passed straight to raspi-config.

set -euo pipefail

SKIP_WIFI=false
for arg in "$@"; do
  case "$arg" in
    --skip-wifi) SKIP_WIFI=true ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--skip-wifi]" >&2
      exit 1
      ;;
  esac
done

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_USER="${SUDO_USER:-$USER}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"

if [ -z "$APP_HOME" ]; then
  echo "Couldn't resolve a home directory for user $APP_USER." >&2
  exit 1
fi

echo "==> Installing WDW Wait Times kiosk"
echo "    App folder : $APP_DIR"
echo "    Running as : $APP_USER ($APP_HOME)"
echo

# ---- Wi-Fi ----
if [ "$SKIP_WIFI" = false ]; then
  read -rp "Configure Wi-Fi now? [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    read -rp "Wi-Fi country code, 2 letters e.g. US (leave blank to skip): " WIFI_COUNTRY
    if [ -n "$WIFI_COUNTRY" ]; then
      sudo raspi-config nonint do_wifi_country "$WIFI_COUNTRY"
    fi

    read -rp "Wi-Fi SSID: " WIFI_SSID
    read -rsp "Wi-Fi password: " WIFI_PASSWORD
    echo

    if [ -z "$WIFI_SSID" ]; then
      echo "No SSID entered, skipping Wi-Fi setup."
    else
      sudo raspi-config nonint do_wifi_ssid_passphrase "$WIFI_SSID" "$WIFI_PASSWORD"
      echo "==> Wi-Fi configured for \"$WIFI_SSID\""
    fi
  else
    echo "==> Skipping Wi-Fi setup"
  fi
else
  echo "==> Skipping Wi-Fi setup (--skip-wifi)"
fi
echo

# ---- emoji font ----
# The app's park and weather icons are emoji, and Raspberry Pi OS ships
# without a color emoji font, so Chromium would draw them as empty boxes.
echo "==> Installing emoji font (fonts-noto-color-emoji)"
sudo apt-get install -y fonts-noto-color-emoji
echo

# ---- static file server (systemd) ----
echo "==> Installing systemd service (wdw-wait-times.service)"
sudo tee /etc/systemd/system/wdw-wait-times.service >/dev/null <<EOF
[Unit]
Description=WDW Wait Times server
After=network-online.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/python3 $APP_DIR/server.py
Restart=on-failure
User=$APP_USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable wdw-wait-times
# restart (not just start) so a re-run picks up a changed server or unit file
sudo systemctl restart wdw-wait-times
echo

# ---- chromium kiosk autostart ----
echo "==> Installing kiosk autostart entry"
CHROMIUM_BIN="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$CHROMIUM_BIN" ]; then
  echo "Couldn't find chromium-browser or chromium on PATH." >&2
  echo "Install it first, e.g.: sudo apt install -y chromium-browser" >&2
  echo "...then re-run this script." >&2
  exit 1
fi

mkdir -p "$APP_HOME/.config/autostart"
cat > "$APP_HOME/.config/autostart/wdw-wait-times.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=WDW Wait Times
Exec=$APP_DIR/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF
sudo chown "$APP_USER":"$APP_USER" "$APP_HOME/.config/autostart/wdw-wait-times.desktop"
chmod +x "$APP_DIR/kiosk.sh"
echo "    Using $CHROMIUM_BIN"
echo

# ---- kiosk desktop ----
# Tidies what shows around the kiosk, mostly while the Pi boots: a "Magic
# Loading..." wallpaper with no desktop icons, an auto-hiding taskbar with its
# pop-up notifications off, and an invisible mouse pointer. Each is a personal
# setting layered over the system defaults, which are left untouched.
echo "==> Setting up the kiosk desktop (wallpaper, taskbar, notifications, pointer)"

# Wallpaper and desktop icons: the desktop keeps one settings file per screen.
PCMANFM_DIR="$APP_HOME/.config/pcmanfm/default"
mkdir -p "$PCMANFM_DIR"
for src in /etc/xdg/pcmanfm/default/desktop-items-*.conf; do
  [ -e "$src" ] || continue
  sed -e "s|^wallpaper=.*|wallpaper=$APP_DIR/kiosk-wallpaper.png|" \
      -e 's|^desktop_bg=.*|desktop_bg=#0d0d11111717|' \
      -e 's|^show_trash=.*|show_trash=0|' \
      -e 's|^show_mounts=.*|show_mounts=0|' \
      "$src" > "$PCMANFM_DIR/$(basename "$src")"
done

# Taskbar: auto-hide it and turn off both kinds of pop-up notification (the
# taskbar's own, e.g. Wi-Fi connected, and other programs', e.g. the desktop's
# memory warning). Notifications would otherwise keep popping the taskbar
# back open.
PANEL_INI="$APP_HOME/.config/wf-panel-pi/wf-panel-pi.ini"
mkdir -p "$(dirname "$PANEL_INI")"
[ -s "$PANEL_INI" ] || printf '[panel]\n' > "$PANEL_INI"
# Sets key=value, assuming [panel] is the file's only section.
set_panel_key() {
  if grep -q "^$1=" "$PANEL_INI"; then
    sed -i "s|^$1=.*|$1=$2|" "$PANEL_INI"
  else
    echo "$1=$2" >> "$PANEL_INI"
  fi
}
set_panel_key autohide true
set_panel_key notify_enable false
set_panel_key notify_libnotify false

# Pointer: an invisible pointer theme, since hiding it in the page only works
# once the pointer moves, and on a touchscreen it never does.
HOME="$APP_HOME" python3 "$APP_DIR/make_blank_cursor_theme.py"
LABWC_ENV="$APP_HOME/.config/labwc/environment"
mkdir -p "$(dirname "$LABWC_ENV")"
touch "$LABWC_ENV"
sed -i '/^XCURSOR_THEME=/d' "$LABWC_ENV"
echo "XCURSOR_THEME=wdw-blank" >> "$LABWC_ENV"

sudo chown -R "$APP_USER":"$APP_USER" \
  "$APP_HOME/.config/pcmanfm" "$APP_HOME/.config/wf-panel-pi" \
  "$APP_HOME/.config/labwc" "$APP_HOME/.local/share/icons/wdw-blank"
echo

# ---- boot splash ----
# Replaces the "Welcome to the Raspberry Pi Desktop" boot screen with a
# custom splash theme (boot-splash/). Switching themes rebuilds the initramfs,
# which takes a minute, so skip it when the theme is already installed and
# unchanged. Undo with: sudo plymouth-set-default-theme -R pix
echo "==> Installing boot splash"
SPLASH_DIR=/usr/share/plymouth/themes/wdw
if [ "$(plymouth-set-default-theme 2>/dev/null)" = "wdw" ] \
  && diff -rq "$APP_DIR/boot-splash" "$SPLASH_DIR" >/dev/null 2>&1; then
  echo "    Already installed"
else
  sudo mkdir -p "$SPLASH_DIR"
  sudo cp "$APP_DIR"/boot-splash/* "$SPLASH_DIR/"
  sudo plymouth-set-default-theme -R wdw
fi
echo

# ---- boot trims ----
# The Pi only runs the kiosk, so skip boot work it doesn't need. cloud-init
# applies Raspberry Pi Imager's settings (Wi-Fi, user, hostname) on first
# boot; those are permanent by the time this runs, and it otherwise costs ~5s
# every boot. Bluetooth isn't used.
# Undo: sudo rm /etc/cloud/cloud-init.disabled; sudo systemctl enable bluetooth
echo "==> Trimming boot (cloud-init, Bluetooth)"
if [ -d /etc/cloud ]; then
  sudo touch /etc/cloud/cloud-init.disabled
fi
sudo systemctl disable bluetooth.service 2>/dev/null || true
echo

# ---- weekly self-update ----
# Every Sunday at 4 AM (the Pi's local time), update.sh pulls the latest
# version from GitHub, re-runs this installer if anything changed, and
# reboots. Only possible when this folder is a git checkout.
echo "==> Installing weekly update timer (Sundays 4:00 AM)"
if [ -d "$APP_DIR/.git" ]; then
  chmod +x "$APP_DIR/update.sh"
  sudo tee /etc/systemd/system/wdw-update.service >/dev/null <<EOF
[Unit]
Description=WDW Wait Times weekly update and reboot
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$APP_DIR/update.sh
EOF
  sudo tee /etc/systemd/system/wdw-update.timer >/dev/null <<EOF
[Unit]
Description=Run the WDW Wait Times weekly update

[Timer]
OnCalendar=Sun *-*-* 04:00:00
# If the Pi was off at 4 AM, don't catch up at power-on (it would reboot
# right after starting).
Persistent=false

[Install]
WantedBy=timers.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now wdw-update.timer
  echo "    Next run: $(systemctl show wdw-update.timer -p NextElapseUSecRealtime --value)"
else
  echo "    Skipped: $APP_DIR isn't a git checkout, so there's nothing to pull."
  echo "    Clone the project from GitHub instead of copying it to enable updates."
fi
echo

# ---- screen blanking + autologin ----
echo "==> Disabling screen blanking and enabling desktop autologin"
sudo raspi-config nonint do_blanking 1 \
  || echo "    Couldn't set automatically — set manually via: sudo raspi-config > Display Options > Screen Blanking"
sudo raspi-config nonint do_boot_behaviour B4 \
  || echo "    Couldn't set automatically — set manually via: sudo raspi-config > System Options > Boot / Auto Login > Desktop Autologin"
echo

echo "==> Done. Reboot to launch the kiosk:"
echo "    sudo reboot"
