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
sys.path.insert(0, os.path.join(PROJECT_DIR, "server"))


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

    def test_app_files_are_rechecked_but_saved_data_is_never_cached(self):
        # So a browser never mixes an updated file with stale cached ones.
        with urllib.request.urlopen(self.base + "/app.js") as res:
            self.assertEqual(res.headers.get("Cache-Control"), "no-cache")
        with urllib.request.urlopen(self.base + "/api/favorites") as res:
            self.assertEqual(res.headers.get("Cache-Control"), "no-store")

    def test_only_the_web_folder_is_served(self):
        # Scripts, the server's own code, tests, and git data stay private,
        # including via "../" tricks.
        for path in ["/server.py", "/server/server.py", "/install.sh", "/kiosk/kiosk.sh",
                     "/tests/test_server.py", "/.git/config", "/../install.sh", "/%2e%2e/install.sh",
                     "/../server/server.py"]:
            with self.subTest(path=path):
                status, body = self.request("GET", path)
                self.assertEqual(status, 404, body[:80] if isinstance(body, bytes) else body)

    def test_the_app_itself_is_served(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>Disney Parks Wait Times</title>", body)
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
        self.assertEqual(self.request("PUT", "/api/settings", {"resort": "tdr"})[1]["resort"], "tdr")

    def test_allowed_resorts_match_logic_js(self):
        # The server's list must be kept in step with RESORTS in logic.js.
        import re
        with open(os.path.join(PROJECT_DIR, "web", "logic.js")) as f:
            ids = re.findall(r'^    id: "(\w+)",', f.read(), re.M)
        server = importlib.import_module("server")
        self.assertEqual(ids, list(server.SETTINGS_VALUES["resort"]))

    def test_bad_settings_are_rejected(self):
        for body in [{"units": "K"}, {"clock": 24}, {"setupComplete": "yes"}, {"theme": "dark"}, ["units"],
                     {"resort": "epcot"}]:
            with self.subTest(body=body):
                self.assertEqual(self.request("PUT", "/api/settings", body)[0], 400)
        self.assertEqual(self.request("GET", "/api/settings"), (200, {}))

    # ---- setup wizard (pretend system) ----

    def test_status_and_networks(self):
        status, body = self.request("GET", "/api/system/status")
        self.assertEqual(status, 200)
        self.assertTrue(body["fake"])
        self.assertEqual(body["country"], "US")
        self.assertIsInstance(body["version"], str)
        self.assertTrue(body["version"])
        status, networks = self.request("GET", "/api/system/networks")
        names = [n["ssid"] for n in networks]
        self.assertEqual(len(names), len(set(names)))  # one entry per network
        self.assertEqual(names[0], "HomeWiFi")  # strongest first

    def test_countries_include_their_time_zones(self):
        status, countries = self.request("GET", "/api/system/countries")
        japan = next(c for c in countries if c["code"] == "JP")
        self.assertEqual((japan["name"], japan["timezones"]), ("Japan", ["Asia/Tokyo"]))

    def test_connecting_to_wifi(self):
        ok = self.request("PUT", "/api/system/wifi", {"ssid": "HomeWiFi", "password": "goodpassword"})
        self.assertEqual(ok, (200, {"ok": True, "message": "Connected to HomeWiFi."}))
        wrong = self.request("PUT", "/api/system/wifi", {"ssid": "HomeWiFi", "password": "wrong"})
        self.assertFalse(wrong[1]["ok"])
        self.assertIn("password", wrong[1]["message"])
        for body in [{"password": "x"}, {"ssid": ""}, {"ssid": "x" * 33}, {"ssid": "a", "password": 5}]:
            with self.subTest(body=body):
                self.assertEqual(self.request("PUT", "/api/system/wifi", body)[0], 400)

    def test_checking_for_updates(self):
        self.assertEqual(self.request("PUT", "/api/system/update", {}), (200, {"ok": True}))

    def test_factory_reset_erases_settings_and_lists(self):
        self.request("PUT", "/api/settings", {"setupComplete": True, "resort": "tdr"})
        self.request("PUT", "/api/favorites", ["a", "b"])
        self.request("PUT", "/api/ignored", ["c"])
        self.assertEqual(self.request("PUT", "/api/system/reset", {}), (200, {"ok": True, "forgotWifi": 1}))
        self.assertEqual(self.request("GET", "/api/settings"), (200, {}))  # setup runs again
        # Its Wi-Fi is forgotten: offline, and the network is no longer "Saved".
        self.assertFalse(self.request("GET", "/api/system/status")[1]["online"])
        self.assertFalse(any(n["saved"] for n in self.request("GET", "/api/system/networks")[1]))
        self.assertEqual(self.request("GET", "/api/favorites"), (200, []))
        self.assertEqual(self.request("GET", "/api/ignored"), (200, []))
        self.assertEqual(os.listdir(self.data_dir.name), [])
        # Resetting again (nothing left to erase) is fine too.
        self.assertEqual(self.request("PUT", "/api/system/reset", {}), (200, {"ok": True, "forgotWifi": 0}))

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


class VersionTest(unittest.TestCase):
    def test_describing_the_version(self):
        server = importlib.import_module("server")
        for described, shown in [
            ("v1.2.0", "1.2.0"),  # a kiosk, on a release
            ("v1.2.0-1-gabc1234", "1.2.0 + 1 change (abc1234)"),
            ("v1.2.0-3-gabc1234", "1.2.0 + 3 changes (abc1234)"),
            ("v1.2.0-3-gabc1234-dirty", "1.2.0 + 3 changes (abc1234), edited"),
            ("abc1234", "development (abc1234)"),  # before any release
            ("abc1234-dirty", "development (abc1234)"),
            ("", "unknown"),  # not a git copy
        ]:
            with self.subTest(described=described):
                self.assertEqual(server.describe_version(described), shown)


class ChangelogTest(unittest.TestCase):
    SAMPLE = """# Changelog

Intro text for developers.

## Unreleased

### Added
- Not installed yet.

## 1.1.0 - 2026-10-04

### Added
- A [linked](README.md#x) thing with `code`, **bold**, and *italics*,
  wrapped onto a second line.
- Another thing.

### Fixed
- A fix.

## 2026-09-25: first release

The start.

### Dashboard
- Wait times.
"""

    def test_releases_newest_first_without_unreleased(self):
        server = importlib.import_module("server")
        newer, older = server.parse_changelog(self.SAMPLE)
        self.assertEqual((newer["version"], newer["date"], newer["label"]), ("1.1.0", "2026-10-04", None))
        self.assertEqual(newer["sections"], [
            {"title": "Added", "items": [
                "A linked thing with code, bold, and italics, wrapped onto a second line.",
                "Another thing.",
            ]},
            {"title": "Fixed", "items": ["A fix."]},
        ])
        self.assertEqual((older["version"], older["date"], older["label"]), (None, "2026-09-25", "first release"))
        self.assertEqual(older["notes"], ["The start."])
        self.assertEqual(older["sections"], [{"title": "Dashboard", "items": ["Wait times."]}])

    def test_the_real_changelog_reads(self):
        server = importlib.import_module("server")
        releases = server.read_changelog()
        self.assertTrue(releases)
        for release in releases:
            with self.subTest(release=release["version"] or release["date"]):
                self.assertTrue(release["sections"])
                for section in release["sections"]:
                    self.assertTrue(section["items"])
                    for item in section["items"]:
                        self.assertNotIn("`", item)
                        self.assertNotRegex(item, r"\]\(")


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
            ("PUT", "/api/system/reset", {}),
            ("PUT", "/api/system/update", {}),
        ]:
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, body)[0], 403)
        # Reading settings and the changelog, and using favorites, still work.
        self.assertEqual(self.request("GET", "/api/settings")[0], 200)
        self.assertEqual(self.request("GET", "/api/changelog")[0], 200)
        self.assertEqual(self.request("PUT", "/api/favorites", ["a"]), (200, ["a"]))

    # The inherited tests that change the system don't apply from elsewhere.
    test_settings_start_empty_and_merge = None
    test_bad_settings_are_rejected = None
    test_status_and_networks = None
    test_countries_include_their_time_zones = None
    test_connecting_to_wifi = None
    test_country_and_time_zone = None
    test_factory_reset_erases_settings_and_lists = None
    test_checking_for_updates = None


if __name__ == "__main__":
    unittest.main()
