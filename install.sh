#!/usr/bin/env bash
# Disney Parks Wait Times - Raspberry Pi kiosk installer.
#
# Run this ON THE PI, from inside the project folder:
#   ./install.sh
#
# Sets up: (1) a systemd service that serves the app over
# http://localhost:8000, (2) a kiosk autostart entry that launches Chromium
# against it, (3) a tidy kiosk desktop (loading wallpaper, no icons, hidden
# taskbar, no notifications, invisible pointer), (4) a "Magic Starting..."
# boot splash, (5) permissions for the on-screen setup wizard (Wi-Fi,
# country, time zone), (6) a weekly self-update from GitHub (Sundays 4 AM,
# then a reboot), (7) screen blanking disabled and desktop autologin enabled
# so it comes up hands-free after a reboot.
#
# It leaves Wi-Fi alone: Raspberry Pi Imager sets it up, and after that the
# kiosk's setup wizard does, on the touchscreen.

set -euo pipefail

if [ "$#" -gt 0 ]; then
  echo "Unknown option: $1" >&2
  echo "Usage: $0   (no options)" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_USER="${SUDO_USER:-$USER}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"

if [ -z "$APP_HOME" ]; then
  echo "Couldn't resolve a home directory for user $APP_USER." >&2
  exit 1
fi

echo "==> Installing Disney Parks Wait Times kiosk"
echo "    App folder : $APP_DIR"
echo "    Running as : $APP_USER ($APP_HOME)"
echo

# ---- emoji font ----
# The app's park and weather icons are emoji, and Raspberry Pi OS ships
# without a color emoji font, so Chromium would draw them as empty boxes.
echo "==> Installing emoji font (fonts-noto-color-emoji)"
sudo apt-get install -y fonts-noto-color-emoji
echo

# ---- static file server (systemd) ----
echo "==> Installing systemd service (disney-parks-wait-times.service)"
sudo tee /etc/systemd/system/disney-parks-wait-times.service >/dev/null <<EOF
[Unit]
Description=Disney Parks Wait Times server
After=network-online.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/python3 $APP_DIR/server/server.py
Restart=on-failure
User=$APP_USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable disney-parks-wait-times
# restart (not just start) so a re-run picks up a changed server or unit file
sudo systemctl restart disney-parks-wait-times
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
cat > "$APP_HOME/.config/autostart/disney-parks-wait-times.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Disney Parks Wait Times
Exec=$APP_DIR/kiosk/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF
sudo chown "$APP_USER":"$APP_USER" "$APP_HOME/.config/autostart/disney-parks-wait-times.desktop"
chmod +x "$APP_DIR/kiosk/kiosk.sh"
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
  sed -e "s|^wallpaper=.*|wallpaper=$APP_DIR/kiosk/wallpaper.jpg|" \
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
HOME="$APP_HOME" python3 "$APP_DIR/kiosk/make_blank_cursor_theme.py"
LABWC_ENV="$APP_HOME/.config/labwc/environment"
mkdir -p "$(dirname "$LABWC_ENV")"
touch "$LABWC_ENV"
sed -i '/^XCURSOR_THEME=/d' "$LABWC_ENV"
echo "XCURSOR_THEME=disney-parks-blank" >> "$LABWC_ENV"

sudo chown -R "$APP_USER":"$APP_USER" \
  "$APP_HOME/.config/pcmanfm" "$APP_HOME/.config/wf-panel-pi" \
  "$APP_HOME/.config/labwc" "$APP_HOME/.local/share/icons/disney-parks-blank"
echo

# ---- boot splash ----
# Replaces the "Welcome to the Raspberry Pi Desktop" boot screen with a
# custom splash theme (kiosk/boot-splash/). Switching themes rebuilds the initramfs,
# which takes a minute, so skip it when the theme is already installed and
# unchanged. Undo with: sudo plymouth-set-default-theme -R pix
echo "==> Installing boot splash"
SPLASH_DIR=/usr/share/plymouth/themes/disney-parks
if [ "$(plymouth-set-default-theme 2>/dev/null)" = "disney-parks" ] \
  && diff -rq "$APP_DIR/kiosk/boot-splash" "$SPLASH_DIR" >/dev/null 2>&1; then
  echo "    Already installed"
else
  sudo mkdir -p "$SPLASH_DIR"
  sudo cp "$APP_DIR"/kiosk/boot-splash/* "$SPLASH_DIR/"
  sudo plymouth-set-default-theme -R disney-parks
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

# ---- setup wizard permissions ----
# The on-screen setup wizard (setup.html) is served by server.py, running as
# $APP_USER without anyone logged in, so by default every change it asks for
# needs a password. Grant exactly what it uses, nothing more:
#  - a polkit rule: scan for and join Wi-Fi networks, set the time zone;
#  - a polkit rule: start the update service (disney-parks-update.service, below), so
#    setup can offer to check for updates right away;
#  - a sudo rule: read and set the Wi-Fi country with raspi-config, and only
#    with a two-letter code (the server checks that too).
echo "==> Allowing the setup wizard to change Wi-Fi, country, and time zone"
sudo tee /etc/polkit-1/rules.d/50-disney-parks-wait-times.rules >/dev/null <<EOF
// Installed by disney-parks-wait-times/install.sh: lets the kiosk's setup wizard
// (server.py, running as $APP_USER) manage Wi-Fi, set the time zone, and
// start the update service, without a password.
polkit.addRule(function (action, subject) {
  var allowed = [
    "org.freedesktop.NetworkManager.wifi.scan",
    "org.freedesktop.NetworkManager.network-control",
    "org.freedesktop.NetworkManager.enable-disable-wifi",
    "org.freedesktop.NetworkManager.settings.modify.system",
    "org.freedesktop.timedate1.set-timezone"
  ];
  if (subject.user === "$APP_USER" && allowed.indexOf(action.id) >= 0) {
    return polkit.Result.YES;
  }
  // Starting the update service, and only that service.
  if (subject.user === "$APP_USER" && action.id === "org.freedesktop.systemd1.manage-units" &&
      action.lookup("unit") === "disney-parks-update.service" && action.lookup("verb") === "start") {
    return polkit.Result.YES;
  }
});
EOF
SUDOERS_TMP="$(mktemp)"
cat > "$SUDOERS_TMP" <<EOF
# Installed by disney-parks-wait-times/install.sh: lets the kiosk's setup wizard read
# and set the Wi-Fi country (two capital letters only, e.g. JP).
$APP_USER ALL=(root) NOPASSWD: /usr/bin/raspi-config nonint get_wifi_country, /usr/bin/raspi-config nonint do_wifi_country [A-Z][A-Z]
EOF
# Only install it if sudo accepts it; a broken sudoers file can lock out sudo.
if sudo visudo -cf "$SUDOERS_TMP" >/dev/null; then
  sudo install -m 0440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/disney-parks-wait-times
else
  echo "    Couldn't install the sudo rule; the wizard won't be able to set the country." >&2
fi
rm -f "$SUDOERS_TMP"
echo

# ---- weekly self-update ----
# Every Sunday at 4 AM (the Pi's local time), update.sh switches to the
# newest release on GitHub, re-runs this installer if anything changed, and
# reboots. Only possible when this folder is a git checkout.
echo "==> Installing weekly update timer (Sundays 4:00 AM)"
if [ -d "$APP_DIR/.git" ]; then
  chmod +x "$APP_DIR/kiosk/update.sh"
  sudo tee /etc/systemd/system/disney-parks-update.service >/dev/null <<EOF
[Unit]
Description=Disney Parks Wait Times weekly update and reboot
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$APP_DIR/kiosk/update.sh
EOF
  sudo tee /etc/systemd/system/disney-parks-update.timer >/dev/null <<EOF
[Unit]
Description=Run the Disney Parks Wait Times weekly update

[Timer]
OnCalendar=Sun *-*-* 04:00:00
# If the Pi was off at 4 AM, don't catch up at power-on (it would reboot
# right after starting).
Persistent=false

[Install]
WantedBy=timers.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now disney-parks-update.timer
  echo "    Next run: $(systemctl show disney-parks-update.timer -p NextElapseUSecRealtime --value)"
else
  echo "    Skipped: $APP_DIR isn't a git checkout, so it can't fetch releases."
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
