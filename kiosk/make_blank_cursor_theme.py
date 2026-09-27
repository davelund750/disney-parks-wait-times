#!/usr/bin/env python3
"""Builds an invisible mouse-pointer theme, so no pointer shows on the kiosk.

Usage: make_blank_cursor_theme.py [theme-to-mirror]   (default: PiXtrix)

Creates ~/.local/share/icons/wdw-blank with a fully transparent pointer under
every pointer name the mirrored theme has, so whatever shape a program asks
for comes out invisible. Select it by setting XCURSOR_THEME=wdw-blank in
~/.config/labwc/environment. Delete the folder (and that line) to undo.
"""

import os
import struct
import sys

THEME_NAME = "wdw-blank"
THEME_DIR = os.path.expanduser(f"~/.local/share/icons/{THEME_NAME}")
SOURCE_DIRS = ["/usr/share/icons", os.path.expanduser("~/.local/share/icons"), os.path.expanduser("~/.icons")]
# Always covered, even if the mirrored theme is missing.
BASE_NAMES = ["default", "left_ptr", "pointer", "hand2", "text", "xterm", "wait", "watch", "progress"]

XCURSOR_IMAGE_TYPE = 0xFFFD0002
NOMINAL_SIZE = 24


def transparent_xcursor():
    """A valid Xcursor file holding a single 1x1 fully transparent image."""
    file_header = b"Xcur" + struct.pack("<III", 16, 0x10000, 1)
    toc_entry = struct.pack("<III", XCURSOR_IMAGE_TYPE, NOMINAL_SIZE, 16 + 12)
    image = struct.pack("<IIIIIIIII", 36, XCURSOR_IMAGE_TYPE, NOMINAL_SIZE, 1, 1, 1, 0, 0, 0)
    pixel = struct.pack("<I", 0)  # ARGB, alpha 0
    return file_header + toc_entry + image + pixel


def pointer_names(theme):
    names = set(BASE_NAMES)
    for base in SOURCE_DIRS:
        cursors = os.path.join(base, theme, "cursors")
        if os.path.isdir(cursors):
            names.update(os.listdir(cursors))
    return sorted(names)


def main():
    theme = sys.argv[1] if len(sys.argv) > 1 else "PiXtrix"
    cursors_dir = os.path.join(THEME_DIR, "cursors")
    os.makedirs(cursors_dir, exist_ok=True)

    blank = os.path.join(cursors_dir, "left_ptr")
    with open(blank, "wb") as f:
        f.write(transparent_xcursor())

    names = pointer_names(theme)
    for name in names:
        path = os.path.join(cursors_dir, name)
        if name == "left_ptr":
            continue
        if os.path.lexists(path):
            os.remove(path)
        os.symlink("left_ptr", path)

    with open(os.path.join(THEME_DIR, "index.theme"), "w") as f:
        f.write(f"[Icon Theme]\nName={THEME_NAME}\nComment=Invisible pointer for the WDW kiosk\n")

    print(f"Wrote {THEME_DIR} ({len(names)} pointer names, mirroring {theme})")


if __name__ == "__main__":
    main()
