# Changelog

Notable changes to this project, newest first. Installed kiosks pick up
changes from `main` in their weekly Sunday update (see
[Updates](README.md#updates)), so each dated section below is roughly what a
kiosk gets that week.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project doesn't use version numbers, so sections are dated instead.

## Unreleased

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
