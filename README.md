# WDW Wait Times

A kiosk-style dashboard for Walt Disney World ride wait times, built to run
full-screen on a Raspberry Pi with a small touchscreen. It's plain
HTML/CSS/JS with no build step. Live data comes straight from public APIs (no
API keys needed); the only local backend is a tiny Python server
(`server.py`) that serves the page and saves favorite rides.

It covers Magic Kingdom, EPCOT, Hollywood Studios, and Animal Kingdom. Ride
wait times and park hours refresh every 5 minutes; weather every 15.

> This is an unofficial fan project. It isn't affiliated with, endorsed by, or
> sponsored by Disney. Park and attraction names are used only to identify the
> data shown.

## Features

### Choosing what to show

- **All Parks** (top-left tab) pools every open ride from all four parks.
- **Favorites** (next to it) shows only the rides you've starred.
- **A skyline of park landmarks** runs along the bottom: Cinderella Castle,
  Spaceship Earth, the Tower of Terror, and the Tree of Life. Tap one to show
  just that park; tap it again to go back to All Parks. The selected park's
  landmark is filled in. On All Parks and Favorites, the carousel fills in the
  landmark of the park the current ride belongs to.

On startup, the app opens on Favorites if any rides are starred, otherwise on
All Parks.

### Two views

Toggle between them with the button in the top-right corner.

- **Carousel** (default): one ride at a time, with a big name and wait time,
  auto-advancing every ~4.5 seconds. Tap the arrows to move forward or back,
  or the round button to pause. On All Parks, rides are shuffled so the loop
  jumps between parks instead of finishing one park before starting the next.
- **Grid**: everything in the current selection at once, rides, shows, and
  exhibits alike. On All Parks and Favorites, each card is tagged with its
  park (e.g. "MK").

Each item shows one of:

- **its wait time**, in minutes;
- **Operating**: running, with no wait posted. This covers theater shows such as
  The Hall of Presidents, rides between wait-time updates, and exhibits and
  walk-throughs, which never have a wait;
- **Down**: temporarily not running;
- **Opens *time***: opening later today, such as a show that starts after the
  park opens;
- **Closed**: not open today (or under refurbishment).

The grid lists everything, in that order. The carousel shows items with a
wait time, down rides, items opening later today ("Opens at 11:45 AM"), and
"Operating" items that have a standby line (rides and shows). Exhibits and
walk-throughs, which never have a line, stay in the grid so they don't crowd
the rotation, unless you star one, which adds it to the Favorites carousel.
The data has no "show" or "walk-through" type, so whether an item has a
standby line is how the app tells them apart.

### Closed parks

When a park is closed, the carousel shows a "*Park* is closed. Opening
tomorrow at *time*" slide instead of its rides (on All Parks and Favorites,
one per closed park, mixed in with the other slides). A park can be closed to
regular guests while rides keep running for a separately ticketed evening
event, such as a Halloween party; while any of its rides are operating, those
rides show instead of the closed slide.

### Favorites

Tap the ☆ in a grid card's corner, or the "☆ Favorite" button on a carousel
slide, to add a ride; tap the filled ★ to remove it. Favorites are saved on
the device running `server.py`, in
`~/.local/share/wdw-wait-times/favorites.json` (set `WDW_DATA_DIR` to change
the folder). Keeping them outside the project folder means they survive
reboots and updates.

### Weather, park hours, and trip countdown

- **Park Weather** (carousel, top-left): current temperature and conditions
  for the Walt Disney World area. The four parks are close enough together to
  share one reading.
- **Today's Hours** (carousel, top-right): the current park's hours for today.
  If there's a separately ticketed event that evening (such as a holiday
  party), a second line shows "🎟️ Special Event" with its time range. The
  data source flags these events but doesn't name them, so the label stays
  generic.
- **Trip countdown**: the calendar button in the top-right corner opens a
  touch-friendly date picker (no keyboard needed). Once you pick a date, the
  bottom bar counts down to it live: "Next Magical Day in X Days, Y Hours, Z
  Minutes, A Seconds", then "See ya real soon!" on the day itself. The date
  is saved in the browser, so it's per device, and it clears itself once it
  has passed.

All times are shown in park time (US Eastern), in 12-hour format.

## Requirements

- **Any modern browser** to try it on a computer, plus Python 3 to run the
  local server.
- **For the kiosk:** a Raspberry Pi running **Raspberry Pi OS with desktop**
  (the current Wayland/labwc desktop), connected to the internet. It was
  developed on a **Raspberry Pi 3 Model B+** with the official 800x480
  touchscreen. On a Pi 3, expect about a minute and a half from power-on to
  the app appearing; a **Raspberry Pi 4 (2 GB or more)** or **Pi 5** should
  start considerably faster and is recommended. Any small screen works, touch or not,
  though the boot splash image is sized for 800x480.

## Try it on your computer

```
git clone https://github.com/davelund750/wdw-wait-times.git
cd wdw-wait-times
python3 server.py
```

Then open http://localhost:8000 in a browser. To see roughly how it will look
on a small touchscreen, shrink the window to about 800x480 or 1024x600.

The server doesn't send cache-control headers for the app's files, so after
editing a file, a normal reload can show a stale copy. Use a **hard reload**
(Ctrl+Shift+R, or Cmd+Shift+R on macOS) instead.

To open it from another device on the same network (a phone, say), browse to
`http://<your computer's local IP address>:8000`.

## Install on a Raspberry Pi

No build step and no dependencies to install by hand: clone the project and
run the installer.

### Set up without a keyboard

Raspberry Pi OS has no on-screen keyboard, but none is needed. Everything up
to the final reboot can be done from another computer:

1. **Pre-configure the SD card in Raspberry Pi Imager.** In its settings
   screen, set the hostname, username and password, Wi-Fi network, and
   locale, and enable SSH. The Pi then boots straight onto your network with
   SSH turned on.
2. **Connect over SSH** from another computer (`ssh <user>@<hostname>`), then
   clone the project and run the installer. Wi-Fi is already set up from step
   1, so skip that part of the installer:
   ```
   git clone https://github.com/davelund750/wdw-wait-times.git ~/wdw-wait-times
   cd ~/wdw-wait-times && ./install.sh --skip-wifi
   ```
   Clone it (rather than copying the files over) so the Pi can
   [update itself](#updates). If you've forked the project, clone your fork:
   the Pi updates from wherever it was cloned from.
3. **Reboot** with `sudo reboot`. The Pi starts straight into the kiosk. The
   app has no text fields, so the touchscreen is all you need from here on.

If SSH isn't an option (for example, when troubleshooting a display or boot
problem), plug in a USB keyboard and mouse temporarily.

### What the installer does

Run `./install.sh` from inside the project folder, without `--skip-wifi` if
you want it to set up Wi-Fi. In order, it:

- **Optionally sets up Wi-Fi** (country code, network name, password). The
  password is typed at the prompt and passed straight to `raspi-config`; it's
  never written to a file.
- **Installs a color emoji font** (`fonts-noto-color-emoji`). The weather
  icons, the tab icons, and the special-event ticket are emoji; Raspberry Pi
  OS doesn't include an emoji font, so without it they show up as empty
  boxes.
- **Installs the local server** as a systemd service (`wdw-wait-times`),
  serving the app on `http://localhost:8000` and restarting it if it ever
  stops. Browsers block the app's data requests from a page opened as a
  plain file, which is why a server is needed at all.
- **Starts the kiosk at login** via `kiosk.sh`, which:
  - waits for the local server and the internet before launching Chromium;
  - starts Chromium from a fresh profile on every boot, because a reboot
    shuts Chromium down uncleanly and a profile left in that state can leave
    the page stuck blank on the next start;
  - skips Chromium features a kiosk doesn't need (first-run setup, update
    checks, sync, translation) to speed up startup, and keeps it away from
    the desktop keyring, which would otherwise trigger password pop-ups;
  - reloads the page if it hasn't loaded within a minute of Chromium
    starting, via `kiosk_navigate.py`;
  - logs each boot to `~/.cache/wdw-kiosk.log`.
- **Tidies the desktop around the kiosk**, as personal settings layered over
  the system defaults: a "Magic Loading…" wallpaper (`kiosk-wallpaper.png`)
  with no desktop icons, an auto-hiding taskbar with pop-up notifications
  turned off (they'd otherwise keep popping it back into view), and an
  invisible mouse pointer. The pointer uses a transparent pointer theme built
  by `make_blank_cursor_theme.py`, since on a touchscreen the pointer never
  moves and the page alone can't hide it.
- **Replaces the boot screen** with a "Magic Starting…" splash (a small
  Plymouth theme in `boot-splash/`). Switching it takes about a minute, so
  re-runs skip it when nothing has changed. To restore the stock splash:
  `sudo plymouth-set-default-theme -R pix`.
- **Trims boot work the kiosk doesn't need**: disables cloud-init (which only
  applies Raspberry Pi Imager's first-boot settings, and otherwise adds a few
  seconds to every boot) and Bluetooth.
- **Installs the weekly update timer** (see [Updates](#updates)), if the
  project folder is a git clone.
- **Turns off screen blanking and turns on desktop auto-login**, so the kiosk
  comes up hands-free after a reboot.

Running `./install.sh` again later is safe: every step overwrites its own
earlier output rather than adding to it.

## Updates

A Pi installed from a git clone keeps itself up to date. Every Sunday at 4:00
AM (the Pi's local time), `update.sh` pulls the latest version from the
repository it was cloned from, re-runs `./install.sh` if anything changed (so
setup changes apply too, not just the app itself), and reboots. It reboots
every week even when there's nothing new, which also clears Chromium's memory
build-up on a small Pi.

- **Publish a change:** push it to `main`. Every installed Pi picks it up the
  following Sunday, so only push changes you've tested.
- **Update now:** `sudo systemctl start wdw-update.service` (the Pi reboots
  when done).
- **See what changed:** [CHANGELOG.md](CHANGELOG.md) lists notable changes
  by date.
- **See what happened on a Pi:** `cat /var/log/wdw-update.log`
- **See when it runs next:** `systemctl list-timers wdw-update.timer`

If an update can't be applied cleanly (for example, because files were edited
directly on the Pi), it's skipped and logged, the Pi keeps its current
version, and it still reboots.

## Tests

The tests cover the app's decision logic (which slides and rides to show,
closed parks, favorites, time formatting), the favorites server, and the
weekly update script. They need only Node.js and Python 3, with nothing to
install:

```
node --test tests/logic.test.js
python3 -m unittest discover -s tests
bash tests/test_update.sh
```

GitHub runs them automatically on every push, along with a
[ShellCheck](https://www.shellcheck.net) lint of the shell scripts. Since
installed kiosks update themselves from `main` every week, check that the
tests pass before letting a change sit there.

The page's own code is split in two: `logic.js` holds the parts that can be
tested without a browser (it never touches the page or the network), and
`app.js` wires them up to the page.

## Customizing

- **Parks:** park IDs are listed in the `PARKS` array at the top of
  `logic.js`.
  themeparks.wiki also covers the water parks (Typhoon Lagoon, Blizzard
  Beach) if you want to add them.
- **Carousel speed:** the `SLIDE_MS` constant near the top of `app.js`
  (default 4.5 seconds).
- **Weather location:** `WEATHER_LAT` and `WEATHER_LON` in `app.js`, one
  shared point for the whole resort area.

## Data sources and credits

- Ride wait times, park hours, and event windows:
  [themeparks.wiki](https://themeparks.wiki), a free community-run API.
- Weather: [Open-Meteo](https://open-meteo.com). Its free API is for
  non-commercial use.
- Fonts: [Baloo 2](https://fonts.google.com/specimen/Baloo+2) and
  [Grand Hotel](https://fonts.google.com/specimen/Grand+Hotel) from Google
  Fonts, loaded at runtime (the kiosk needs internet access for these too).

Park branding is kept to original artwork: each park is represented by a
simple line drawing of its landmark (`landmarks/`), paired with the playful
Baloo 2 display font and a small cursive "Walt Disney World" wordmark.

## License

The code is released under the [MIT License](LICENSE). That covers this
project's own code and artwork only; the data sources, fonts, and any Disney
names and trademarks remain subject to their owners' terms.
