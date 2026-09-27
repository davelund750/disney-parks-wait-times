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
    remote_client = False  # RemoteClientTest pretends requests come from elsewhere

    def setUp(self):
        self.data_dir = tempfile.TemporaryDirectory()
        # server.py reads WDW_DATA_DIR when it's imported, so (re)import it
        # with this test's folder in place.
        os.environ["WDW_DATA_DIR"] = self.data_dir.name
        # Never touch the real system, even on a Pi.
        os.environ["WDW_FAKE_SYSTEM"] = "1"
        os.environ.pop("WDW_FAKE_OFFLINE", None)
        server = importlib.reload(importlib.import_module("server"))
        remote = self.remote_client

        class QuietHandler(server.Handler):
            def log_message(self, *args):
                pass  # keep test output to results only

            def is_local(self):
                return not remote and super().is_local()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.data_dir.cleanup()
        del os.environ["WDW_DATA_DIR"]
        del os.environ["WDW_FAKE_SYSTEM"]

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

    def test_only_the_list_paths_accept_saves(self):
        status, _ = self.request("PUT", "/index.html", ["a"])
        self.assertEqual(status, 404)

    def test_damaged_favorites_file_reads_as_empty(self):
        for content in ["{not json", '{"a": 1}', '["ok", 3, null]']:
            with self.subTest(content=content):
                with open(self.favorites_file, "w") as f:
                    f.write(content)
                expected = ["ok"] if content.startswith('["ok"') else []
                self.assertEqual(self.request("GET", "/api/favorites"), (200, expected))

    def test_ignored_list_is_saved_separately_from_favorites(self):
        self.assertEqual(self.request("GET", "/api/ignored"), (200, []))
        self.request("PUT", "/api/favorites", ["fav"])
        self.assertEqual(self.request("PUT", "/api/ignored", ["x", "x", "y"]), (200, ["x", "y"]))
        self.assertEqual(self.request("GET", "/api/ignored"), (200, ["x", "y"]))
        self.assertEqual(self.request("GET", "/api/favorites"), (200, ["fav"]))
        with open(os.path.join(self.data_dir.name, "ignored.json")) as f:
            self.assertEqual(json.load(f), ["x", "y"])

    def test_the_app_itself_is_served(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>WDW Wait Times</title>", body)
        self.assertEqual(self.request("GET", "/logic.js")[0], 200)

    # ---- settings ----

    def test_settings_start_empty_and_merge(self):
        self.assertEqual(self.request("GET", "/api/settings"), (200, {}))
        self.assertEqual(self.request("PUT", "/api/settings", {"units": "C"}), (200, {"units": "C"}))
        self.assertEqual(
            self.request("PUT", "/api/settings", {"clock": "24", "setupComplete": True}),
            (200, {"units": "C", "clock": "24", "setupComplete": True}),
        )
        self.assertEqual(self.request("GET", "/api/settings")[1]["units"], "C")

    def test_bad_settings_are_rejected(self):
        for body in [{"units": "K"}, {"clock": 24}, {"setupComplete": "yes"}, {"theme": "dark"}, ["units"]]:
            with self.subTest(body=body):
                self.assertEqual(self.request("PUT", "/api/settings", body)[0], 400)
        self.assertEqual(self.request("GET", "/api/settings"), (200, {}))

    # ---- setup wizard (pretend system) ----

    def test_status_and_networks(self):
        status, body = self.request("GET", "/api/system/status")
        self.assertEqual(status, 200)
        self.assertTrue(body["fake"])
        self.assertEqual(body["country"], "US")
        status, networks = self.request("GET", "/api/system/networks")
        names = [n["ssid"] for n in networks]
        self.assertEqual(len(names), len(set(names)))  # one entry per network
        self.assertEqual(names[0], "SwampNet")  # strongest first

    def test_countries_include_their_time_zones(self):
        status, countries = self.request("GET", "/api/system/countries")
        japan = next(c for c in countries if c["code"] == "JP")
        self.assertEqual((japan["name"], japan["timezones"]), ("Japan", ["Asia/Tokyo"]))

    def test_connecting_to_wifi(self):
        ok = self.request("PUT", "/api/system/wifi", {"ssid": "SwampNet", "password": "goodpassword"})
        self.assertEqual(ok, (200, {"ok": True, "message": "Connected to SwampNet."}))
        wrong = self.request("PUT", "/api/system/wifi", {"ssid": "SwampNet", "password": "wrong"})
        self.assertFalse(wrong[1]["ok"])
        self.assertIn("password", wrong[1]["message"])
        for body in [{"password": "x"}, {"ssid": ""}, {"ssid": "x" * 33}, {"ssid": "a", "password": 5}]:
            with self.subTest(body=body):
                self.assertEqual(self.request("PUT", "/api/system/wifi", body)[0], 400)

    def test_country_and_time_zone(self):
        self.assertEqual(self.request("PUT", "/api/system/country", {"code": "JP"}), (200, {"ok": True}))
        self.assertEqual(self.request("PUT", "/api/system/timezone", {"timezone": "Asia/Tokyo"}), (200, {"ok": True}))
        status = self.request("GET", "/api/system/status")[1]
        self.assertEqual((status["country"], status["timezone"]), ("JP", "Asia/Tokyo"))
        # Only a two-letter code and a real time zone are passed on.
        for body in [{"code": "jp"}, {"code": "JPN"}, {"code": "JP; reboot"}]:
            with self.subTest(body=body):
                self.assertEqual(self.request("PUT", "/api/system/country", body)[0], 400)
        self.assertEqual(self.request("PUT", "/api/system/timezone", {"timezone": "Mars/Olympus"})[0], 400)


class RemoteClientTest(ServerTest):
    """Requests from elsewhere on the network: the dashboard and saved lists
    still work, but nothing can change the Pi's settings."""

    remote_client = True

    def test_system_and_settings_changes_are_refused(self):
        for method, path, body in [
            ("GET", "/api/system/status", None),
            ("GET", "/api/system/networks", None),
            ("PUT", "/api/system/wifi", {"ssid": "x", "password": "12345678"}),
            ("PUT", "/api/system/country", {"code": "JP"}),
            ("PUT", "/api/system/timezone", {"timezone": "Asia/Tokyo"}),
            ("PUT", "/api/settings", {"units": "C"}),
        ]:
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, body)[0], 403)
        # Reading settings and using favorites still works.
        self.assertEqual(self.request("GET", "/api/settings")[0], 200)
        self.assertEqual(self.request("PUT", "/api/favorites", ["a"]), (200, ["a"]))

    # The inherited tests that change the system don't apply from elsewhere.
    test_settings_start_empty_and_merge = None
    test_bad_settings_are_rejected = None
    test_status_and_networks = None
    test_countries_include_their_time_zones = None
    test_connecting_to_wifi = None
    test_country_and_time_zone = None


if __name__ == "__main__":
    unittest.main()
