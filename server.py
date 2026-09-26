#!/usr/bin/env python3
"""Serves the app's static files, plus a tiny API for saving favorites.

  GET /api/favorites   -> JSON list of favorited ride ids
  PUT /api/favorites   <- JSON list of ride ids; replaces the saved list

The kiosk's browser profile is wiped on every boot, so favorites can't live in
the browser. They're kept in a file outside the project folder instead, so
copying a new version of the app onto the Pi never overwrites them.

Usage: python3 server.py   (PORT and WDW_DATA_DIR env vars override defaults)
"""

import json
import os
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("WDW_DATA_DIR", os.path.expanduser("~/.local/share/wdw-wait-times"))
FAVORITES_FILE = os.path.join(DATA_DIR, "favorites.json")
FAVORITES_PATH = "/api/favorites"
PORT = int(os.environ.get("PORT", "8000"))
MAX_BODY_BYTES = 64 * 1024


def read_favorites():
    try:
        with open(FAVORITES_FILE) as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError):
        return []
    return [x for x in data if isinstance(x, str)] if isinstance(data, list) else []


def write_favorites(ids):
    # Write to a temp file and swap it in, so a power cut mid-write can't
    # leave a half-written favorites file behind.
    os.makedirs(DATA_DIR, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(ids, f)
    os.replace(tmp_path, FAVORITES_FILE)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def do_GET(self):
        if self.path == FAVORITES_PATH:
            self.send_json(200, read_favorites())
        else:
            super().do_GET()

    def do_PUT(self):
        if self.path != FAVORITES_PATH:
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
        write_favorites(ids)
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
    print(f"Serving {APP_DIR} on port {PORT}; favorites in {FAVORITES_FILE}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
