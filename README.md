# WDW Wait Times

A kiosk-style dashboard for Walt Disney World ride wait times, built for a small
HDMI touchscreen attached to a Raspberry Pi. Plain HTML/CSS/JS, no build step.
It fetches live data straight from public, CORS-enabled APIs (no API keys
needed); the only local backend is a tiny server (`server.py`) that saves your
favorite rides:

- [themeparks.wiki](https://api.themeparks.wiki) for ride wait times, park
  hours/schedule, and special-ticketed-event windows.
- [Open-Meteo](https://open-meteo.com) for current weather.

Covers Magic Kingdom, EPCOT, Hollywood Studios, and Animal Kingdom, plus an
**All Parks** tab. Ride data loads up front and auto-refreshes every 5
minutes; park hours/schedule refresh on the same cadence; weather refreshes
every 15 minutes.

Six tabs across the top — **All Parks**, **Favorites**, then the four
individual parks — scope both views:

- A **park tab** (MK/EP/HS/AK) restricts both views to just that park, rides
  sorted longest-wait-first.
- **All Parks** pools every open ride from all four parks. In grid view
  that's one combined list sorted by wait time (each card tagged with its
  park's icon); in carousel view the rides are shuffled into a random order
  each time you select the tab (or whenever data refreshes), so the loop
  jumps between parks instead of finishing one before starting the next.
- **Favorites** shows only the rides you've starred, from every park. Tap the
  ☆ in a grid card's corner, or the "☆ Favorite" button on a carousel slide,
  to add a ride; tap the filled ★ to remove it. Favorites are saved by
  `server.py` to `~/.local/share/wdw-wait-times/favorites.json`, outside the
  project folder, so they survive reboots (the kiosk's browser data doesn't)
  and copying a new version of the app over never overwrites them.

Two views, toggled with the button in the top-right corner:

- **Carousel** (default) — one ride at a time, big name and wait time, auto-
  advancing every ~4.5s. Tap the arrows to jump forward/back, or the circular
  button to pause/resume. Rides that are currently `DOWN` show up with a gray
  "Down" badge instead of a wait time. A closed park shows a
  "&lt;Park&gt; is closed. / Opening tomorrow at &lt;time&gt;" slide instead
  of ride data (in All Parks and Favorites, one per closed park, mixed in
  with the other slides). A park can be closed yet still have rides running,
  e.g. during a ticketed evening event; while any are operating, those rides
  show instead of the closed slide. A skyline of the four parks' landmarks
  runs along the bottom, with the current slide's park filled in.
- **Grid** — all rides in the current scope at once, sorted by wait time,
  including Down/Closed/Refurbishment rides (shown grayed out with their
  status instead of a number). Walk-throughs, transportation, and landmarks
  that never report a real wait time (Cinderella Castle, Main Street
  Vehicles, A Pirate's Adventure, etc.) are filtered out of both views
  entirely since they provide no useful information — see `hasWaitInfo()` in
  `app.js`.

Closed/Refurbishment rides are excluded from the carousel rather than shown
with a status: the API gives no "reopens on" date for a long-term
refurbishment, and a `CLOSED` ride's `operatingHours` (when present) is just
its own showtime schedule for today, not a reopening date — so there's
nothing informative to add to a carousel slide for it. They're still visible
in Grid view.

## Live data widgets (carousel view)

Two small info boxes float over the top corners of the carousel, both scoped
to whichever park the current slide belongs to:

- **Top-left — Park Weather.** Current temperature and conditions for the
  Walt Disney World area (the four parks are close enough together to share
  one reading), from Open-Meteo. Keeps showing the last known reading rather
  than blanking out on a transient fetch error.
- **Top-right — Today's Hours.** That park's opening/closing time for today.
  If the park has a same-day hard-ticket event after normal closing (e.g. a
  Halloween or Christmas party night), a second line reads "🎟️ Special Event
  &lt;time range&gt;" — the API never names the specific event, only that a
  `TICKETED_EVENT` window exists, so the label stays generic year-round
  rather than assuming a particular holiday.

## Trip countdown

The calendar button next to the view toggle (top-right) opens a fully
touch-driven date picker — no keyboard/text input anywhere, just tap month
arrows and tap a day. The button itself is a small custom calendar icon that
shows today's actual date, updated live rather than a static emoji.

Once a date is picked, the footer shows a live, second-by-second countdown:
"Next Magical Day in X Days, Y Hours, Z Minutes, A Seconds". If the picked
date is today, it instead reads "See ya real soon!"; once the date is in the
past, it's cleared automatically rather than lingering. The selected date is
saved in the browser's `localStorage`, so it's **per-device/per-browser** —
setting it on one machine (or one browser) doesn't carry over to another.
The same is true of the view (carousel/grid) and active park tab.

## Branding

Branding is done tastefully rather than with official Disney artwork: each
park gets an accent color and an emoji icon, ride names/wait numbers use a
playful display font (Baloo 2), and the carousel has a small cursive "Walt
Disney World" wordmark for flavor. Fonts load from Google Fonts, so the Pi
needs internet access for that too (it already needs it for the wait-time
API).

## Prototype on your Mac

```
cd wdw-wait-times
python3 server.py
```

Open http://localhost:8000 in a browser. Shrink the window to roughly 800x480
or 1024x600 to see how it'll look on a small touchscreen. Favorites you star
here are saved to `~/.local/share/wdw-wait-times/favorites.json` on the Mac
(set `WDW_DATA_DIR` to keep them somewhere else).

The server doesn't send cache-control headers for the app's files, so after editing
any file, a plain browser reload can still serve a stale cached copy — use a
**hard reload** (Cmd+Shift+R on Mac) to make sure you're seeing the latest
version.

To open it from another device on the same Wi-Fi/network (e.g. a phone),
find this Mac's LAN IP (`ipconfig getifaddr en0`) and browse to
`http://<that IP>:8000`. That only works on the same local network, and the
IP can change if your router reassigns it.

## Deploy to the Raspberry Pi

No build step, no dependencies to install — just get the files onto the Pi
and run the installer.

### Initial setup without a keyboard

Unlike a phone, Raspberry Pi OS doesn't pop up an on-screen keyboard when you
tap a text field — and you don't need one anyway, since everything up
through the reboot can be done from your Mac's terminal without ever
plugging anything into the Pi:

1. **Pre-configure in Raspberry Pi Imager.** When flashing the SD card, use
   the gear icon / "Edit Settings" screen to set the hostname, enable SSH,
   and set the Wi-Fi SSID/password and locale. The Pi then boots straight
   onto your network with SSH already on — no on-device input needed.
2. **Do everything else over SSH** from your Mac: `ssh pi@<hostname>`,
   then clone the project and run the installer (Wi-Fi is already set from
   step 1). All typed on your Mac's keyboard:
   ```
   git clone https://github.com/davelund750/wdw-wait-times.git ~/wdw-wait-times
   cd ~/wdw-wait-times && ./install.sh --skip-wifi
   ```
   Cloning (rather than copying the folder over) is what lets the Pi update
   itself — see [Updates](#updates).
3. **The touchscreen only comes into play at the very end**, once you
   reboot into the kiosk — the app has no text fields, so no keyboard is
   ever needed on the Pi itself, before or after setup.

If SSH ever isn't an option (e.g. troubleshooting a display or boot problem
you can't debug remotely), the fallback is a cheap USB keyboard/mouse
plugged in temporarily — every Pi has full-size USB ports for exactly that,
and you unplug them once it's working again.

### Steps

1. Copy this folder to the Pi (e.g. `/home/pi/wdw-wait-times`), via `scp`,
   `git clone`, or a USB drive.

2. From inside that folder on the Pi, run:
   ```
   ./install.sh
   ```
   This will, in order:
   - Optionally walk you through Wi-Fi setup (country code, SSID, password —
     typed at the prompt and handed straight to `raspi-config`, never written
     to a file). Pass `--skip-wifi` to skip this, e.g. if you're on Ethernet
     or already connected.
   - Install a color emoji font (`fonts-noto-color-emoji`). The park and
     weather icons are emoji, and Raspberry Pi OS doesn't ship an emoji font,
     so without it they show up as empty boxes.
   - Install a systemd service (`wdw-wait-times.service`) that runs
     `server.py`, serving this folder on `http://localhost:8000` (plus the
     favorites API) and restarting itself if it ever dies.
   - Install a kiosk autostart entry that runs `kiosk.sh`, using the XDG
     autostart convention so it works whether the desktop is the older
     X11/LXDE stack or the current default Wayland/labwc one. `kiosk.sh`
     auto-detects whether the browser is called `chromium-browser` or
     `chromium` on your OS version, then:
     - waits for the local server and internet access before launching;
     - starts Chromium from a freshly wiped profile every boot, because a
       reboot kills Chromium uncleanly and a profile left in that state can
       leave the page stuck blank on the next boot;
     - passes `--password-store=basic` so Chromium never touches the desktop
       keyring (otherwise it can trigger keyring password popups at boot);
     - watches the tab and, if the app hasn't loaded within a minute, reloads
       it in place via `kiosk_navigate.py` (the same as pressing Ctrl+R).

     It logs each boot to `~/.cache/wdw-kiosk.log`.
   - Tidy the desktop around the kiosk, as personal settings layered over the
     system defaults: a "Magic Loading…" wallpaper (`kiosk-wallpaper.png`)
     with no desktop icons, an auto-hiding taskbar with pop-up notifications
     turned off (they'd otherwise keep popping it back open), and an
     invisible mouse pointer (a transparent pointer theme built by
     `make_blank_cursor_theme.py`, since a page can't hide a pointer that
     never moves on a touchscreen).
   - Replace the "Welcome to the Raspberry Pi Desktop" boot screen with a
     "Magic Starting…" splash (a small Plymouth theme in `boot-splash/`,
     sized for the 800x480 touchscreen). Switching it rebuilds the initramfs,
     which takes about a minute, so re-runs skip it when nothing changed.
     To go back to the stock splash: `sudo plymouth-set-default-theme -R pix`.
   - Trim boot work the kiosk doesn't need: disable cloud-init (it only
     applies Raspberry Pi Imager's first-boot settings, which are permanent by
     then, and otherwise adds ~5s to every boot) and Bluetooth.
   - Disable screen blanking and turn on desktop auto-login via
     `raspi-config`, so the kiosk comes up hands-free after a reboot with
     nobody there to log in or nudge the mouse.

3. Reboot (`sudo reboot`). The Pi boots straight into the kiosk view.

Since the wait-time and font requests happen client-side in the browser, the
Pi just needs a normal internet connection. The systemd service hands the
static files to Chromium over `http://` (browsers block `fetch()` from
`file://` pages) and saves favorites; that's all the server-side logic there
is.

Re-running `./install.sh` later (e.g. after moving the folder, or to redo
Wi-Fi) is safe — every step it takes overwrites its own previous output
rather than duplicating it.

## Updates

The Pi updates itself from GitHub. Every Sunday at 4:00 AM (the Pi's local
time), `update.sh` pulls the latest version of this repository, re-runs
`./install.sh` if anything changed (so setup changes apply too, not just app
files), and reboots. It reboots every week even when there's nothing new,
which also clears Chromium's memory build-up on a small Pi.

- **Ship a change:** commit and push to `main`. The Pi picks it up on the next
  Sunday — so only push what you've tested on the Mac.
- **Update right now:** `sudo systemctl start wdw-update.service` on the Pi
  (it reboots when done).
- **See what happened:** `cat /var/log/wdw-update.log`.
- **Next scheduled run:** `systemctl list-timers wdw-update.timer`.

If a pull can't apply cleanly (e.g. someone edited files directly on the Pi),
the update is skipped and logged, the Pi keeps its current version, and it
still reboots. The weekly timer is only installed when the project folder is
a git clone.

## Notes / ideas for later

- Park IDs and accent colors are hardcoded in `app.js` (`PARKS` array);
  themeparks.wiki also covers the water parks (Typhoon Lagoon, Blizzard Beach)
  if you want to add them.
- Carousel slide duration is the `SLIDE_MS` constant near the top of `app.js`
  (currently 4.5s).
- Weather coordinates (`WEATHER_LAT`/`WEATHER_LON`) are one shared point for
  the whole Walt Disney World area; swap them if you want park-specific
  readings instead.
