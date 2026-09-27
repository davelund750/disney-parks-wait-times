"""System settings the setup wizard changes: Wi-Fi, the Wi-Fi country, and
the time zone.

RealSystem uses the Pi's own tools (nmcli, timedatectl, raspi-config).
install.sh grants the kiosk's user permission for exactly these actions.
FakeSystem only pretends, so the wizard can be tried on a computer that
isn't a Pi; server.py picks it automatically when nmcli isn't installed, or
when WDW_FAKE_SYSTEM=1.
"""

import os
import re
import shutil
import subprocess
import time

ZONEINFO = "/usr/share/zoneinfo"
COUNTRY_CODE = re.compile(r"^[A-Z]{2}$")

WRONG_PASSWORD = "Couldn't connect. Check the password and try again."
NOT_FOUND = "Couldn't find that network. Move closer to the router, or check the name."


def _read_tab(filename):
    """Rows of a tzdata .tab file, skipping comments."""
    try:
        with open(os.path.join(ZONEINFO, filename), encoding="utf-8") as f:
            return [line.rstrip("\n").split("\t") for line in f if line.strip() and not line.startswith("#")]
    except FileNotFoundError:
        return []


def countries():
    """Every country the time zone database knows, with its time zones:
    [{"code": "JP", "name": "Japan", "timezones": ["Asia/Tokyo"]}, ...]"""
    zones = {}
    for row in _read_tab("zone.tab"):
        if len(row) >= 3:
            zones.setdefault(row[0], []).append(row[2])
    result = [
        {"code": row[0], "name": row[1], "timezones": sorted(zones.get(row[0], []))}
        for row in _read_tab("iso3166.tab")
        if len(row) >= 2
    ]
    return sorted(result, key=lambda c: c["name"])


def is_timezone(name):
    return any(name in c["timezones"] for c in countries()) or name == "UTC"


def _split_terse(line):
    """Splits one line of `nmcli -t -e yes` output on unescaped colons."""
    fields, current, escaped = [], "", False
    for ch in line:
        if escaped:
            current += ch
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            fields.append(current)
            current = ""
        else:
            current += ch
    fields.append(current)
    return fields


def _unique_networks(networks):
    """One entry per network name (a mesh router shows up once per access
    point), keeping the strongest signal, strongest first."""
    best = {}
    for net in networks:
        if net["ssid"] and (net["ssid"] not in best or net["signal"] > best[net["ssid"]]["signal"]):
            best[net["ssid"]] = net
    return sorted(best.values(), key=lambda n: -n["signal"])


class RealSystem:
    fake = False

    def _run(self, *args, timeout=30):
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout)

    def networks(self):
        result = self._run(
            "nmcli", "-t", "-e", "yes", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes"
        )
        networks = []
        for line in result.stdout.splitlines():
            fields = _split_terse(line)
            if len(fields) == 3:
                ssid, signal, security = fields
                networks.append({
                    "ssid": ssid,
                    "signal": int(signal) if signal.isdigit() else 0,
                    "secure": security not in ("", "--"),
                })
        return _unique_networks(networks)

    def status(self):
        ssid = None
        for line in self._run("nmcli", "-t", "-e", "yes", "-f", "ACTIVE,SSID", "dev", "wifi").stdout.splitlines():
            fields = _split_terse(line)
            if len(fields) == 2 and fields[0] == "yes":
                ssid = fields[1]
        online = self._run("nmcli", "networking", "connectivity", "check").stdout.strip() == "full"
        return {"ssid": ssid, "online": online, "country": self.country(), "timezone": self.timezone()}

    def connect(self, ssid, password, hidden):
        args = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            args += ["password", password]
        if hidden:
            args += ["hidden", "yes"]
        try:
            result = self._run(*args, timeout=60)
        except subprocess.TimeoutExpired:
            return {"ok": False, "message": WRONG_PASSWORD}
        if result.returncode == 0:
            return {"ok": True, "message": f"Connected to {ssid}."}
        detail = (result.stderr or result.stdout).lower()
        if "no network with ssid" in detail:
            return {"ok": False, "message": NOT_FOUND}
        return {"ok": False, "message": WRONG_PASSWORD}

    def country(self):
        result = self._run("sudo", "-n", "raspi-config", "nonint", "get_wifi_country")
        code = result.stdout.strip()
        return code if COUNTRY_CODE.match(code) else None

    def set_country(self, code):
        return self._run("sudo", "-n", "raspi-config", "nonint", "do_wifi_country", code).returncode == 0

    def timezone(self):
        return self._run("timedatectl", "show", "-p", "Timezone", "--value").stdout.strip() or None

    def set_timezone(self, name):
        return self._run("timedatectl", "set-timezone", name).returncode == 0


class FakeSystem:
    """Pretends to be a Pi, for trying the wizard elsewhere. Connecting works
    for any password except ones starting with "wrong". It reports being online (as the computer
    running it presumably is), unless WDW_FAKE_OFFLINE=1, which simulates a
    kiosk with no Wi-Fi until it's connected."""

    fake = True

    def __init__(self):
        self._offline = os.environ.get("WDW_FAKE_OFFLINE") == "1"
        self._ssid = None if self._offline else "SwampNet"
        self._country = "US"
        self._timezone = "America/New_York"

    def networks(self):
        time.sleep(1)  # a real scan takes a moment
        return _unique_networks([
            {"ssid": "SwampNet", "signal": 100, "secure": True},
            {"ssid": "SwampNet", "signal": 64, "secure": True},
            {"ssid": "Neighbor's Wi-Fi", "signal": 55, "secure": True},
            {"ssid": "Coffee Shop Guest", "signal": 40, "secure": False},
            {"ssid": "ワイファイ 5G", "signal": 30, "secure": True},
        ])

    def status(self):
        return {"ssid": self._ssid, "online": self._ssid is not None, "country": self._country,
                "timezone": self._timezone}

    def connect(self, ssid, password, hidden):
        time.sleep(2)
        if password.startswith("wrong"):
            return {"ok": False, "message": WRONG_PASSWORD}
        self._ssid = ssid
        return {"ok": True, "message": f"Connected to {ssid}."}

    def country(self):
        return self._country

    def set_country(self, code):
        self._country = code
        return True

    def timezone(self):
        return self._timezone

    def set_timezone(self, name):
        self._timezone = name
        return True


def make_system():
    if os.environ.get("WDW_FAKE_SYSTEM") == "1" or shutil.which("nmcli") is None:
        return FakeSystem()
    return RealSystem()
