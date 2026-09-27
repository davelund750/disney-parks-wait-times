#!/usr/bin/env python3
"""Serves the app's static files, plus a small API.

Saved on the device (the kiosk's browser profile is wiped on every boot, so
these can't live in the browser; they're kept in files outside the project
folder, so updating the app never overwrites them):

  GET/PUT /api/favorites   JSON list of favorited ride ids
  GET/PUT /api/ignored     JSON list of ride ids hidden from the dashboard
  GET/PUT /api/settings    JSON object: setupComplete, units ("F"/"C"),
                           clock ("12"/"24"), resort ("wdw", "dlr", ...);
                           PUT merges in the given keys

For the setup wizard (see system.py). These change the Pi itself, so they
only answer requests from the Pi, never from elsewhere on the network:

  GET /api/system/status      current Wi-Fi network, online?, country, time zone
  GET /api/system/networks    nearby Wi-Fi networks, strongest first
  GET /api/system/countries   countries with their time zones
  PUT /api/system/wifi        {ssid, password, hidden} -> {ok, message}
  PUT /api/system/country     {code}       e.g. "JP"; sets the Wi-Fi region
  PUT /api/system/timezone    {timezone}   e.g. "Asia/Tokyo"
  PUT /api/system/update      check for updates now (the weekly update's
                              update.sh), then reboot
  PUT /api/system/reset       factory reset: erases settings, favorites,
                              ignored items, and saved Wi-Fi networks, so
                              the kiosk starts over with the setup wizard

Usage: python3 server.py   (PORT and WDW_DATA_DIR env vars override defaults)
"""

import json
import os
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import system

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("WDW_DATA_DIR", os.path.expanduser("~/.local/share/wdw-wait-times"))
# Each saved list: its API path -> the file it's kept in.
LISTS = {
    "/api/favorites": "favorites.json",
    "/api/ignored": "ignored.json",
}
SETTINGS_FILE = "settings.json"
SETTINGS_PATH = "/api/settings"
# Allowed settings and their allowed values (None: any true/false).
# (Resort ids are the ones in RESORTS in logic.js.)
SETTINGS_VALUES = {
    "setupComplete": None,
    "units": ("F", "C"),
    "clock": ("12", "24"),
    "resort": ("wdw", "dlr", "dlp", "tdr", "shdr"),
}
SYSTEM_PREFIX = "/api/system/"
LOCAL_ADDRESSES = ("127.0.0.1", "::1", "::ffff:127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
MAX_BODY_BYTES = 64 * 1024
SYSTEM = system.make_system()


def read_list(filename):
    try:
        with open(os.path.join(DATA_DIR, filename)) as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError):
        return []
    return [x for x in data if isinstance(x, str)] if isinstance(data, list) else []


def write_json(filename, data):
    # Write to a temp file and swap it in, so a power cut mid-write can't
    # leave a half-written file behind.
    os.makedirs(DATA_DIR, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp_path, os.path.join(DATA_DIR, filename))


def read_settings():
    try:
        with open(os.path.join(DATA_DIR, SETTINGS_FILE)) as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError):
        return {}
    return {k: v for k, v in data.items() if valid_setting(k, v)} if isinstance(data, dict) else {}


def valid_setting(key, value):
    if key not in SETTINGS_VALUES:
        return False
    allowed = SETTINGS_VALUES[key]
    return isinstance(value, bool) if allowed is None else value in allowed


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def end_headers(self):
        # The app's files: let browsers cache them, but check for a newer
        # version on every load (an unchanged file is a quick "not modified").
        # Otherwise a browser can mix an updated file with stale ones.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path in LISTS:
            self.send_json(200, read_list(LISTS[self.path]))
        elif self.path == SETTINGS_PATH:
            self.send_json(200, read_settings())
        elif self.path.startswith(SYSTEM_PREFIX):
            self.system_get(self.path[len(SYSTEM_PREFIX):])
        else:
            super().do_GET()

    def do_PUT(self):
        if self.path.startswith(SYSTEM_PREFIX):
            self.system_put(self.path[len(SYSTEM_PREFIX):])
            return
        if self.path == SETTINGS_PATH:
            self.put_settings()
            return
        if self.path not in LISTS:
            self.send_error(404)
            return
        ids = self.read_json_body()
        if ids is None:
            return
        if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
            self.send_error(400, "body must be a list of ride ids")
            return
        ids = list(dict.fromkeys(ids))  # drop duplicates, keep order
        write_json(LISTS[self.path], ids)
        self.send_json(200, ids)

    def read_json_body(self):
        """The request's JSON body, or None after sending an error."""
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            self.send_error(413)
            return None
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            self.send_error(400, "body must be JSON")
            return None

    def put_settings(self):
        if not self.is_local():
            self.send_error(403, "settings can only be changed from the kiosk itself")
            return
        changes = self.read_json_body()
        if changes is None:
            return
        if not isinstance(changes, dict) or not all(valid_setting(k, v) for k, v in changes.items()):
            self.send_error(400, "unknown setting or value")
            return
        settings = {**read_settings(), **changes}
        write_json(SETTINGS_FILE, settings)
        self.send_json(200, settings)

    def is_local(self):
        return self.client_address[0] in LOCAL_ADDRESSES

    def system_get(self, action):
        if not self.is_local():
            self.send_error(403, "only available on the kiosk itself")
        elif action == "status":
            self.send_json(200, {**SYSTEM.status(), "fake": SYSTEM.fake})
        elif action == "networks":
            self.send_json(200, SYSTEM.networks())
        elif action == "countries":
            self.send_json(200, system.countries())
        else:
            self.send_error(404)

    def system_put(self, action):
        if not self.is_local():
            self.send_error(403, "only available on the kiosk itself")
            return
        body = self.read_json_body()
        if body is None:
            return
        if not isinstance(body, dict):
            self.send_error(400, "body must be a JSON object")
        elif action == "wifi":
            ssid, password = body.get("ssid"), body.get("password", "")
            if not isinstance(ssid, str) or not ssid or len(ssid) > 32 or not isinstance(password, str):
                self.send_error(400, "ssid (1-32 characters) and password (text) required")
                return
            self.send_json(200, SYSTEM.connect(ssid, password, bool(body.get("hidden"))))
        elif action == "country":
            code = body.get("code")
            if not isinstance(code, str) or not system.COUNTRY_CODE.match(code):
                self.send_error(400, "code must be a two-letter country code, e.g. JP")
                return
            self.send_json(200, {"ok": SYSTEM.set_country(code)})
        elif action == "update":
            self.send_json(200, {"ok": SYSTEM.start_update()})
        elif action == "reset":
            for filename in [SETTINGS_FILE, *LISTS.values()]:
                try:
                    os.remove(os.path.join(DATA_DIR, filename))
                except FileNotFoundError:
                    pass
            # Last, since it takes the kiosk offline.
            self.send_json(200, {"ok": True, "forgotWifi": SYSTEM.forget_wifi()})
        elif action == "timezone":
            name = body.get("timezone")
            if not isinstance(name, str) or not system.is_timezone(name):
                self.send_error(400, "unknown time zone")
                return
            self.send_json(200, {"ok": SYSTEM.set_timezone(name)})
        else:
            self.send_error(404)

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    mode = " (pretend system: nothing on this computer is changed)" if SYSTEM.fake else ""
    print(f"Serving {APP_DIR} on port {PORT}; saved data in {DATA_DIR}{mode}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
