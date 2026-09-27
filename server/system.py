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
import sys
import time
from concurrent.futures import ThreadPoolExecutor

ZONEINFO = "/usr/share/zoneinfo"
COUNTRY_CODE = re.compile(r"^[A-Z]{2}$")

WRONG_PASSWORD = "Couldn't connect. Check the password and try again."
NOT_FOUND = "Couldn't find that network. Move closer to the router, or check the name."
NEEDS_PASSWORD = "Couldn't connect with the saved settings. Enter the password to try again."
NOT_ALLOWED = "This display isn't allowed to change Wi-Fi settings. (Its setup permissions are missing.)"
CONNECT_FAILED = "Couldn't connect to that network. Please try again."


def connect_error(detail):
    """A friendly message for why `nmcli dev wifi connect` failed. Only a real
    password problem says to check the password."""
    detail = detail.lower()
    if "no network with ssid" in detail:
        return NOT_FOUND
    if "not authorized" in detail or "insufficient privileges" in detail or "permission denied" in detail:
        return NOT_ALLOWED
    if "secrets were required" in detail or "psk" in detail or "password" in detail:
        return WRONG_PASSWORD
    return CONNECT_FAILED


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
        saved = self.saved_networks()
        networks = []
        for line in result.stdout.splitlines():
            fields = _split_terse(line)
            if len(fields) == 3:
                ssid, signal, security = fields
                networks.append({
                    "ssid": ssid,
                    "signal": int(signal) if signal.isdigit() else 0,
                    "secure": security not in ("", "--"),
                    "saved": ssid in saved,
                })
        return _unique_networks(networks)

    def saved_networks(self):
        """Saved Wi-Fi connections, as {network name: connection name}."""
        saved = {}
        for line in self._run("nmcli", "-t", "-e", "yes", "-f", "NAME,TYPE", "connection", "show").stdout.splitlines():
            fields = _split_terse(line)
            if len(fields) == 2 and fields[1] == "802-11-wireless":
                ssid = self._run("nmcli", "-g", "802-11-wireless.ssid", "connection", "show", fields[0]).stdout.strip()
                if ssid:
                    saved[ssid] = fields[0]
        return saved

    def start_update(self):
        """Starts the update service (update.sh): pull the latest version,
        rerun the installer if anything changed, and reboot. Returns right
        away; the reboot follows shortly."""
        return self._run("systemctl", "start", "--no-block", "wdw-update.service").returncode == 0

    def forget_wifi(self):
        """Deletes every saved Wi-Fi network (not wired ones), e.g. for a
        factory reset. The kiosk goes offline. Returns how many were deleted."""
        deleted = 0
        for ssid, name in self.saved_networks().items():
            result = self._run("nmcli", "connection", "delete", name)
            if result.returncode == 0:
                deleted += 1
            else:
                detail = (result.stderr or result.stdout).strip()
                print(f"Wi-Fi: couldn't forget {ssid!r} ({name!r}): {detail}", file=sys.stderr, flush=True)
        return deleted

    def status(self):
        # These are slow on a Pi 3 (raspi-config especially), so ask them all
        # at once rather than one after another.
        with ThreadPoolExecutor(max_workers=4) as pool:
            ssid = pool.submit(self._ssid)
            online = pool.submit(self._online)
            country = pool.submit(self.country)
            timezone = pool.submit(self.timezone)
            return {"ssid": ssid.result(), "online": online.result(), "country": country.result(),
                    "timezone": timezone.result()}

    def _ssid(self):
        for line in self._run("nmcli", "-t", "-e", "yes", "-f", "ACTIVE,SSID", "dev", "wifi").stdout.splitlines():
            fields = _split_terse(line)
            if len(fields) == 2 and fields[0] == "yes":
                return fields[1]
        return None

    def _online(self):
        # NetworkManager's last known answer, which it keeps up to date itself;
        # "connectivity check" would test the internet on the spot, which is slow.
        return self._run("nmcli", "networking", "connectivity").stdout.strip() == "full"

    def connect(self, ssid, password, hidden):
        # A network the Pi already knows: use its saved settings as they are.
        # Connecting "fresh" would try to rewrite them, which can fail (e.g.
        # for one set up by Raspberry Pi Imager, whose settings belong to
        # netplan).
        saved = self.saved_networks().get(ssid)
        if saved:
            try:
                result = self._run("nmcli", "connection", "up", saved, timeout=60)
            except subprocess.TimeoutExpired:
                result = None
            if result and result.returncode == 0:
                return {"ok": True, "message": f"Connected to {ssid}."}
            detail = (result.stderr or result.stdout).strip() if result else "timed out"
            print(f"Wi-Fi: saved connection {saved!r} for {ssid!r} failed: {detail}", file=sys.stderr, flush=True)
            if not password:
                # Maybe the password changed; the wizard will ask for it.
                return {"ok": False, "message": NEEDS_PASSWORD, "needsPassword": True}
        elif not password and not hidden:
            return {"ok": False, "message": NEEDS_PASSWORD, "needsPassword": True}
        args = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            args += ["password", password]
        if hidden:
            args += ["hidden", "yes"]
        try:
            result = self._run(*args, timeout=60)
        except subprocess.TimeoutExpired:
            print(f"Wi-Fi connect to {ssid!r} timed out", file=sys.stderr, flush=True)
            return {"ok": False, "message": CONNECT_FAILED}
        if result.returncode == 0:
            return {"ok": True, "message": f"Connected to {ssid}."}
        # nmcli's own explanation goes to the service log (the password isn't in it).
        detail = (result.stderr or result.stdout).strip()
        print(f"Wi-Fi connect to {ssid!r} failed: {detail}", file=sys.stderr, flush=True)
        return {"ok": False, "message": connect_error(detail)}

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
    kiosk with no Wi-Fi until it's connected. WDW_FAKE_STATUS_DELAY (seconds)
    makes the status check as slow as a real Pi 3's."""

    fake = True

    def __init__(self):
        self._offline = os.environ.get("WDW_FAKE_OFFLINE") == "1"
        self._ssid = None if self._offline else "HomeWiFi"
        self._country = "US"
        self._timezone = "America/New_York"

    def networks(self):
        time.sleep(1)  # a real scan takes a moment
        return _unique_networks([
            {"ssid": "HomeWiFi", "signal": 100, "secure": True, "saved": not self._offline},
            {"ssid": "HomeWiFi", "signal": 64, "secure": True, "saved": not self._offline},
            {"ssid": "Neighbor's Wi-Fi", "signal": 55, "secure": True, "saved": False},
            {"ssid": "Coffee Shop Guest", "signal": 40, "secure": False, "saved": False},
            {"ssid": "ワイファイ 5G", "signal": 30, "secure": True, "saved": False},
        ])

    def status(self):
        time.sleep(float(os.environ.get("WDW_FAKE_STATUS_DELAY", "0")))
        return {"ssid": self._ssid, "online": self._ssid is not None, "country": self._country,
                "timezone": self._timezone}

    def connect(self, ssid, password, hidden):
        time.sleep(2)
        if ssid == "HomeWiFi" and not password and not self._offline:  # saved, like on the real Pi
            self._ssid = ssid
            return {"ok": True, "message": f"Connected to {ssid}."}
        if password.startswith("wrong"):
            return {"ok": False, "message": WRONG_PASSWORD}
        self._ssid = ssid
        return {"ok": True, "message": f"Connected to {ssid}."}

    def country(self):
        return self._country

    def set_country(self, code):
        self._country = code
        return True

    def start_update(self):
        print("Pretend system: would check for updates and restart now", flush=True)
        return True

    def forget_wifi(self):
        forgotten = 0 if self._offline else 1  # "HomeWiFi" is saved unless offline
        self._offline = True
        self._ssid = None
        return forgotten

    def timezone(self):
        return self._timezone

    def set_timezone(self, name):
        self._timezone = name
        return True


def make_system():
    if os.environ.get("WDW_FAKE_SYSTEM") == "1" or shutil.which("nmcli") is None:
        return FakeSystem()
    return RealSystem()
