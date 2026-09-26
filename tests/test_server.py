"""Tests for server.py. Run with: python3 -m unittest discover -s tests

Uses only the standard library. Each test gets a real server on a free port
with its own temporary favorites folder, so nothing touches real favorites.
"""

import importlib
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_DIR)


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.data_dir = tempfile.TemporaryDirectory()
        # server.py reads WDW_DATA_DIR when it's imported, so (re)import it
        # with this test's folder in place.
        os.environ["WDW_DATA_DIR"] = self.data_dir.name
        server = importlib.reload(importlib.import_module("server"))

        class QuietHandler(server.Handler):
            def log_message(self, *args):
                pass  # keep test output to results only

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.data_dir.cleanup()
        del os.environ["WDW_DATA_DIR"]

    def request(self, method, path, body=None):
        """Returns (status, parsed JSON or raw bytes)."""
        data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        try:
            with urllib.request.urlopen(req) as res:
                raw = res.read()
                is_json = res.headers.get("Content-Type") == "application/json"
                return res.status, json.loads(raw) if is_json else raw
        except urllib.error.HTTPError as err:
            with err:
                return err.code, err.read()

    @property
    def favorites_file(self):
        return os.path.join(self.data_dir.name, "favorites.json")

    def test_no_favorites_yet(self):
        self.assertEqual(self.request("GET", "/api/favorites"), (200, []))

    def test_saved_favorites_come_back(self):
        self.assertEqual(self.request("PUT", "/api/favorites", ["a", "b"]), (200, ["a", "b"]))
        self.assertEqual(self.request("GET", "/api/favorites"), (200, ["a", "b"]))
        with open(self.favorites_file) as f:
            self.assertEqual(json.load(f), ["a", "b"])

    def test_saving_replaces_the_list(self):
        self.request("PUT", "/api/favorites", ["a", "b"])
        self.request("PUT", "/api/favorites", ["c"])
        self.assertEqual(self.request("GET", "/api/favorites"), (200, ["c"]))

    def test_duplicates_are_dropped_keeping_order(self):
        self.assertEqual(self.request("PUT", "/api/favorites", ["b", "a", "b"]), (200, ["b", "a"]))

    def test_no_temp_files_left_behind(self):
        self.request("PUT", "/api/favorites", ["a"])
        self.assertEqual(os.listdir(self.data_dir.name), ["favorites.json"])

    def test_bad_input_is_rejected_and_nothing_saved(self):
        for body in [b"not json", {"a": 1}, ["ok", 3], "just a string"]:
            with self.subTest(body=body):
                status, _ = self.request("PUT", "/api/favorites", body)
                self.assertEqual(status, 400)
        self.assertFalse(os.path.exists(self.favorites_file))

    def test_oversized_body_is_rejected(self):
        status, _ = self.request("PUT", "/api/favorites", ["x" * 70000])
        self.assertEqual(status, 413)

    def test_only_the_favorites_path_accepts_saves(self):
        status, _ = self.request("PUT", "/index.html", ["a"])
        self.assertEqual(status, 404)

    def test_damaged_favorites_file_reads_as_empty(self):
        for content in ["{not json", '{"a": 1}', '["ok", 3, null]']:
            with self.subTest(content=content):
                with open(self.favorites_file, "w") as f:
                    f.write(content)
                expected = ["ok"] if content.startswith('["ok"') else []
                self.assertEqual(self.request("GET", "/api/favorites"), (200, expected))

    def test_the_app_itself_is_served(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>WDW Wait Times</title>", body)
        self.assertEqual(self.request("GET", "/logic.js")[0], 200)


if __name__ == "__main__":
    unittest.main()
