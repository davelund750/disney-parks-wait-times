#!/usr/bin/env python3
"""Sets up a freshly flashed SD card to install the kiosk by itself.

Flash Raspberry Pi OS with desktop using Raspberry Pi Imager, with its OS
customisation set (at least a user and Wi-Fi), leave the card in this
computer, and run:

    make sd                                   (macOS, Linux)
    python tools/prepare_sd.py [boot-folder]  (anywhere, e.g. E:\\ on Windows)

On its first boot the Pi applies Imager's settings, gets online, clones this
project, switches to the newest release, runs install.sh, and restarts into
the kiosk (about 15-20 minutes on a Pi 3). Log on the Pi:
/var/log/disney-parks-firstboot.log

It adds two files to the card's boot partition (kiosk/firstboot.sh as
disney-parks-firstboot.sh, and disney-parks-firstboot.conf naming the
repository) and one first-boot step, alongside Imager's own, in cloud-init's
user-data (current Raspberry Pi OS) or in firstrun.sh (older). It never
reads or copies Imager's settings (Wi-Fi, passwords, names).

The repository is the one this copy was cloned from (a fork installs the
fork), in its https form; --repo URL picks another.

Only Python's standard library, so it runs the same on macOS, Linux, and
Windows.
"""

import argparse
import glob
import os
import re
import string
import subprocess
import sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_NAME = "disney-parks-firstboot.sh"
CONF_NAME = "disney-parks-firstboot.conf"
# Where the boot partition is on the Pi (Raspberry Pi OS Bookworm and later).
PI_BOOT = "/boot/firmware"
RUNCMD_ITEM = f"[bash, {PI_BOOT}/{SCRIPT_NAME}, enable]"
FIRSTRUN_LINE = f"bash {PI_BOOT}/{SCRIPT_NAME} enable"


class Problem(Exception):
    """Something the person running this needs to sort out."""


def is_boot_partition(path):
    return os.path.isfile(os.path.join(path, "cmdline.txt")) and os.path.isfile(os.path.join(path, "config.txt"))


def candidate_folders():
    """Where a card's boot partition usually appears on this computer."""
    if sys.platform == "darwin":
        return glob.glob("/Volumes/*")
    if sys.platform.startswith("win"):
        return [f"{letter}:\\" for letter in string.ascii_uppercase if letter not in "ABC"]
    user = os.environ.get("USER", "")
    return glob.glob(f"/media/{user}/*") + glob.glob(f"/run/media/{user}/*") + glob.glob("/media/*") + glob.glob("/mnt/*")


def find_boot_partition(candidates):
    found = sorted({os.path.realpath(path) for path in candidates if is_boot_partition(path)})
    if not found:
        raise Problem("Couldn't find the SD card's boot partition (a folder with cmdline.txt and config.txt, "
                      "usually named bootfs). Is the card in? Give its folder, e.g. make sd BOOT=/Volumes/bootfs")
    if len(found) > 1:
        raise Problem("Found more than one boot partition; give the one to use: " + ", ".join(found))
    return found[0]


def https_url(url):
    """A clone address the Pi can use without GitHub keys."""
    url = url.strip()
    if url.startswith(("https://", "http://")):
        return url
    match = re.fullmatch(r"(?:ssh://)?git@([^:/]+)[:/](.+)", url)
    if match:
        return f"https://{match[1]}/{match[2]}"
    raise Problem(f"Can't turn {url!r} into a web (https) address; give one with --repo")


def this_repository():
    try:
        url = subprocess.run(["git", "-C", PROJECT_DIR, "remote", "get-url", "origin"],
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        raise Problem("This copy has no GitHub address (git remote \"origin\"); give one with --repo")
    return https_url(url)


def add_runcmd(user_data):
    """user-data with our step added to its runcmd list (made if missing).

    Imager's own runcmd items stay, in order; ours runs after them. The file
    is edited as text (no YAML library), keeping its layout.
    """
    if SCRIPT_NAME in user_data:
        return user_data
    lines = user_data.splitlines()
    for i, line in enumerate(lines):
        if re.fullmatch(r"runcmd:\s*\[\s*\]\s*", line):  # an empty list, written inline
            lines[i] = "runcmd:"
        elif re.fullmatch(r"runcmd:\s*\S.*", line):
            raise Problem("The card's user-data writes runcmd on one line ([...]); "
                          "add this item to it by hand: - " + RUNCMD_ITEM)
    start = next((i for i, line in enumerate(lines) if re.fullmatch(r"runcmd:\s*", line)), None)
    if start is None:
        body = user_data.rstrip("\n")
        return f"{body}\nruncmd:\n  - {RUNCMD_ITEM}\n"
    # The list runs until the next top-level key. Its items may be indented
    # ("  - x") or not ("- x"); a following top-level key isn't a list item.
    end = start + 1
    item_indent = None
    last_item_line = start
    while end < len(lines):
        line = lines[end]
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            indent = len(line) - len(line.lstrip())
            if indent == 0 and not stripped.startswith("- "):
                break
            if stripped.startswith("- ") and item_indent is None:
                item_indent = indent
            last_item_line = end
        end += 1
    prefix = " " * (2 if item_indent is None else item_indent)
    lines.insert(last_item_line + 1, f"{prefix}- {RUNCMD_ITEM}")
    return "\n".join(lines) + "\n"


def add_to_firstrun(firstrun):
    """firstrun.sh with our step added before it deletes itself at the end."""
    if SCRIPT_NAME in firstrun:
        return firstrun
    lines = firstrun.splitlines()
    at = next((i for i, line in enumerate(lines) if re.match(r"\s*rm -f \S*firstrun\.sh", line)), None)
    if at is None:
        at = next((i for i in range(len(lines) - 1, -1, -1) if lines[i].strip() == "exit 0"), len(lines))
    lines.insert(at, FIRSTRUN_LINE)
    return "\n".join(lines) + "\n"


def prepare(boot, repo):
    """Adds the first-boot install to the card at `boot`; returns what it hooked into."""
    user_data = os.path.join(boot, "user-data")
    firstrun = os.path.join(boot, "firstrun.sh")
    if os.path.isfile(user_data):
        hooked, path, change = "user-data (cloud-init)", user_data, add_runcmd
    elif os.path.isfile(firstrun):
        hooked, path, change = "firstrun.sh", firstrun, add_to_firstrun
    else:
        raise Problem("This card has no first-boot settings (no user-data or firstrun.sh). Flash it with "
                      "Raspberry Pi Imager and set its OS customisation: at least a user and Wi-Fi.")
    # newline="\n": the Pi reads these, whatever this computer's line endings.
    with open(os.path.join(PROJECT_DIR, "kiosk", "firstboot.sh"), encoding="utf-8") as f:
        script = f.read()
    with open(os.path.join(boot, SCRIPT_NAME), "w", encoding="utf-8", newline="\n") as f:
        f.write(script)
    with open(os.path.join(boot, CONF_NAME), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"repo={repo}\n")
    with open(path, encoding="utf-8") as f:
        original = f.read()
    changed = change(original)
    if changed != original:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(changed)
    return hooked


def main(argv=None):
    parser = argparse.ArgumentParser(description="Set up a freshly flashed SD card to install the kiosk on first boot.")
    parser.add_argument("boot", nargs="?", help="the card's boot partition (found automatically if left out)")
    parser.add_argument("--repo", help="repository to install from (default: where this copy came from)")
    args = parser.parse_args(argv)
    try:
        boot = args.boot if args.boot else find_boot_partition(candidate_folders())
        if not is_boot_partition(boot):
            raise Problem(f"{boot} isn't a Raspberry Pi boot partition (no cmdline.txt and config.txt)")
        repo = https_url(args.repo) if args.repo else this_repository()
        hooked = prepare(boot, repo)
    except Problem as problem:
        print(f"Not done: {problem}", file=sys.stderr)
        return 1
    print(f"Ready: {boot}")
    print(f"  On first boot, the Pi installs the newest release of {repo}")
    print(f"  (added to the card's {hooked}, alongside Raspberry Pi Imager's settings).")
    print("Eject the card, put it in the Pi, and power it on. It restarts into the kiosk when done,")
    print("about 15-20 minutes on a Pi 3. Log on the Pi: /var/log/disney-parks-firstboot.log")
    return 0


if __name__ == "__main__":
    sys.exit(main())
