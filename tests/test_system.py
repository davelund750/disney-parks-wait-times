"""Tests for system.py's Pi-side helpers, without running any real system
commands. Run with: python3 -m unittest discover -s tests"""

import os
import subprocess
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import system  # noqa: E402


class FakeCommands(system.RealSystem):
    """RealSystem with canned command output, each command taking `delay`."""

    def __init__(self, outputs, delay=0.0):
        self.outputs, self.delay, self.calls = outputs, delay, []

    def _run(self, *args, timeout=30):
        self.calls.append(args)
        time.sleep(self.delay)
        key = " ".join(args)
        out = next((v for k, v in self.outputs.items() if key.startswith(k)), "")
        return subprocess.CompletedProcess(args, 0, stdout=out, stderr="")


STATUS_OUTPUTS = {
    "nmcli -t -e yes -f ACTIVE,SSID dev wifi": "no:Neighbor\nyes:Swamp\\:Net\n",
    "nmcli networking connectivity": "full\n",
    "sudo -n raspi-config nonint get_wifi_country": "JP\n",
    "timedatectl show -p Timezone --value": "Asia/Tokyo\n",
}


class RealSystemTest(unittest.TestCase):
    def test_status_reads_each_command(self):
        status = FakeCommands(STATUS_OUTPUTS).status()
        self.assertEqual(status, {"ssid": "Swamp:Net", "online": True, "country": "JP", "timezone": "Asia/Tokyo"})

    def test_status_asks_all_at_once(self):
        # Four commands at 0.3s each: about 0.3s together, not 1.2s in a row.
        start = time.monotonic()
        FakeCommands(STATUS_OUTPUTS, delay=0.3).status()
        self.assertLess(time.monotonic() - start, 0.8)

    def test_status_uses_the_quick_connectivity_answer(self):
        commands = FakeCommands(STATUS_OUTPUTS)
        commands.status()
        self.assertNotIn(("nmcli", "networking", "connectivity", "check"), commands.calls)

    def test_networks_listed_once_each_strongest_first(self):
        out = "Swamp\\:Net:64:WPA2\nSwamp\\:Net:100:WPA2\nCafe:40:\n:90:WPA2\n"
        networks = FakeCommands({"nmcli -t -e yes -f SSID,SIGNAL,SECURITY": out}).networks()
        self.assertEqual(networks, [
            {"ssid": "Swamp:Net", "signal": 100, "secure": True, "saved": False},
            {"ssid": "Cafe", "signal": 40, "secure": False, "saved": False},
        ])  # the nameless (hidden) network is left out

    def test_connect_errors_only_blame_the_password_when_it_is_the_password(self):
        cases = {
            "Error: Connection activation failed: Secrets were required, but not provided.": system.WRONG_PASSWORD,
            "Error: 802-11-wireless-security.psk: property is invalid.": system.WRONG_PASSWORD,
            "Error: No network with SSID 'Nope' found.": system.NOT_FOUND,
            "Error: Failed to add/activate new connection: Not authorized to control networking.": system.NOT_ALLOWED,
            "Error: Connection activation failed: IP configuration could not be reserved.": system.CONNECT_FAILED,
        }
        for detail, expected in cases.items():
            with self.subTest(detail=detail):
                self.assertEqual(system.connect_error(detail), expected)

    SAVED = {
        "nmcli -t -e yes -f NAME,TYPE connection show": "netplan-wlan0-SwampNet:802-11-wireless\nWired:802-3-ethernet\n",
        "nmcli -g 802-11-wireless.ssid connection show netplan-wlan0-SwampNet": "SwampNet\n",
    }

    def test_saved_networks_connect_with_their_saved_settings(self):
        commands = FakeCommands(self.SAVED)
        self.assertEqual(commands.connect("SwampNet", "", False), {"ok": True, "message": "Connected to SwampNet."})
        self.assertIn(("nmcli", "connection", "up", "netplan-wlan0-SwampNet"), commands.calls)
        # It never rewrites the saved network with a fresh connect.
        self.assertFalse(any(c[:4] == ("nmcli", "dev", "wifi", "connect") for c in commands.calls))

    def test_new_locked_network_without_a_password_asks_for_one(self):
        result = FakeCommands(self.SAVED).connect("Neighbor", "", False)
        self.assertEqual((result["ok"], result.get("needsPassword")), (False, True))

    def test_saved_network_that_no_longer_works_asks_for_the_password(self):
        class SavedButFailing(FakeCommands):
            def _run(self, *args, timeout=30):
                if args[:3] == ("nmcli", "connection", "up"):
                    self.calls.append(args)
                    return subprocess.CompletedProcess(args, 4, stdout="", stderr="Error: Connection activation failed: Secrets were required")
                return super()._run(*args, timeout=timeout)
        result = SavedButFailing(self.SAVED).connect("SwampNet", "", False)
        self.assertEqual((result["ok"], result.get("needsPassword")), (False, True))

    def test_country_code_must_look_like_one(self):
        self.assertEqual(FakeCommands({"sudo -n raspi-config": "JP\n"}).country(), "JP")
        self.assertIsNone(FakeCommands({"sudo -n raspi-config": "sudo: a password is required\n"}).country())


if __name__ == "__main__":
    unittest.main()
