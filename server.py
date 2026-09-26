#!/usr/bin/env python3
"""Serves the app's static files, plus a tiny API for saving two lists of
ride ids: favorites and ignored items.

  GET /api/favorites   -> JSON list of favorited ride ids
  PUT /api/favorites   <- JSON list of ride ids; replaces the saved list
  GET/PUT /api/ignored    the same, for items hidden from the dashboard

The kiosk's browser profile is wiped on every boot, so these can't live in
the browser. They're kept in files outside the project folder instead, so
updating the app on the Pi never overwrites them.

Usage: python3 server.py   (PORT and WDW_DATA_DIR env vars override defaults)
"""

import json
import os
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("WDW_DATA_DIR", os.path.expanduser("~/.local/share/wdw-wait-times"))
# Each saved list: its API path -> the file it's kept in.
LISTS = {
    "/api/favorites": "favorites.json",
    "/api/ignored": "ignored.json",
}
PORT = int(os.environ.get("PORT", "8000"))
MAX_BODY_BYTES = 64 * 1024


def read_list(filename):
    try:
        with open(os.path.join(DATA_DIR, filename)) as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError):
        return []
    return [x for x in data if isinstance(x, str)] if isinstance(data, list) else []


def write_list(filename, ids):
    # Write to a temp file and swap it in, so a power cut mid-write can't
    # leave a half-written file behind.
    os.makedirs(DATA_DIR, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(ids, f)
    os.replace(tmp_path, os.path.join(DATA_DIR, filename))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def do_GET(self):
        if self.path in LISTS:
            self.send_json(200, read_list(LISTS[self.path]))
        else:
            super().do_GET()

    def do_PUT(self):
        if self.path not in LISTS:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            self.send_error(413)
            return
        try:
            ids = json.loads(self.rfile.read(length))
        except ValueError:
            self.send_error(400, "body must be JSON")
            return
        if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
            self.send_error(400, "body must be a list of ride ids")
            return
        ids = list(dict.fromkeys(ids))  # drop duplicates, keep order
        write_list(LISTS[self.path], ids)
        self.send_json(200, ids)

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"Serving {APP_DIR} on port {PORT}; saved lists in {DATA_DIR}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
