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
- MIT license.
- This changelog.

### Changed
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
