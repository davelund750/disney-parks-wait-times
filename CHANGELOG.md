# Changelog

Notable changes to this project, newest first. Installed kiosks install the
newest release in their weekly Sunday update (see
[Updates](README.md#updates)). "Unreleased" lists changes on `main` that
aren't in a release yet, so no kiosk has them.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org). The
dated sections before 1.0.0 were beta testing, with no version numbers:
kiosks installed whatever was on `main` each week.

## Unreleased

### Fixed
- In grid view on All Parks or Favorites, a random park's landmark lit up
  after the page loaded (and at each data refresh). The hidden carousel's
  redraw was highlighting its current ride's park; now only the carousel,
  when it's showing, highlights a ride's park.

## 2.1.0 - 2026-09-28

### Added
- Set up a kiosk straight from the SD card, with no SSH: flash it with
  Raspberry Pi Imager as usual, run `make sd` (or `python
  tools/prepare_sd.py`, on Windows too) with the card still in your
  computer, and put it in the Pi. On first boot it installs the newest
  release by itself and restarts into the kiosk; if it can't (no internet),
  it tries again at the next power-on.

### Changed
- The "Updated" time and the calendar icon's day now use the resort's time
  zone, like the clock, so they match when a resort is followed from
  another time zone.
- README: Tokyo Disney Resort has wait times only (the data source has no
  show or greeting times, or hours for individual attractions, for Tokyo).
- The tests on GitHub use the current versions of its checkout and Node.js
  actions (the previous ones ran on a retired Node.js version).

### Fixed
- In the carousel, a ride name long enough to wrap onto two lines pushed
  the card up over the resort's name on an 800x480 screen. The big wait
  number now shrinks a little when needed so everything fits.

## 2.0.0 - 2026-09-27

**Needs a fresh install:** a kiosk on 1.2.0 or earlier can't update to this
version. Re-flash its SD card and install it again (see
[Install on a Raspberry Pi](README.md#install-on-a-raspberry-pi)).

### Added
- Tests that the kiosk's files agree with each other: the page titles and
  the kiosk's watchdog, the update service and the permission to start it,
  the boot splash theme, the hidden-pointer theme, the files the installer
  uses, and that the installer takes no options. Also tests for the
  hidden-pointer helper and for which resort setup offers first.

### Changed
- The rest of the rename to Disney Parks Wait Times, on the Pi itself: the
  install folder (`~/disney-parks-wait-times`), the services
  (`disney-parks-wait-times`, `disney-parks-update`), the saved-data folder
  (`~/.local/share/disney-parks-wait-times`), the update log
  (`/var/log/disney-parks-update.log`), the boot splash theme, and the
  settings for trying it on a computer (now `DPWT_...` instead of
  `WDW_...`, e.g. `DPWT_FAKE_OFFLINE=1`).

### Removed
- The installer's Wi-Fi prompt and its `--skip-wifi` option: Raspberry Pi
  Imager sets up Wi-Fi before installing, and the kiosk's setup wizard
  handles it after. The installer now takes no options.
- Support for moving kiosks over from older versions (the old GitHub
  address, file layout, and update method), now that none are left.

## 1.2.0 - 2026-09-27

### Changed
- Renamed from WDW Wait Times to Disney Parks Wait Times, now that it
  covers every Disney resort: on the dashboard, setup and Settings screens,
  the installer, and GitHub, where the project is now
  `davelund750/disney-parks-wait-times`. Installed kiosks switch to the new
  address on their next update; their folder, saved settings, and favorites
  stay where they are.

## 1.1.0 - 2026-09-27

### Added
- Tap a card in the grid to see it full size, like a carousel card: the
  whole name (long names can be cut off on the small cards), its park, the
  wait or status, and its Favorite and Ignore buttons. Tap ✕ or anywhere
  outside it to close it; it also closes by itself after a minute, so a
  kiosk isn't left covered.
- What's new, in Settings' About tab: each release's changes from this
  changelog, with its date, the installed version marked, and the newest
  open. Tap a release to open or close it.
- README screenshots of both.

## 1.0.0 - 2026-09-27

### Added
- Version numbers and releases. Kiosks now install only published releases
  (like `v1.0.0`) instead of whatever is on `main`, so unfinished work there
  never reaches them. A withdrawn release (its tag deleted) sends them back
  to the one before, and pre-releases are skipped. `make release
  VERSION=X.Y.Z` publishes one, after checking that GitHub's tests passed.
  Kiosks move over to this on their next update.
- An About tab in Settings: shows the installed version, with a "Check for
  updates and restart" button, so updating no longer means waiting for
  Sunday or doing a factory reset.
- A `Makefile` for running the app on your computer: `make start`,
  `make stop`, `make restart`, `make status`, `make logs`, and `make test`.
- README screenshots: the carousel, the grid, and the setup wizard's resort
  step (in `docs/screenshots/`).
- A factory reset, on the Settings screen's Reset tab: after a
  confirmation, it erases the settings, favorites, ignored items, trip
  countdown date, and saved Wi-Fi networks, and starts first-time setup
  again, as if new (e.g. before giving a kiosk to someone else).
- The end of first-time setup offers to check for updates and restart
  right away, so a new kiosk gets the latest version without waiting for
  the weekly update.
- Other Disney resorts: Disneyland Resort, Disneyland Paris, Tokyo Disney
  Resort, and Shanghai Disney Resort, alongside Walt Disney World. The setup
  wizard has a new "Which Disney resort?" step (defaulting to the local one
  in Japan, France, or China, and Disneyland on the US West Coast), and the
  dashboard's parks, skyline, wordmark, clock, time zone, and weather follow
  the choice. Each park has its own landmark drawing (Sleeping Beauty
  Castle, Pixar Pal-A-Round, the Paris castle and Tower of Terror, Mount
  Prometheus, and the Enchanted Storybook Castle), from the same landmark
  set as the kiosk's 3D-printed frames. Favorites and ignored items are kept
  per resort: switching resorts hides the other resort's picks until you
  switch back.
- A browser tab icon: the dashboard's filled-in Cinderella Castle on a dark
  rounded square, with PNG versions for older browsers and for adding the
  page to a phone's home screen.
- README: an Acknowledgments section, thanking Kayleigh Lund for UI/UX
  design feedback and testing.

### Fixed
- The kiosk's web server served the whole project folder, so any device on
  its network could fetch the scripts, tests, or `.git` data. It now serves
  only `web/`.
- After an update, a browser could keep using stale copies of some of the
  app's files alongside new ones, leaving the dashboard stuck on "Loading
  wait times…". The server now has browsers check for newer files on every
  load.

### Changed
- The project is organized into folders: `web/` (the dashboard and setup
  wizard), `server/`, and `kiosk/` (the Pi side), with `install.sh` still at
  the top. Installed kiosks move over on their next update: it pulls the new
  layout and reruns the installer, which points everything at the new
  locations.
- The kiosk's wallpaper is a much smaller file (37 KB instead of 425 KB),
  with no visible difference.
- Removed the unused original landmark artwork (`landmarks/`), superseded by
  `web/landmarks.js`.
- After first-time setup, holding ⚙ now opens a tabbed Settings screen
  (Resort, Display, Wi-Fi, Location, Reset) instead of repeating every setup step,
  so one thing can be changed on its own. Each change is saved as soon as
  it's tapped.

## 2026-09-26

### Added
- Setup wizard: on first start, the kiosk walks through country (and Wi-Fi
  region), time zone, °F/°C and 12/24-hour display, and Wi-Fi, all on the
  touchscreen with a built-in keyboard. If it later can't get online, it
  jumps to the Wi-Fi step on its own; press and hold the new ⚙ button to
  change settings. Only the kiosk itself can make these changes. Kiosks
  already set up will see the wizard once after updating.
- Shows and meet-and-greets: parades, stage shows, fireworks, and character
  appearances now appear with their next time ("Show 2:00 PM" / "Next 2:00
  PM" in the grid, "Next show at 2:00 PM" in the carousel), then "No more
  shows" after the last one. Those that run over a window instead show a
  wait time, "Operating", or "Opens *time*". This includes The American
  Adventure, whose performance times were already in the data. Shows only for
  special ticketed events are left out automatically.
- Ignoring items: a "−" button on each grid card and a "− Ignore" button in
  the carousel hide anything (ride, show, or exhibit). Ignored items leave
  the carousel and move to the grid's Inactive section, where "+" brings them
  back. The list is saved on each kiosk, like favorites.
- Grid groups: the grid is now an accordion with Active and Inactive
  sections, each split into Rides & Attractions, Shows, Meet & Greets, and
  Exhibits & Walk-throughs, with an Ignore all / Activate all button per
  group.
- MIT license.
- This changelog.
- Automated tests for the app's logic, the favorites server, and the weekly
  update script, run by GitHub on every push along with a lint check of the
  shell scripts.

### Fixed
- Choosing a Wi-Fi network the kiosk already knew made the setup wizard
  reconnect from scratch, rewriting the network's saved settings, which
  could fail (e.g. for a network set up by Raspberry Pi Imager) and was
  reported as a wrong password. Known networks are now marked "Saved" and
  connect with one tap using their saved settings (the password is asked
  for only if those no longer work); choosing the network it's already on
  just says so and moves on.
- The setup wizard blamed the password for every failed Wi-Fi connection.
  It now says so only for real password problems, reports missing
  permissions or other failures separately, and logs the details.
- The setup keyboard's Shift key still looked on after typing a capital
  letter (though it was off), so it took two taps to turn off. It now turns
  off, and looks off, right after the letter.
- The setup wizard showed a blank screen with a lone "Next" button for a
  few seconds before the Welcome screen. The Welcome screen now appears
  right away while the rest loads in the background, and the Pi's status
  check that caused most of the wait is faster (its commands run at the
  same time, and it no longer tests the internet on the spot).
- Swiping didn't scroll the setup wizard on the kiosk's touchscreen, so long
  lists (like US time zones) couldn't be scrolled. The touchscreen sends
  swipes as mouse drags, which the wizard now scrolls with, like the
  dashboard grid; a swipe that starts on a button no longer presses it.
- The weather showed a sun on clear nights. It now shows a moon after dark
  (and a cloud for a partly cloudy night).

### Changed
- When park data can't be loaded, the dashboard retries every 30 seconds
  instead of waiting for the next 5-minute refresh.
- README: names the display the kiosk was developed with (a Hosyond 7-inch
  DSI touchscreen), and corrects the claim that Raspberry Pi OS has no
  on-screen keyboard.
- Rides, shows, and exhibits with no wait time are no longer hidden or shown
  as just "Closed". They now read "Operating" when running (e.g. The Hall of
  Presidents), and "Opens *time*" when they open later in the day. The grid
  lists everything, with these status words sized to fill each card; the
  carousel adds "Operating" rides and shows and items opening later, while
  exhibits and walk-throughs stay in the grid unless starred as favorites.
- The app's decision logic moved from `app.js` into `logic.js` so it can be
  tested; the dashboard itself behaves exactly as before.
- README rewritten for anyone using the project: requirements, a
  not-affiliated-with-Disney disclaimer, data source credits, and a note that
  a kiosk updates from wherever it was cloned (so forks should clone their
  own copy).

## 2026-09-25

### Changed
- Parks are now picked from the landmark skyline along the bottom instead of
  park tabs: tap a landmark to show just that park, tap it again to go back
  to All Parks. Only All Parks and Favorites remain as tabs. The skyline now
  appears in grid view too.
- Park emojis are gone from the status bar and grid card tags (now plain
  "MK", "EP", "HS", "AK"), to match the line-drawn landmarks.

## 2026-09-25: first release

The dashboard and Raspberry Pi kiosk setup as first published.

### Dashboard
- Live wait times for Magic Kingdom, EPCOT, Hollywood Studios, and Animal
  Kingdom, in a carousel or a grid, refreshed every 5 minutes.
- Favorites: star rides to see them together; saved on the device, so they
  survive reboots and updates.
- Closed parks get a "*Park* is closed. Opening tomorrow at *time*" slide,
  except while rides are still running for a ticketed evening event.
- A skyline of park landmarks, with the current ride's park filled in.
- Park weather, today's hours (including ticketed event windows), and a
  countdown to your next trip.
- Times always shown in 12-hour park time, whatever the device's locale.

### Raspberry Pi kiosk
- One-step installer (`install.sh`) that sets up the local server, starts
  Chromium full-screen at login, and turns off screen blanking.
- Reliable startup: Chromium starts from a fresh profile each boot, waits for
  the network, skips features a kiosk doesn't need, and reloads the page if
  it hasn't loaded within a minute.
- A tidy screen: "Magic Starting…" boot splash, "Magic Loading…" wallpaper,
  no desktop icons, a hidden taskbar, no pop-up notifications, and no mouse
  pointer.
- Faster boot by disabling services the kiosk doesn't need (cloud-init,
  Bluetooth).
- Weekly self-update from GitHub every Sunday at 4:00 AM, followed by a
  reboot.
